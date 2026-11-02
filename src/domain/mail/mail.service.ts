import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  NotificationCanal,
  Prisma,
  UserStatus,
  ValidationDecision,
} from '../../../generated/prisma/client';
import { SetAccessDto } from '../../common/dto/access.dto';
import { SetOwnerDto } from '../../common/dto/set-owner.dto';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import {
  assertDossierOpenForActivity,
  markDossierInProgress,
} from '../../common/utils/dossier-lifecycle';
import { assertCorrespondentActive } from '../../common/utils/referential-guards';
import { DatabaseService } from '../../database/database.service';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { awaitingValidationBy } from '../../common/utils/courrier-validation';
import { dateRange } from '../../common/utils/date-range';
import { visibleDossierWhere } from '../../common/utils/dossier-visibility';
import {
  FindIncomingMailsQueryDto,
  IncomingMailSort,
  INCOMING_STATUS_TABS,
  resolveIncomingTabStatuses,
} from './dto/find-incoming-mails.query.dto';
import {
  FindOutgoingMailsQueryDto,
  OUTGOING_STATUS_GROUPS,
  OutgoingStatusGroup,
} from './dto/find-outgoing-mails.query.dto';
import { RbacService } from '../../auth/rbac/rbac.service';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { CreateMailDto } from './dto/create-mail.dto';
import { CreateOutgoingMailDto } from './dto/create-outgoing-mail.dto';
import { StorageService } from '../../storage/storage.service';
import { FindMailsQueryDto } from './dto/find-mails.query.dto';
import { UpdateMailDto } from './dto/update-mail.dto';
import { AssignSupervisorDto } from './dto/assign-supervisor.dto';
import { DispatchMailDto } from './dto/dispatch-mail.dto';
import { ActivityService } from '../../activity/activity.service';

const mailInclude = {
  correspondent: true,
  nature: true,
  canal: true,
  owner: { select: { id: true, name: true, email: true } },
  supervisor: { select: { id: true, name: true, email: true } },
  proposedBy: { select: { id: true, name: true, email: true } },
  dispatchValidatedBy: { select: { id: true, name: true, email: true } },
  project: { select: { id: true, name: true, reference: true } },
  contract: {
    select: { id: true, number: true, title: true, reference: true },
  },
  // `priority` is included so the frontend can show a courrier's urgency —
  // Courrier has no priority of its own, it inherits its dossier's.
  // Its dossier's contract is the effet's contract.
  dossier: {
    select: {
      id: true,
      number: true,
      title: true,
      priority: true,
      contract: { select: { id: true, reference: true, title: true } },
    },
  },
  respondsTo: {
    select: { id: true, number: true, subject: true, direction: true },
  },
  documents: { orderBy: { createdAt: 'asc' } },
  type: {
    select: { id: true, name: true, isPhysical: true, canListEffets: true },
  },
  // A bordereau and the effets it lists.
  parent: { select: { id: true, number: true, subject: true } },
  children: {
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      type: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  validations: {
    include: { validator: { select: { id: true, name: true } } },
    orderBy: { decidedAt: 'desc' },
  },
  _count: {
    select: { instructions: true },
  },
  instructions: {
    select: { id: true, status: true },
  },
} satisfies Prisma.CourrierInclude;

/**
 * Formats a courrier by adding composite/nested structures for dispatch
 * and supervisor information according to the API specification:
 * - dispatch: { proposedBy: { id, name }, proposedAt, validatedBy: { id, name } | null, validatedAt | null }
 * - supervisor: { id, name } | null, dueDate, supervisorNote
 */
export function formatCourrier<T extends Record<string, any>>(courrier: T) {
  if (!courrier) return courrier;

  const hasDispatch =
    courrier.proposedBy !== undefined ||
    courrier.proposedAt !== undefined ||
    courrier.dispatchValidatedBy !== undefined ||
    courrier.dispatchValidatedAt !== undefined ||
    courrier.proposedById !== undefined ||
    courrier.dispatchValidatedById !== undefined;

  const dispatch = hasDispatch
    ? {
        proposedBy: courrier.proposedBy
          ? { id: courrier.proposedBy.id, name: courrier.proposedBy.name }
          : null,
        proposedAt: courrier.proposedAt ?? null,
        validatedBy: courrier.dispatchValidatedBy
          ? {
              id: courrier.dispatchValidatedBy.id,
              name: courrier.dispatchValidatedBy.name,
            }
          : null,
        validatedAt: courrier.dispatchValidatedAt ?? null,
      }
    : null;

  const supervisor =
    courrier.supervisor !== undefined
      ? courrier.supervisor
        ? {
            id: courrier.supervisor.id,
            name: courrier.supervisor.name,
            ...(courrier.supervisor.email
              ? { email: courrier.supervisor.email }
              : {}),
          }
        : null
      : undefined;

  return {
    ...courrier,
    ...(supervisor !== undefined ? { supervisor } : {}),
    ...(courrier.supervisorDueDate !== undefined ||
    courrier.dueDate !== undefined
      ? {
          dueDate: courrier.supervisorDueDate ?? courrier.dueDate ?? null,
          supervisorDueDate: courrier.supervisorDueDate ?? null,
        }
      : {}),
    ...(courrier.supervisorNote !== undefined
      ? { supervisorNote: courrier.supervisorNote ?? null }
      : {}),
    ...(dispatch !== null ? { dispatch } : {}),
    instructionsProgress: Array.isArray(courrier.instructions)
      ? {
          done: (courrier.instructions as { status: string }[]).filter(
            (i) => i.status === 'TERMINEE',
          ).length,
          total: (courrier.instructions as { status: string }[]).length,
        }
      : {
          done: 0,
          total:
            (courrier._count as { instructions?: number } | undefined)
              ?.instructions ?? 0,
        },
  };
}

const courrierAccessInclude = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CourrierAccessInclude;

// States in which the courrier can still be freely edited or deleted by the
// person who registered/drafted it (RG-COU-003/004).
const EDITABLE_STATUSES: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
  CourrierStatus.BROUILLON,
  CourrierStatus.A_CORRIGER,
];

// Entrant workflow: statuses before the courrier has been fully treated —
// cancellable, and the only ones `close()` can be called from.
const ENTRANT_OPEN_STATUSES: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
  CourrierStatus.TRANSMIS,
  CourrierStatus.EN_TRAITEMENT,
];

// Entrant statuses it can be marked fully treated from: still open, or
// validated.
const ENTRANT_CLOSABLE_STATUSES: CourrierStatus[] = [
  ...ENTRANT_OPEN_STATUSES,
  CourrierStatus.VALIDE,
];

// Sortant workflow: statuses before it's been sent — cancellable.
const SORTANT_OPEN_STATUSES: CourrierStatus[] = [
  CourrierStatus.BROUILLON,
  CourrierStatus.EN_ATTENTE_VALIDATION,
  CourrierStatus.A_CORRIGER,
];

// Statuses submitForValidation() accepts, per direction: a sortant once
// drafted, an entrant once handed over for treatment — or either one sent
// back for corrections.
const SUBMITTABLE_STATUSES: Record<CourrierDirection, CourrierStatus[]> = {
  [CourrierDirection.SORTANT]: [
    CourrierStatus.BROUILLON,
    CourrierStatus.A_CORRIGER,
  ],
  [CourrierDirection.ENTRANT]: [
    CourrierStatus.TRANSMIS,
    CourrierStatus.EN_TRAITEMENT,
    CourrierStatus.A_CORRIGER,
  ],
};

@Injectable()
export class MailService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly rbac: RbacService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  // (dto already carries ownerId straight through via `...data` below —
  // Prisma accepts the scalar FK field directly on CourrierCreateInput.)
  async create(
    dto: CreateMailDto,
    createdById: string,
    files?: Express.Multer.File[],
  ) {
    if (dto.transmit) {
      assertTransmittable(dto.direction, dto.dossierId ?? null);
    }
    if (dto.dossierId) {
      await assertDossierOpenForActivity(this.database, dto.dossierId);
    } else {
      await this.assertRegistrantHasSite(createdById);
    }
    if (dto.correspondentId) {
      await assertCorrespondentActive(this.database, dto.correspondentId);
    }
    if (dto.respondsToId) {
      await this.assertRespondsToValid(dto.respondsToId);
    }
    const typeId = await this.checkEffetFields(dto, {
      direction: dto.direction,
      siteId: await this.siteOfEffet(dto.dossierId ?? null, createdById),
    });
    const { receivedAt, documents: documentMetas, transmit, ...data } = dto;
    const dossierLinks = await this.projectOfDossier(dto.dossierId);
    const courrier = await createWithUniqueReference('M', (number) =>
      this.database.courrier.create({
        data: {
          ...data,
          typeId,
          number,
          // An entrant always has its reception date: the registration
          // date when none is given — the date it's listed, sorted and
          // filtered by.
          receivedAt: receivedAt
            ? new Date(receivedAt)
            : dto.direction === CourrierDirection.ENTRANT
              ? new Date()
              : undefined,
          ...dossierLinks,
          status:
            dto.direction === CourrierDirection.ENTRANT
              ? CourrierStatus.RECU
              : CourrierStatus.BROUILLON,
          createdById,
        },
        include: mailInclude,
      }),
    );

    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const meta = documentMetas?.[i];
        const { key } = await this.storage.upload(file.buffer, {
          originalName: file.originalname,
          contentType: file.mimetype,
          prefix: `courriers/${courrier.id}`,
        });
        await this.database.document.create({
          data: {
            originalName: file.originalname,
            name: meta?.name ?? file.originalname,
            storageKey: key,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            courrierId: courrier.id,
            uploadedById: createdById,
          },
        });
      }
    }

    if (dto.dossierId) {
      await markDossierInProgress(this.database, dto.dossierId);
    }

    if (transmit) {
      return this.transmit(courrier.id, createdById);
    }

    this.recordCourrierEvent(courrier.id, 'COURRIER_ENREGISTRE');

    if (files && files.length > 0) {
      return this.findOne(courrier.id);
    }

    return courrier;
  }

  // Sortant draft from its subject alone: a BROUILLON with its internal
  // number, not yet attached to a dossier. Everything else, dossier
  // included, is completed through update() before submitForVerification().
  async createOutgoingDraft(dto: CreateOutgoingMailDto, createdById: string) {
    const typeId = await this.defaultEffetTypeId();
    return createWithUniqueReference('M', (number) =>
      this.database.courrier.create({
        data: {
          subject: dto.subject,
          typeId,
          number,
          direction: CourrierDirection.SORTANT,
          status: CourrierStatus.BROUILLON,
          createdById,
        },
        include: mailInclude,
      }),
    );
  }

  async findAll(query: FindMailsQueryDto) {
    const where: Prisma.CourrierWhereInput = {
      dossierId: query.dossierId,
      direction: query.direction,
      status: query.status,
      correspondentId: query.correspondentId,
      ownerId: query.ownerId,
      typeId: query.typeId,
      AND: [projectOrContractWhere(query)].filter(
        (filter) => filter !== undefined,
      ),
    };

    const [data, total] = await this.database.$transaction([
      this.database.courrier.findMany({
        where,
        include: mailInclude,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.courrier.count({ where }),
    ]);

    return {
      data: data.map(formatCourrier),
      total,
      skip: query.skip ?? 0,
      take: query.take ?? 20,
    };
  }

  /**
   * Everything the "Courriers entrants" page needs in one call: the
   * filtered, paginated list plus the page's metric cards. Only courriers
   * in dossiers the caller can see are returned (same rule as the dossier
   * list). `metrics` ignore the filters, so the cards stay put while the
   * user searches.
   */
  async findIncoming(query: FindIncomingMailsQueryDto, userId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const visible = visibleMailsWhere(
      CourrierDirection.ENTRANT,
      userId,
      await this.readableSites(userId),
    );
    const received = dateRange(query.receivedFrom, query.receivedTo);
    const tabStatuses = resolveIncomingTabStatuses(query.tab);
    const where: Prisma.CourrierWhereInput = {
      ...visible,
      status: query.status,
      dossierId: query.dossierId,
      correspondentId: query.correspondentId,
      natureId: query.natureId,
      typeId: query.typeId,
      ownerId: query.ownerId,
      AND: [
        searchWhere(query.search),
        projectOrContractWhere(query),
        tabStatuses ? { status: { in: [...tabStatuses] } } : undefined,
        // No reception date recorded: fall back to the registration date,
        // the same one the list displays.
        received && {
          OR: [
            { receivedAt: received },
            { receivedAt: null, createdAt: received },
          ],
        },
      ].filter((filter) => filter !== undefined),
    };

    const inStatuses = (statuses: readonly CourrierStatus[]) => ({
      ...visible,
      status: { in: [...statuses] },
    });

    const [
      data,
      total,
      allCount,
      toDispatch,
      dispatchPending,
      assigned,
      inTreatment,
      closed,
      archivedCount,
      others,
    ] = await this.database.$transaction([
      this.database.courrier.findMany({
        where,
        include: mailInclude,
        orderBy:
          query.sort === IncomingMailSort.Oldest
            ? [{ receivedAt: 'asc' }, { createdAt: 'asc' }]
            : [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.database.courrier.count({ where }),
      this.database.courrier.count({ where: visible }),
      this.database.courrier.count({
        where: inStatuses(INCOMING_STATUS_TABS.toDispatch),
      }),
      this.database.courrier.count({
        where: inStatuses(INCOMING_STATUS_TABS.dispatchPending),
      }),
      this.database.courrier.count({
        where: inStatuses(INCOMING_STATUS_TABS.assigned),
      }),
      this.database.courrier.count({
        where: inStatuses(INCOMING_STATUS_TABS.inTreatment),
      }),
      this.database.courrier.count({
        where: inStatuses(INCOMING_STATUS_TABS.closed),
      }),
      this.database.courrier.count({
        where: inStatuses(INCOMING_STATUS_TABS.archived),
      }),
      this.database.courrier.count({
        where: inStatuses(INCOMING_STATUS_TABS.others),
      }),
    ]);

    return {
      data: data.map(formatCourrier),
      total,
      skip,
      take,
      metrics: {
        total: allCount,
        all: allCount,
        archived: archivedCount,
        toDispatch,
        dispatchPending,
        assigned,
        inTreatment,
        closed,
        aDispatcher: toDispatch,
        dispatchingAValider: dispatchPending,
        affectes: assigned,
        enTraitement: inTreatment,
        clotures: closed,
        others,
        // Together the tabs other than "all" hold every effet of "all".
        byTab: {
          all: allCount,
          toDispatch,
          dispatchPending,
          assigned,
          inTreatment,
          closed,
          archived: archivedCount,
          others,
        },
      },
    };
  }

  /**
   * Everything the "Courriers sortants" page needs in one call: the rows of
   * one tab (`group`), paginated server-side, plus each tab's count. Same
   * visibility rule as findIncoming. `metrics` ignore the filters, so the
   * tab counts and cards stay put while the user searches.
   */
  async findOutgoing(query: FindOutgoingMailsQueryDto, userId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const visible = visibleMailsWhere(
      CourrierDirection.SORTANT,
      userId,
      await this.readableSites(userId),
    );
    const created = dateRange(query.createdFrom, query.createdTo);
    const where: Prisma.CourrierWhereInput = {
      ...visible,
      status: query.status,
      dossierId: query.dossierId,
      correspondentId: query.correspondentId,
      natureId: query.natureId,
      typeId: query.typeId,
      ownerId: query.ownerId,
      createdAt: created,
      AND: [
        searchWhere(query.search),
        projectOrContractWhere(query),
        query.group && {
          status: { in: [...OUTGOING_STATUS_GROUPS[query.group]] },
        },
      ].filter((filter) => filter !== undefined),
    };
    const inGroup = (group: OutgoingStatusGroup) => ({
      ...visible,
      status: { in: [...OUTGOING_STATUS_GROUPS[group]] },
    });

    const [data, total, pending, approved, rejected, allCount] =
      await this.database.$transaction([
        this.database.courrier.findMany({
          where,
          include: mailInclude,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.database.courrier.count({ where }),
        this.database.courrier.count({ where: inGroup('pending') }),
        this.database.courrier.count({ where: inGroup('approved') }),
        this.database.courrier.count({ where: inGroup('rejected') }),
        this.database.courrier.count({ where: visible }),
      ]);

    return {
      data: data.map(formatCourrier),
      total,
      skip,
      take,
      metrics: { pending, approved, rejected, total: allCount },
    };
  }

  async findOne(id: string) {
    const courrier = await this.database.courrier.findUnique({
      where: { id },
      include: mailInclude,
    });
    if (!courrier) {
      throw new NotFoundException(`Courrier ${id} not found`);
    }
    return formatCourrier(courrier);
  }

  // Checked up front so a bad id is a 400, not a foreign-key 500. Only a
  // direct self-reference is refused — longer reply chains are fine.
  private async assertRespondsToValid(respondsToId: string, selfId?: string) {
    if (respondsToId === selfId) {
      throw new BadRequestException('A courrier cannot respond to itself');
    }
    const target = await this.database.courrier.findUnique({
      where: { id: respondsToId },
      select: { id: true },
    });
    if (!target) {
      throw new BadRequestException(`Courrier ${respondsToId} not found`);
    }
  }

  async update(id: string, dto: UpdateMailDto, actingUserId: string) {
    const courrier = await this.ensureEditable(id);
    // Checked before anything is written: a refused transmission must not
    // leave the courrier half-updated.
    if (dto.transmit) {
      assertTransmittable(
        courrier.direction,
        dto.dossierId ?? courrier.dossierId,
        courrier.status,
      );
    }
    const dossierChanged =
      dto.dossierId !== undefined && dto.dossierId !== courrier.dossierId;
    if (dossierChanged) {
      await assertDossierOpenForActivity(this.database, dto.dossierId!);
    }
    if (
      dto.correspondentId &&
      dto.correspondentId !== courrier.correspondentId
    ) {
      await assertCorrespondentActive(this.database, dto.correspondentId);
    }
    if (dto.respondsToId && dto.respondsToId !== courrier.respondsToId) {
      await this.assertRespondsToValid(dto.respondsToId, id);
    }
    const typeId = await this.checkEffetFields(
      dto,
      {
        direction: courrier.direction,
        siteId: await this.siteOfEffet(
          dto.dossierId ?? courrier.dossierId,
          courrier.createdById,
        ),
      },
      courrier,
    );
    const { receivedAt, transmit, ...data } = dto;
    const updated = await this.database.courrier.update({
      where: { id: courrier.id },
      data: {
        ...data,
        typeId,
        receivedAt: receivedAt ? new Date(receivedAt) : undefined,
        ...(dossierChanged ? await this.projectOfDossier(dto.dossierId) : {}),
      },
      include: mailInclude,
    });
    if (dossierChanged) {
      await markDossierInProgress(this.database, dto.dossierId!);
    }
    if (transmit) {
      return this.transmit(id, actingUserId);
    }
    this.recordCourrierEvent(id, 'COURRIER_MODIFIE');
    return formatCourrier(updated);
  }

  // An effet attached to a dossier is in that dossier's project and
  // contract — the same as dispatching it there. A dossier with neither
  // leaves them as they are.
  private async projectOfDossier(dossierId: string | null | undefined) {
    if (!dossierId) return {};
    const dossier = await this.database.dossier.findUnique({
      where: { id: dossierId },
      select: { projectId: true, contractId: true },
    });
    return {
      ...(dossier?.projectId ? { projectId: dossier.projectId } : {}),
      ...(dossier?.contractId ? { contractId: dossier.contractId } : {}),
    };
  }

  async remove(id: string) {
    await this.ensureEditable(id);
    await this.database.courrier.delete({ where: { id } });
  }

  // Entrant: ENREGISTRE -> TRANSMIS (10.2.4.7 — handed to the dossier's
  // responsible for treatment), so its dossier must be known by then. The
  // responsible is told, so nothing waits unnoticed.
  async transmit(id: string, actingUserId: string) {
    const courrier = await this.requireStatus(id, TRANSMITTABLE_STATUSES);
    assertTransmittable(courrier.direction, courrier.dossierId);
    const updated = await this.setStatus(courrier.id, CourrierStatus.TRANSMIS);
    this.notify(courrier, [await this.validatorOf(courrier)], actingUserId, {
      type: 'COURRIER_TRANSMITTED',
      message: `« ${courrier.subject} » vous a été transmis.`,
    });
    return formatCourrier(updated);
  }

  // -> EN_ATTENTE_VALIDATION, from SUBMITTABLE_STATUSES. One decision by
  // the designated validator (see validatorOf) settles it: VALIDE, or
  // A_CORRIGER with a motif.
  async submitForValidation(id: string, userId: string) {
    const courrier = await this.findOne(id);
    const allowed = SUBMITTABLE_STATUSES[courrier.direction];
    if (!allowed.includes(courrier.status)) {
      throw new BadRequestException(
        `Courrier is ${courrier.status}, expected one of: ${allowed.join(', ')}`,
      );
    }
    const validatorId = await this.validatorOf(courrier);
    if (!validatorId) {
      throw new BadRequestException(
        'Nobody can validate this courrier: neither its dossier nor its site has a responsible — name one first',
      );
    }
    const updated = await this.setStatus(
      id,
      CourrierStatus.EN_ATTENTE_VALIDATION,
    );
    this.notify(courrier, [validatorId], userId, {
      type: 'COURRIER_VALIDATION_PENDING',
      message: `« ${courrier.subject} » attend votre validation.`,
    });
    return formatCourrier(updated);
  }

  /**
   * Dispatch an incoming courrier:
   * Body: { projectId, contractId } OR { projectId, dossierId } (exactly one of contractId or dossierId).
   * - contract/dossier must belong to the project.
   * - With dispatch permission: status -> TRANSMIS, ownerId = designated responsible.
   * - Without dispatch permission: status -> EN_ATTENTE_TRANSMISSION, proposal is stored.
   * - Allowed from RECU or ENREGISTRE. Also allowed from EN_ATTENTE_TRANSMISSION or TRANSMIS
   *   for users with permission, as long as no instruction exists (reassignment). Otherwise 409 Conflict.
   */
  async dispatch(id: string, dto: DispatchMailDto, userId: string) {
    const hasContract = Boolean(dto.contractId);
    const hasDossier = Boolean(dto.dossierId);
    if ((hasContract && hasDossier) || (!hasContract && !hasDossier)) {
      throw new BadRequestException(
        "Fournir soit contractId, soit dossierId, exactement l'un des deux.",
      );
    }

    const project = await this.database.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true, responsibleId: true },
    });
    if (!project) {
      throw new NotFoundException(`Projet ${dto.projectId} non trouvé`);
    }

    let designatedResponsibleId: string | null = null;
    let resolvedContractId: string | null = null;
    let resolvedDossierId: string | null = null;

    if (dto.contractId) {
      const contract = await this.database.contract.findUnique({
        where: { id: dto.contractId },
        select: {
          id: true,
          projectId: true,
          responsibleId: true,
        },
      });
      if (!contract) {
        throw new NotFoundException(`Contrat ${dto.contractId} non trouvé`);
      }
      if (contract.projectId !== dto.projectId) {
        throw new BadRequestException(
          `Le contrat ${dto.contractId} n'appartient pas au projet ${dto.projectId}`,
        );
      }
      designatedResponsibleId =
        contract.responsibleId ?? project.responsibleId ?? null;
      resolvedContractId = dto.contractId;
    } else if (dto.dossierId) {
      const dossier = await this.database.dossier.findUnique({
        where: { id: dto.dossierId },
        select: {
          id: true,
          projectId: true,
          contractId: true,
          responsibleId: true,
          site: { select: { responsibleId: true } },
        },
      });
      if (!dossier) {
        throw new NotFoundException(`Dossier ${dto.dossierId} non trouvé`);
      }
      if (dossier.projectId !== dto.projectId) {
        throw new BadRequestException(
          `Le dossier ${dto.dossierId} n'appartient pas au projet ${dto.projectId}`,
        );
      }
      designatedResponsibleId =
        dossier.responsibleId ?? dossier.site.responsibleId ?? null;
      resolvedDossierId = dto.dossierId;
      resolvedContractId = dossier.contractId ?? null;
    }

    const courrier = await this.database.courrier.findUnique({
      where: { id },
      include: {
        instructions: { select: { id: true } },
        dossier: {
          select: {
            siteId: true,
            site: { select: { responsibleId: true } },
          },
        },
      },
    });
    if (!courrier) {
      throw new NotFoundException(`Courrier ${id} non trouvé`);
    }

    const hasPermission = await this.canDispatch(userId, courrier);
    const status = courrier.status;

    const isInitial =
      status === CourrierStatus.RECU || status === CourrierStatus.ENREGISTRE;
    const isReassignable =
      status === CourrierStatus.EN_ATTENTE_TRANSMISSION ||
      status === CourrierStatus.TRANSMIS;

    if (isInitial) {
      // Allowed for users with or without permission
    } else if (isReassignable) {
      if (!hasPermission) {
        throw new ConflictException(
          "Seul un utilisateur avec la permission de dispatch peut changer l'affectation d'un effet en attente de validation ou déjà transmis",
        );
      }
      if (courrier.instructions.length > 0) {
        throw new ConflictException(
          "Impossible de changer l'affectation : une ou plusieurs instructions existent déjà pour cet effet",
        );
      }
    } else {
      throw new ConflictException(
        `Impossible de dispatcher l'effet depuis le statut ${status}`,
      );
    }

    if (hasPermission) {
      const now = new Date();
      const updated = await this.database.courrier.update({
        where: { id },
        data: {
          status: CourrierStatus.TRANSMIS,
          ownerId: designatedResponsibleId,
          projectId: dto.projectId,
          contractId: resolvedContractId,
          dossierId: resolvedDossierId,
          proposedProjectId: null,
          proposedContractId: null,
          proposedDossierId: null,
          proposedById: userId,
          proposedAt: now,
          dispatchValidatedById: userId,
          dispatchValidatedAt: now,
        },
        include: mailInclude,
      });

      if (resolvedDossierId) {
        await markDossierInProgress(this.database, resolvedDossierId);
      }

      if (designatedResponsibleId) {
        this.notify(courrier, [designatedResponsibleId], userId, {
          type: 'COURRIER_TRANSMITTED',
          message: `« ${courrier.subject} » vous a été transmis.`,
        });
      }

      this.recordCourrierEvent(id, 'COURRIER_DISPATCHE', {
        projectId: dto.projectId,
      });
      return formatCourrier(updated);
    } else {
      const updated = await this.database.courrier.update({
        where: { id },
        data: {
          status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
          proposedProjectId: dto.projectId,
          proposedContractId: dto.contractId ?? null,
          proposedDossierId: dto.dossierId ?? null,
          proposedById: userId,
          proposedAt: new Date(),
          dispatchValidatedById: null,
          dispatchValidatedAt: null,
        },
        include: mailInclude,
      });

      this.notify(courrier, await this.dispatchValidatorsOf(courrier), userId, {
        type: 'COURRIER_VALIDATION_PENDING',
        message: `Une proposition de dispatch pour « ${courrier.subject} » est en attente de validation.`,
      });

      this.recordCourrierEvent(id, 'COURRIER_DISPATCH_PROPOSE', {
        projectId: dto.projectId,
      });
      return formatCourrier(updated);
    }
  }

  /**
   * Assigns a supervisor to a transmitted courrier.
   */
  async assignSupervisor(
    id: string,
    dto: AssignSupervisorDto,
    actingUserId: string,
  ) {
    const courrier = await this.database.courrier.findUnique({
      where: { id },
      include: { dossier: { select: { site: true } } },
    });
    if (!courrier) {
      throw new NotFoundException(`Courrier ${id} non trouvé`);
    }

    const isOwner = courrier.ownerId === actingUserId;
    const isSiteAdmin =
      (await this.siteResponsibleOf(courrier)) === actingUserId;
    const isAdmin = await this.rbac.hasGlobalPermission(
      actingUserId,
      PermissionCode.AdminManageUsers,
    );
    if (!isOwner && !isSiteAdmin && !isAdmin) {
      throw new ForbiddenException(
        'Seul le responsable désigné (destinataire), le responsable du site ou un administrateur peut affecter un superviseur',
      );
    }

    const supervisor = await this.database.user.findUnique({
      where: { id: dto.supervisorId },
      select: { status: true },
    });
    if (!supervisor) {
      throw new NotFoundException(`Utilisateur ${dto.supervisorId} non trouvé`);
    }
    if (supervisor.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'Un utilisateur inactif ne peut pas être désigné superviseur',
      );
    }

    const updated = await this.database.courrier.update({
      where: { id },
      data: {
        supervisorId: dto.supervisorId,
        supervisorDueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        supervisorNote: dto.note ?? null,
      },
      include: mailInclude,
    });

    this.notify(courrier, [dto.supervisorId], actingUserId, {
      type: 'COURRIER_SUPERVISOR_ASSIGNED',
      message: `Vous avez été désigné comme superviseur pour « ${courrier.subject} ».`,
    });

    this.recordCourrierEvent(id, 'COURRIER_SUPERVISEUR_AFFECTE', {
      supervisorId: dto.supervisorId,
    });
    return formatCourrier(updated);
  }

  /**
   * Validates a proposed dispatching for an incoming courrier (EN_ATTENTE_TRANSMISSION -> TRANSMIS).
   * Reserved to users authorized to validate dispatching. Sets ownerId to the designated responsible of the target.
   */
  async validateDispatch(id: string, userId: string) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.EN_ATTENTE_TRANSMISSION,
    ]);

    if (!courrier.proposedProjectId) {
      throw new BadRequestException(
        "Cet effet n'a pas de proposition de dispatching en attente.",
      );
    }

    const canValidate = await this.canValidateDispatch(userId, courrier);
    if (!canValidate) {
      throw new ForbiddenException(
        'Seul un utilisateur habilité à valider le dispatching peut effectuer cette action.',
      );
    }

    const updated = await this.database.$transaction(async (tx) => {
      let ownerId: string | null = null;
      let contractId = courrier.proposedContractId;
      const dossierId = courrier.proposedDossierId;
      const projectId = courrier.proposedProjectId;

      if (contractId) {
        const contract = await tx.contract.findUnique({
          where: { id: contractId },
          select: {
            responsibleId: true,
            project: { select: { responsibleId: true } },
          },
        });
        ownerId =
          contract?.responsibleId ?? contract?.project?.responsibleId ?? null;
      } else if (dossierId) {
        const dossier = await tx.dossier.findUnique({
          where: { id: dossierId },
          select: {
            responsibleId: true,
            contractId: true,
            site: { select: { responsibleId: true } },
          },
        });
        ownerId =
          dossier?.responsibleId ?? dossier?.site?.responsibleId ?? null;
        if (!contractId && dossier?.contractId) {
          contractId = dossier.contractId;
        }
      }

      const { count } = await tx.courrier.updateMany({
        where: { id, status: CourrierStatus.EN_ATTENTE_TRANSMISSION },
        data: {
          status: CourrierStatus.TRANSMIS,
          projectId,
          contractId,
          dossierId,
          ownerId,
          proposedProjectId: null,
          proposedContractId: null,
          proposedDossierId: null,
          dispatchValidatedById: userId,
          dispatchValidatedAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'This courrier was decided on meanwhile — refresh and try again',
        );
      }

      if (dossierId) {
        await markDossierInProgress(tx, dossierId);
      }

      await tx.validation.create({
        data: {
          courrierId: id,
          validatorId: userId,
          decision: ValidationDecision.VALIDE,
          motif: 'Validation du dispatching',
        },
      });

      return tx.courrier.findUniqueOrThrow({
        where: { id },
        include: mailInclude,
      });
    });

    if (updated.ownerId) {
      this.notify(courrier, [updated.ownerId], userId, {
        type: 'COURRIER_TRANSMITTED',
        message: `« ${courrier.subject} » vous a été transmis.`,
      });
    }

    this.recordCourrierEvent(id, 'COURRIER_DISPATCH_VALIDE');
    return formatCourrier(updated);
  }

  // EN_ATTENTE_VALIDATION -> VALIDE; a pending dispatching
  // (EN_ATTENTE_TRANSMISSION) -> TRANSMIS, see validateDispatch.
  async validate(id: string, userId: string) {
    const courrier = await this.database.courrier.findUnique({
      where: { id },
      select: { proposedProjectId: true },
    });
    if (courrier?.proposedProjectId) {
      return this.validateDispatch(id, userId);
    }
    return this.decide(id, userId, ValidationDecision.VALIDE);
  }

  // EN_ATTENTE_VALIDATION -> A_CORRIGER; resubmitted once corrected.
  requestCorrections(id: string, motif: string, userId: string) {
    return this.decide(
      id,
      userId,
      ValidationDecision.CORRECTIONS_DEMANDEES,
      motif,
    );
  }

  // Courriers waiting on the caller's decision.
  async findAwaitingMyValidation(userId: string) {
    const data = await this.database.courrier.findMany({
      where: awaitingValidationBy(userId),
      orderBy: { updatedAt: 'desc' },
      include: mailInclude,
    });
    return data.map(formatCourrier);
  }

  private async decide(
    id: string,
    userId: string,
    decision: ValidationDecision,
    motif?: string,
  ) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.EN_ATTENTE_VALIDATION,
    ]);
    if ((await this.validatorOf(courrier)) !== userId) {
      throw new ForbiddenException(
        "Only this courrier's validator (its dossier's responsible, or the site's) can decide on it",
      );
    }
    const approved = decision === ValidationDecision.VALIDE;
    const updated = await this.database.$transaction(async (tx) => {
      // Guarded on the status read above, so two concurrent decisions
      // can't both land.
      const { count } = await tx.courrier.updateMany({
        where: { id, status: CourrierStatus.EN_ATTENTE_VALIDATION },
        data: {
          status: approved ? CourrierStatus.VALIDE : CourrierStatus.A_CORRIGER,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'This courrier was decided on meanwhile — refresh and try again',
        );
      }
      await tx.validation.create({
        data: { courrierId: id, validatorId: userId, decision, motif },
      });
      return tx.courrier.findUniqueOrThrow({
        where: { id },
        include: mailInclude,
      });
    });
    this.notify(
      courrier,
      [courrier.createdById, updated?.ownerId ?? courrier.ownerId],
      userId,
      {
        type: approved
          ? 'COURRIER_VALIDATED'
          : 'COURRIER_CORRECTIONS_REQUESTED',
        message: approved
          ? `« ${courrier.subject} » a été validé.`
          : `« ${courrier.subject} » doit être corrigé : ${motif}`,
      },
    );
    return formatCourrier(updated);
  }

  private async canDispatch(
    userId: string,
    courrier: {
      dossierId?: string | null;
      dossier?: {
        siteId: string;
        site?: { responsibleId: string | null };
      } | null;
      createdById?: string | null;
    },
  ): Promise<boolean> {
    if (
      await this.rbac.hasGlobalPermission(
        userId,
        PermissionCode.AdminManageUsers,
      )
    ) {
      return true;
    }
    if (
      await this.hasPermissionAtCourrierSite(
        userId,
        PermissionCode.CourrierDispatch,
        courrier,
      )
    ) {
      return true;
    }
    return (await this.siteResponsibleOf(courrier)) === userId;
  }

  // The effet's site is its dossier's, else its registrant's (siteOfEffet).
  // With no site at all, only a global grant counts.
  private async hasPermissionAtCourrierSite(
    userId: string,
    code: PermissionCode,
    courrier: { dossierId?: string | null; createdById?: string | null },
  ) {
    const siteId = await this.siteOfEffet(
      courrier.dossierId ?? null,
      courrier.createdById ?? null,
    );
    return siteId
      ? this.rbac.hasPermissionAtSite(userId, code, siteId)
      : this.rbac.hasGlobalPermission(userId, code);
  }

  // The responsible of the effet's site, if it has one.
  private async siteResponsibleOf(courrier: {
    dossierId?: string | null;
    createdById?: string | null;
  }) {
    const siteId = await this.siteOfEffet(
      courrier.dossierId ?? null,
      courrier.createdById ?? null,
    );
    if (!siteId) return null;
    const site = await this.database.site.findUnique({
      where: { id: siteId },
      select: { responsibleId: true },
    });
    return site?.responsibleId ?? null;
  }

  private async canValidateDispatch(
    userId: string,
    courrier: {
      dossierId?: string | null;
      contractId?: string | null;
      projectId?: string | null;
      proposedDossierId?: string | null;
      proposedContractId?: string | null;
      proposedProjectId?: string | null;
      createdById?: string | null;
    },
  ): Promise<boolean> {
    if (
      await this.rbac.hasGlobalPermission(
        userId,
        PermissionCode.AdminManageUsers,
      )
    ) {
      return true;
    }
    if (
      await this.hasPermissionAtCourrierSite(
        userId,
        PermissionCode.CourrierDispatch,
        courrier,
      )
    ) {
      return true;
    }
    if (
      await this.hasPermissionAtCourrierSite(
        userId,
        PermissionCode.CourrierDispatchValidate,
        courrier,
      )
    ) {
      return true;
    }
    return false;
  }

  // Who is told a dispatching awaits validation: the active users holding
  // the dispatch (or dispatch-validation) permission at the effet's site,
  // or globally.
  private async dispatchValidatorsOf(courrier: {
    dossierId?: string | null;
    createdById?: string | null;
  }) {
    const siteId = await this.siteOfEffet(
      courrier.dossierId ?? null,
      courrier.createdById ?? null,
    );
    const users = await this.database.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        userRoles: {
          some: {
            OR: [{ siteId: null }, ...(siteId ? [{ siteId }] : [])],
            role: {
              rolePermissions: {
                some: {
                  permission: {
                    code: {
                      in: [
                        PermissionCode.CourrierDispatch,
                        PermissionCode.CourrierDispatchValidate,
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  // The rule of awaitingValidationBy, for one courrier.
  private async validatorOf(courrier: {
    dossierId: string | null;
    contractId?: string | null;
    projectId?: string | null;
    proposedDossierId?: string | null;
    proposedContractId?: string | null;
    proposedProjectId?: string | null;
    createdById: string | null;
  }): Promise<string | null> {
    const targetDossierId = courrier.dossierId ?? courrier.proposedDossierId;
    if (targetDossierId) {
      const dossier = await this.database.dossier.findUnique({
        where: { id: targetDossierId },
        select: {
          responsibleId: true,
          contract: { select: { responsibleId: true } },
          site: { select: { responsibleId: true } },
        },
      });
      return (
        dossier?.responsibleId ??
        dossier?.contract?.responsibleId ??
        dossier?.site.responsibleId ??
        null
      );
    }
    const targetContractId = courrier.contractId ?? courrier.proposedContractId;
    if (targetContractId) {
      const contract = await this.database.contract.findUnique({
        where: { id: targetContractId },
        select: {
          responsibleId: true,
          project: { select: { responsibleId: true } },
        },
      });
      return (
        contract?.responsibleId ?? contract?.project?.responsibleId ?? null
      );
    }
    const targetProjectId = courrier.projectId ?? courrier.proposedProjectId;
    if (targetProjectId) {
      const project = await this.database.project.findUnique({
        where: { id: targetProjectId },
        select: { responsibleId: true },
      });
      if (project?.responsibleId) return project.responsibleId;
    }
    if (courrier.createdById) {
      const creator = await this.database.user.findUnique({
        where: { id: courrier.createdById },
        select: { site: { select: { responsibleId: true } } },
      });
      return creator?.site?.responsibleId ?? null;
    }
    return null;
  }

  // Fire-and-forget: a notification failing to write must never fail the
  // transition that triggered it. Nobody is told about their own action.
  private notify(
    courrier: { id: string; dossierId: string | null },
    recipients: (string | null)[],
    actingUserId: string,
    content: { type: string; message: string },
  ) {
    const recipientIds = [
      ...new Set(
        recipients.filter(
          (id): id is string => Boolean(id) && id !== actingUserId,
        ),
      ),
    ];
    if (recipientIds.length === 0) return;
    this.notifications
      .create({
        recipientIds,
        ...content,
        canal: NotificationCanal.IN_APP,
        courrierId: courrier.id,
        dossierId: courrier.dossierId ?? undefined,
      })
      .catch((error: unknown) => {
        console.error('Failed to create courrier notification', error);
      });
  }

  // Person in charge of the courrier ("Affectations"). Settable at creation
  // (CreateMailDto) or later, but only by the courrier's creator, the
  // responsible of the dossier's owning site, or a platform admin.
  async setOwner(id: string, dto: SetOwnerDto, actingUserId: string) {
    const courrier = await this.database.courrier.findUnique({
      where: { id },
      include: { dossier: { select: { site: true } } },
    });
    if (!courrier) {
      throw new NotFoundException(`Courrier ${id} not found`);
    }
    const isCreator = courrier.createdById === actingUserId;
    const isSiteAdmin = courrier.dossier?.site.responsibleId === actingUserId;
    const isPlatformAdmin = await this.rbac.hasGlobalPermission(
      actingUserId,
      PermissionCode.AdminManageUsers,
    );
    if (!isCreator && !isSiteAdmin && !isPlatformAdmin) {
      throw new ForbiddenException(
        'Only the creator, the site responsible, or a platform admin can assign who is in charge of this courrier',
      );
    }
    return this.database.courrier.update({
      where: { id },
      data: { ownerId: dto.ownerId },
      include: mailInclude,
    });
  }

  // Sortant: VALIDE -> ENVOYE.
  async send(id: string) {
    const courrier = await this.requireStatus(id, [CourrierStatus.VALIDE]);
    const result = await this.database.courrier.update({
      where: { id: courrier.id },
      data: { status: CourrierStatus.ENVOYE, sentAt: new Date() },
      include: mailInclude,
    });
    this.recordCourrierEvent(id, 'COURRIER_ENVOYE');
    return result;
  }

  async cancel(id: string) {
    const courrier = await this.requireStatus(id, [
      ...SORTANT_OPEN_STATUSES,
      ...ENTRANT_OPEN_STATUSES,
      // An entrant whose dispatching awaits validation.
      CourrierStatus.EN_ATTENTE_TRANSMISSION,
    ]);
    return this.setStatus(courrier.id, CourrierStatus.ANNULE);
  }

  // Entrant: mark a received courrier as fully treated (10.2.4.8).
  async close(id: string) {
    const courrier = await this.requireStatus(id, ENTRANT_CLOSABLE_STATUSES);
    if (courrier.direction !== CourrierDirection.ENTRANT) {
      throw new BadRequestException('Only an incoming courrier can be closed');
    }
    return this.setStatus(courrier.id, CourrierStatus.CLOTURE);
  }

  // Entrant: a treated courrier can be archived, mirroring Dossier's
  // close-before-archive rule.
  async archive(id: string) {
    const courrier = await this.requireStatus(id, [CourrierStatus.CLOTURE]);
    return this.setStatus(courrier.id, CourrierStatus.ARCHIVE);
  }

  // Inverse of archive() — back to CLOTURE, mirroring Dossier.unarchive().
  async unarchive(id: string) {
    const courrier = await this.requireStatus(id, [CourrierStatus.ARCHIVE]);
    return this.setStatus(courrier.id, CourrierStatus.CLOTURE);
  }

  // A physical effet expected back (returnExpected) is handed back: the
  // return is recorded once.
  async markReturned(id: string) {
    const courrier = await this.findOne(id);
    if (!courrier.returnExpected) {
      throw new BadRequestException('This effet is not expected back');
    }
    if (courrier.returnedAt) {
      throw new BadRequestException(
        `This effet was already returned on ${courrier.returnedAt.toISOString()}`,
      );
    }
    return this.database.courrier.update({
      where: { id },
      data: { returnedAt: new Date() },
      include: mailInclude,
    });
  }

  // The global "Courrier" type, given to effets registered without a type.
  private async defaultEffetTypeId(): Promise<string | null> {
    const type = await this.database.effetType.findFirst({
      where: { name: DEFAULT_EFFET_TYPE, siteId: null },
      select: { id: true },
    });
    return type?.id ?? null;
  }

  // The site an effet belongs to: its dossier's, or — registered without
  // one — its registrant's.
  private async siteOfEffet(
    dossierId: string | null,
    createdById: string | null,
  ): Promise<string | null> {
    if (dossierId) {
      const dossier = await this.database.dossier.findUnique({
        where: { id: dossierId },
        select: { siteId: true },
      });
      return dossier?.siteId ?? null;
    }
    if (!createdById) return null;
    const registrant = await this.database.user.findUnique({
      where: { id: createdById },
      select: { siteId: true },
    });
    return registrant?.siteId ?? null;
  }

  // Type, physical fields and bordereau, checked before anything is
  // written. `current` is the effet being updated (absent at creation):
  // what the request leaves out keeps its current value. Returns the type
  // to store.
  private async checkEffetFields(
    input: EffetFields,
    effet: { direction: CourrierDirection; siteId: string | null },
    current?: EffetFields & { id: string; typeId: string | null },
  ): Promise<string | null> {
    const typeId =
      input.typeId ?? current?.typeId ?? (await this.defaultEffetTypeId());
    const type = typeId
      ? await this.database.effetType.findUnique({ where: { id: typeId } })
      : null;
    if (typeId && !type) {
      throw new BadRequestException(`Unknown effet type ${typeId}`);
    }
    if (type) {
      const chosen =
        input.typeId !== undefined && input.typeId !== current?.typeId;
      if (chosen && !type.active) {
        throw new BadRequestException(
          `The effet type "${type.name}" is inactive and can no longer be chosen`,
        );
      }
      if (type.siteId && type.siteId !== effet.siteId) {
        throw new BadRequestException(
          `The effet type "${type.name}" belongs to another site`,
        );
      }
    }

    // Physical fields only on a physical effet.
    if (!type?.isPhysical) {
      const filled = PHYSICAL_FIELDS.filter((field) => {
        const value =
          input[field] !== undefined ? input[field] : current?.[field];
        return (
          value !== undefined &&
          value !== null &&
          value !== false &&
          value !== ''
        );
      });
      if (filled.length) {
        throw new BadRequestException(
          `${filled.join(', ')} can only be recorded on a physical effet — pick a physical type, or leave them empty`,
        );
      }
    }

    // A bordereau lists effets; it is never listed itself.
    const parentId =
      input.parentId !== undefined
        ? input.parentId
        : (current?.parentId ?? null);
    if (parentId) {
      if (parentId === current?.id) {
        throw new BadRequestException('An effet cannot list itself');
      }
      if (type?.canListEffets) {
        throw new BadRequestException(
          'A bordereau cannot be listed in another bordereau',
        );
      }
      const parent = await this.database.courrier.findUnique({
        where: { id: parentId },
        select: {
          direction: true,
          parentId: true,
          type: { select: { canListEffets: true } },
        },
      });
      if (!parent) {
        throw new BadRequestException(`Effet ${parentId} not found`);
      }
      if (!parent.type?.canListEffets || parent.parentId) {
        throw new BadRequestException(
          'parentId must be a bordereau (an effet whose type can list effets)',
        );
      }
      if (parent.direction !== effet.direction) {
        throw new BadRequestException(
          'An effet and its bordereau must go the same way (both entrant or both sortant)',
        );
      }
    }
    if (current && !type?.canListEffets) {
      const listed = await this.database.courrier.count({
        where: { parentId: current.id },
      });
      if (listed > 0) {
        throw new BadRequestException(
          `This bordereau lists ${listed} effet(s): its type must stay one that can list effets`,
        );
      }
    }
    return typeId ?? null;
  }

  // RG-COU-007: decharge can only be handed once the courrier is actually
  // registered.
  async discharge(id: string, dischargedById: string) {
    const courrier = await this.findOne(id);
    if (courrier.status === CourrierStatus.RECU) {
      throw new BadRequestException(
        'Courrier must be registered before a décharge can be issued',
      );
    }
    return this.database.courrier.update({
      where: { id },
      data: {
        dischargedAt: new Date(),
        dischargedById,
        dischargedStamp: true,
      },
      include: mailInclude,
    });
  }

  // Independent from the dossier's own access list (see CourrierAccess in
  // schema.prisma) — a user with access to the dossier is not automatically
  // granted access to this courrier, and vice versa.
  async getAccess(id: string) {
    await this.findOne(id);
    return this.database.courrierAccess.findMany({
      where: { courrierId: id },
      include: courrierAccessInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async setAccess(id: string, dto: SetAccessDto) {
    await this.findOne(id);
    const userIds = dto.entries.map((entry) => entry.userId);

    await this.database.$transaction([
      this.database.courrierAccess.deleteMany({
        where: {
          courrierId: id,
          userId: { notIn: userIds.length > 0 ? userIds : ['__none__'] },
        },
      }),
      ...dto.entries.map((entry) =>
        this.database.courrierAccess.upsert({
          where: {
            courrierId_userId: { courrierId: id, userId: entry.userId },
          },
          create: {
            courrierId: id,
            userId: entry.userId,
            canView: entry.canView,
            canEdit: entry.canEdit,
          },
          update: { canView: entry.canView, canEdit: entry.canEdit },
        }),
      ),
    ]);

    return this.getAccess(id);
  }

  // The sites where the caller may read courriers: as dossiers, and as
  // registrants (for entrants not yet attached to a dossier).
  // An effet the user may not see (visibleMailsWhere) is reported as not
  // found, like one that doesn't exist.
  private async assertVisible(id: string, userId: string) {
    const courrier = await this.database.courrier.findUnique({
      where: { id },
      select: { direction: true },
    });
    const visible =
      courrier &&
      (await this.database.courrier.count({
        where: {
          id,
          ...visibleMailsWhere(
            courrier.direction,
            userId,
            await this.readableSites(userId),
          ),
        },
      }));
    if (!visible) {
      throw new NotFoundException(`Courrier ${id} not found`);
    }
  }

  private async readableSites(userId: string): Promise<ReadableSites> {
    const [dossier, registrant] = await Promise.all([
      this.rbac.siteFilter(
        userId,
        PermissionCode.CourrierRead,
        (siteId): Prisma.DossierWhereInput => ({ siteId }),
      ),
      this.rbac.siteFilter(
        userId,
        PermissionCode.CourrierRead,
        (siteId): Prisma.UserWhereInput => ({ siteId }),
      ),
    ]);
    return { dossier, registrant };
  }

  // An entrant registered without its dossier belongs to the registrant's
  // site — so the registrant needs one.
  private async assertRegistrantHasSite(userId: string) {
    const registrant = await this.database.user.findUnique({
      where: { id: userId },
      select: { siteId: true },
    });
    if (!registrant?.siteId) {
      throw new BadRequestException(
        'dossierId is required: you belong to no site the courrier could be registered on',
      );
    }
  }

  private async requireStatus(id: string, allowed: CourrierStatus[]) {
    const courrier = await this.findOne(id);
    if (!allowed.includes(courrier.status)) {
      throw new BadRequestException(
        `Courrier is ${courrier.status}, expected one of: ${allowed.join(', ')}`,
      );
    }
    return courrier;
  }

  private async setStatus(id: string, status: CourrierStatus) {
    const updated = await this.database.courrier.update({
      where: { id },
      data: { status },
      include: mailInclude,
    });
    this.recordCourrierEvent(id, `COURRIER_${status}`);
    return updated;
  }

  private async ensureEditable(id: string) {
    const courrier = await this.findOne(id);
    if (!EDITABLE_STATUSES.includes(courrier.status)) {
      throw new BadRequestException(
        `Courrier is ${courrier.status} and can no longer be edited or removed`,
      );
    }
    return courrier;
  }

  /** Fire-and-forget audit entry scoped to a courrier. */
  private recordCourrierEvent(
    id: string,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    this.activity
      .tryRecord({ action, entityType: 'Courrier', entityId: id, metadata })
      .catch(() => undefined);
  }

  /**
   * GET /courriers/:id/historique — paginated activity log for one courrier.
   * Returns the same shape as other /historique endpoints: { data, total, skip, take }.
   */
  async historique(id: string, userId: string, skip = 0, take = 20) {
    await this.assertVisible(id, userId);
    const where = { entityId: id, entityType: 'Courrier' };
    const [data, total] = await this.database.$transaction([
      this.database.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.activityLog.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  /**
   * Export incoming courriers as CSV — accepts the same filters as findIncoming.
   * Returns a Buffer (UTF-8 CSV with BOM for Excel compatibility).
   */
  async exportIncoming(
    query: FindIncomingMailsQueryDto,
    userId: string,
  ): Promise<Buffer> {
    const visible = visibleMailsWhere(
      CourrierDirection.ENTRANT,
      userId,
      await this.readableSites(userId),
    );
    const received = dateRange(query.receivedFrom, query.receivedTo);
    const tabStatuses = resolveIncomingTabStatuses(query.tab);
    const where: Prisma.CourrierWhereInput = {
      ...visible,
      status: query.status,
      dossierId: query.dossierId,
      correspondentId: query.correspondentId,
      natureId: query.natureId,
      typeId: query.typeId,
      ownerId: query.ownerId,
      AND: [
        searchWhere(query.search),
        projectOrContractWhere(query),
        tabStatuses ? { status: { in: [...tabStatuses] } } : undefined,
        received && {
          OR: [
            { receivedAt: received },
            { receivedAt: null, createdAt: received },
          ],
        },
      ].filter((f) => f !== undefined),
    };

    const rows = await this.database.courrier.findMany({
      where,
      include: {
        correspondent: { select: { name: true } },
        nature: { select: { name: true } },
        owner: { select: { name: true } },
        dossier: { select: { number: true, title: true } },
      },
      orderBy:
        query.sort === IncomingMailSort.Oldest
          ? [{ receivedAt: 'asc' }, { createdAt: 'asc' }]
          : [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const headers = [
      'Numéro',
      'Objet',
      'Statut',
      'Correspondant',
      'Nature',
      'Dossier',
      'Responsable',
      'Date réception',
      'Date enregistrement',
    ];

    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.number,
          r.subject,
          r.status,
          r.correspondent?.name ?? '',
          r.nature?.name ?? '',
          r.dossier ? `${r.dossier.number} – ${r.dossier.title}` : '',
          r.owner?.name ?? '',
          r.receivedAt ? r.receivedAt.toISOString().slice(0, 10) : '',
          r.createdAt.toISOString().slice(0, 10),
        ]
          .map(escape)
          .join(','),
      ),
    ];

    // UTF-8 BOM so Excel opens it correctly without import wizard.
    return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf-8');
  }
}

// Given to effets registered without a type (a global type, see the
// effet_types migration).
const DEFAULT_EFFET_TYPE = 'Courrier';

// Only recorded on a physical effet (EffetType.isPhysical).
const PHYSICAL_FIELDS = [
  'quantity',
  'physicalDescription',
  'conditionOnReceipt',
  'packaging',
  'storageLocation',
  'returnExpected',
] as const;

type EffetFields = {
  typeId?: string | null;
  parentId?: string | null;
  quantity?: number | null;
  physicalDescription?: string | null;
  conditionOnReceipt?: string | null;
  packaging?: string | null;
  storageLocation?: string | null;
  returnExpected?: boolean | null;
};

// Statuses an entrant can be transmitted from.
const TRANSMITTABLE_STATUSES: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
];

// Transmitting hands an entrant to its dossier's responsible: only an
// entrant, already attached to its dossier, not yet transmitted. `status`
// is omitted when the caller checks it itself (requireStatus) or the
// courrier is being created.
function assertTransmittable(
  direction: CourrierDirection,
  dossierId: string | null,
  status?: CourrierStatus,
) {
  if (direction !== CourrierDirection.ENTRANT) {
    throw new BadRequestException('Only an entrant can be transmitted');
  }
  if (!dossierId) {
    throw new BadRequestException(
      'Attach this courrier to its dossier before transmitting it',
    );
  }
  if (status && !TRANSMITTABLE_STATUSES.includes(status)) {
    throw new BadRequestException(
      `Courrier is ${status} and has already been transmitted`,
    );
  }
}

type ReadableSites = {
  dossier: Prisma.DossierWhereInput;
  registrant: Prisma.UserWhereInput;
};

// Incoming/outgoing courriers the caller may see: those in dossiers visible
// to them (see visibleDossierWhere) on the sites they may read courriers at,
// their own drafts not yet attached to a dossier, and the entrants
// registered on those sites still waiting for their dossier — someone has
// to see them to attach it.
function visibleMailsWhere(
  direction: CourrierDirection,
  userId: string,
  sites: ReadableSites,
): Prisma.CourrierWhereInput {
  return {
    direction,
    OR: [
      { dossier: { AND: [visibleDossierWhere(userId), sites.dossier] } },
      { dossierId: null, createdById: userId },
      // Whoever it is entrusted to — its designated responsible (e.g. a
      // contract's, when dispatched to a contract) and its supervisor —
      // sees it, wherever it sits.
      { ownerId: userId },
      { supervisorId: userId },
      ...(direction === CourrierDirection.ENTRANT
        ? [{ dossierId: null, createdBy: sites.registrant }]
        : []),
    ],
  };
}

// A courrier is in a project or under a contract directly (dispatched to
// it) or through its dossier.
export function projectOrContractWhere(query: {
  projectId?: string;
  contractId?: string;
}): Prisma.CourrierWhereInput | undefined {
  if (!query.projectId && !query.contractId) return undefined;
  return {
    AND: [
      query.projectId && {
        OR: [
          { projectId: query.projectId },
          { dossier: { projectId: query.projectId } },
        ],
      },
      query.contractId && {
        OR: [
          { contractId: query.contractId },
          { dossier: { contractId: query.contractId } },
        ],
      },
    ].filter((filter) => !!filter),
  };
}

// Free text against the subject, internal number or printed reference.
function searchWhere(search?: string): Prisma.CourrierWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: 'insensitive' as const };
  return {
    OR: [{ subject: contains }, { number: contains }, { reference: contains }],
  };
}
