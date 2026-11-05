import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  CourrierDirection,
  CourrierStatus,
  DossierStatus,
  InstructionStatus,
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
import {
  assertCanalOfSite,
  assertProjectOfSite,
} from '../../common/utils/site-referentials';
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
  OUTGOING_TABS,
} from './dto/find-outgoing-mails.query.dto';
import { renderOutgoingPdf } from './outgoing-pdf';
import { LIVE_ANALYSIS_SHEET_WHERE } from '../../analysis/live-sheet';
import { renderBordereauPdf } from './bordereau-pdf';
import { CloseMailDto } from './dto/close-mail.dto';
import { DischargeMailDto } from './dto/discharge-mail.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { SignMailDto } from './dto/sign-mail.dto';
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
  // Who wrote it and who approved it, readable by whoever sees the effet.
  // Its registrant's site is the effet's site until it has a dossier.
  createdBy: { select: { id: true, name: true, siteId: true } },
  approvedBy: { select: { id: true, name: true } },
  // An entrant handed over / a sortant sent; a sortant's signature and
  // discharge, with their scans.
  transmittedBy: { select: { id: true, name: true } },
  signedBy: { select: { id: true, name: true } },
  signedDocument: true,
  dischargeDocument: true,
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
      siteId: true,
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

  // The effet's site: its dossier's, else its registrant's (see
  // siteOfEffet) — the site its supervisor and agents are picked from.
  const { dossier, createdBy } = courrier as {
    dossier?: { siteId?: string } | null;
    createdBy?: { siteId?: string | null } | null;
  };
  const siteId =
    dossier !== undefined || createdBy !== undefined
      ? (dossier?.siteId ?? createdBy?.siteId ?? null)
      : undefined;

  return {
    ...courrier,
    ...(siteId !== undefined ? { siteId } : {}),
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
  CourrierStatus.AFFECTE,
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

// A sortant authorized to go out, and the steps after: it has its SOR
// reference and its PDF. VALIDE -> SIGNE -> ENVOYE -> DECHARGE -> ARCHIVE
// (PRET_A_ENVOYER: legacy, sendable like SIGNE).
const SORTANT_AUTHORIZED_STATUSES: CourrierStatus[] = [
  CourrierStatus.VALIDE,
  CourrierStatus.SIGNE,
  CourrierStatus.PRET_A_ENVOYER,
  CourrierStatus.ENVOYE,
  CourrierStatus.DECHARGE,
];

// What archive() accepts, per direction: an entrant once treated, a
// sortant once discharged or cancelled.
const ARCHIVABLE_STATUSES: Record<CourrierDirection, CourrierStatus[]> = {
  [CourrierDirection.ENTRANT]: [CourrierStatus.CLOTURE],
  [CourrierDirection.SORTANT]: [CourrierStatus.DECHARGE, CourrierStatus.ANNULE],
};

// A sortant can be sent once signed.
const SENDABLE_STATUSES: CourrierStatus[] = [
  CourrierStatus.SIGNE,
  CourrierStatus.PRET_A_ENVOYER,
];

// An instruction still to be done: cancelled when its effet is closed.
const INSTRUCTION_DONE_STATUSES: InstructionStatus[] = [
  InstructionStatus.TERMINEE,
  InstructionStatus.ANNULEE,
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

// The next outgoing reference of the year: SOR-AAAA-NNNNNN, numbered per
// year by courrier_sequence (one atomic increment, inside the caller's
// transaction).
async function nextOutgoingReference(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<string> {
  const year = now.getFullYear();
  const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "courrier_sequence" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "courrier_sequence"."last" + 1
    RETURNING "last"`;
  return `SOR-${year}-${String(last).padStart(6, '0')}`;
}

// The next bordereau de transmission number: BT-AAAA-NNNNNN, numbered per
// year by bordereau_sequence, like the outgoing references.
async function nextBordereauNumber(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<string> {
  const year = now.getFullYear();
  const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "bordereau_sequence" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "bordereau_sequence"."last" + 1
    RETURNING "last"`;
  return `BT-${year}-${String(last).padStart(6, '0')}`;
}

// A CSV file: UTF-8 with BOM so Excel opens it without its import wizard.
type CsvCell = string | number | null | undefined;
function toCsv(headers: string[], rows: CsvCell[][]): Buffer {
  const escape = (value: CsvCell) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers, ...rows].map((row) => row.map(escape).join(','));
  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf-8');
}

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
    const siteId = await this.siteOfEffet(dto.dossierId ?? null, createdById);
    if (dto.correspondentId) {
      await assertCorrespondentActive(
        this.database,
        dto.correspondentId,
        siteId,
      );
    }
    if (dto.canalId) {
      await assertCanalOfSite(this.database, dto.canalId, siteId);
    }
    if (dto.respondsToId) {
      await this.assertRespondsToValid(dto.respondsToId);
    }
    const typeId = await this.checkEffetFields(dto, {
      direction: dto.direction,
      siteId,
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
    const draft = await createWithUniqueReference('M', (number) =>
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
    this.recordCourrierEvent(draft.id, 'COURRIER_BROUILLON_CREE', {
      subject: draft.subject,
    });
    return formatCourrier(draft);
  }

  async findAll(query: FindMailsQueryDto, userId: string) {
    const sites = await this.readableSites(userId);
    const visible: Prisma.CourrierWhereInput = query.direction
      ? visibleMailsWhere(query.direction, userId, sites)
      : {
          OR: [
            visibleMailsWhere(CourrierDirection.ENTRANT, userId, sites),
            visibleMailsWhere(CourrierDirection.SORTANT, userId, sites),
          ],
        };
    const where: Prisma.CourrierWhereInput = {
      dossierId: query.dossierId,
      direction: query.direction,
      status: query.status,
      correspondentId: query.correspondentId,
      ownerId: query.ownerId,
      typeId: query.typeId,
      AND: [visible, projectOrContractWhere(query)].filter(
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
    const where = incomingWhere(query, visible);

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
      affected,
      assigned,
      inTreatment,
      closed,
      archivedCount,
      others,
      dispatched,
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
        where: inStatuses(INCOMING_STATUS_TABS.affected),
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
      // The same effets as the dispatched tab lists.
      this.database.courrier.count({
        where: {
          ...inStatuses(INCOMING_STATUS_TABS.dispatched),
          AND: [DISPATCH_TARGET_OPEN],
        },
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
        affected,
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
          affected,
          assigned,
          inTreatment,
          closed,
          archived: archivedCount,
          others,
          // Overlaps affected, assigned and inTreatment.
          dispatched,
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
    const { visible, where } = await this.outgoingWhere(query, userId);

    const [data, total, byStatus] = await Promise.all([
      this.database.courrier.findMany({
        where,
        include: mailInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.courrier.count({ where }),
      this.database.courrier.groupBy({
        by: ['status'],
        where: visible,
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(
      byStatus.map((group) => [group.status, group._count._all]),
    );
    const inGroup = (statuses: readonly CourrierStatus[]) =>
      statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
    const allCount = inGroup([...counts.keys()]);

    return {
      data: await this.withApprovers(data.map(formatCourrier)),
      total,
      skip,
      take,
      metrics: {
        pending: inGroup(OUTGOING_STATUS_GROUPS.pending),
        approved: inGroup(OUTGOING_STATUS_GROUPS.approved),
        rejected: inGroup(OUTGOING_STATUS_GROUPS.rejected),
        total: allCount,
        // Ignore the tab and the filters, like the counts above.
        byTab: {
          all: allCount,
          ...Object.fromEntries(
            OUTGOING_TABS.map((tab) => [
              tab,
              inGroup(OUTGOING_STATUS_GROUPS[tab]),
            ]),
          ),
        } as Record<'all' | (typeof OUTGOING_TABS)[number], number>,
      },
    };
  }

  // The sortants the caller sees (`visible`), and among them those matching
  // the list's filters (`where`) — shared by the list and its export.
  private async outgoingWhere(
    query: FindOutgoingMailsQueryDto,
    userId: string,
  ) {
    const visible = visibleMailsWhere(
      CourrierDirection.SORTANT,
      userId,
      await this.readableSites(userId),
    );
    const where: Prisma.CourrierWhereInput = {
      ...visible,
      status: query.status,
      dossierId: query.dossierId,
      correspondentId: query.correspondentId,
      natureId: query.natureId,
      typeId: query.typeId,
      ownerId: query.ownerId,
      createdAt: dateRange(query.createdFrom, query.createdTo),
      AND: [
        searchWhere(query.search),
        projectOrContractWhere(query),
        query.group && {
          status: { in: [...OUTGOING_STATUS_GROUPS[query.group]] },
        },
      ].filter((filter) => filter !== undefined),
    };
    return { visible, where };
  }

  // Each effet with `approver`: who must approve it (validatorOf), as
  // { id, name }, or null when nobody can.
  private async withApprovers<
    T extends Parameters<MailService['validatorOf']>[0],
  >(courriers: T[]) {
    const byTarget = new Map<string, Promise<string | null>>();
    const approverIds = await Promise.all(
      courriers.map((courrier) => {
        const key = [
          courrier.dossierId,
          courrier.contractId,
          courrier.projectId,
          courrier.proposedDossierId,
          courrier.proposedContractId,
          courrier.proposedProjectId,
          courrier.createdById,
        ].join('|');
        if (!byTarget.has(key)) byTarget.set(key, this.validatorOf(courrier));
        return byTarget.get(key)!;
      }),
    );
    const ids = [
      ...new Set(approverIds.filter((id): id is string => Boolean(id))),
    ];
    const users = ids.length
      ? await this.database.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return courriers.map((courrier, index) => ({
      ...courrier,
      approver: byId.get(approverIds[index] ?? '') ?? null,
    }));
  }

  // GET /courriers/:id: the effet with who must approve it.
  // The effet page: only an effet the caller would see in their lists
  // (their sites', a dossier open to them, or entrusted to them) — else
  // 404, as if it didn't exist.
  async findOneDetailed(id: string, userId?: string) {
    if (userId) await this.assertVisible(id, userId);
    const [courrier] = await this.withApprovers([await this.findOne(id)]);
    return courrier;
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
    const siteId = await this.siteOfEffet(
      dto.dossierId ?? courrier.dossierId,
      courrier.createdById,
    );
    // Its canal and correspondent stay those of its site — checked when
    // they change, or when it moves to another dossier.
    const correspondentId =
      dto.correspondentId !== undefined
        ? dto.correspondentId
        : courrier.correspondentId;
    if (
      correspondentId &&
      (correspondentId !== courrier.correspondentId || dossierChanged)
    ) {
      await assertCorrespondentActive(this.database, correspondentId, siteId);
    }
    const canalId = dto.canalId !== undefined ? dto.canalId : courrier.canalId;
    if (canalId && (canalId !== courrier.canalId || dossierChanged)) {
      await assertCanalOfSite(this.database, canalId, siteId);
    }
    if (dto.respondsToId && dto.respondsToId !== courrier.respondsToId) {
      await this.assertRespondsToValid(dto.respondsToId, id);
    }
    const typeId = await this.checkEffetFields(
      dto,
      {
        direction: courrier.direction,
        siteId,
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

  // Legacy — the front no longer calls it: dispatching transmits at once.
  // Entrant: AFFECTE (or registered with its dossier) -> TRANSMIS
  // (10.2.4.7 — handed to its designated responsible for treatment), so its
  // dossier or contract must be known by then. Its dispatching can't be
  // changed any more. The responsible is told, so nothing waits unnoticed.
  async transmit(id: string, actingUserId: string) {
    const courrier = await this.requireStatus(id, TRANSMITTABLE_STATUSES);
    assertTransmittable(
      courrier.direction,
      courrier.dossierId ?? courrier.contractId,
    );
    const updated = await this.setStatus(courrier.id, CourrierStatus.TRANSMIS, {
      data: { transmittedAt: new Date(), transmittedById: actingUserId },
    });
    await this.notifyTransmitted(courrier, actingUserId);
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
      { data: { submittedAt: new Date() } },
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
   * - With dispatch permission: status -> TRANSMIS at once (transmittedAt/By set),
   *   ownerId = designated responsible, who is notified.
   * - Without dispatch permission: status -> EN_ATTENTE_TRANSMISSION, proposal is stored.
   * - Allowed from RECU or ENREGISTRE. Also allowed from EN_ATTENTE_TRANSMISSION, AFFECTE
   *   or TRANSMIS for users with permission, as long as no instruction exists
   *   (reassignment). Otherwise 409 Conflict.
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

    // Only to a project of the effet's site.
    await assertProjectOfSite(
      this.database,
      dto.projectId,
      await this.siteOfEffet(courrier.dossierId, courrier.createdById),
    );
    const hasPermission = await this.canDispatch(userId, courrier);
    const status = courrier.status;

    const isInitial =
      status === CourrierStatus.RECU || status === CourrierStatus.ENREGISTRE;
    // A dispatched effet is transmitted at once (no AFFECTE step any more):
    // its dispatching can still be corrected until a first instruction.
    const isReassignable =
      status === CourrierStatus.EN_ATTENTE_TRANSMISSION ||
      status === CourrierStatus.AFFECTE ||
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
          transmittedAt: now,
          transmittedById: userId,
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

      this.recordCourrierEvent(id, 'COURRIER_DISPATCHE', {
        projectId: dto.projectId,
      });
      await this.notifyTransmitted(updated, userId);
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

      const now = new Date();
      const { count } = await tx.courrier.updateMany({
        where: { id, status: CourrierStatus.EN_ATTENTE_TRANSMISSION },
        data: {
          status: CourrierStatus.TRANSMIS,
          transmittedAt: now,
          transmittedById: userId,
          projectId,
          contractId,
          dossierId,
          ownerId,
          proposedProjectId: null,
          proposedContractId: null,
          proposedDossierId: null,
          dispatchValidatedById: userId,
          dispatchValidatedAt: now,
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

    this.recordCourrierEvent(id, 'COURRIER_DISPATCH_VALIDE');
    await this.notifyTransmitted(updated, userId);
    return formatCourrier(updated);
  }

  // Tells the designated responsible (else the validator of its dossier or
  // contract) that a dispatched effet was handed to them.
  private async notifyTransmitted(
    courrier: Parameters<MailService['validatorOf']>[0] & {
      id: string;
      ownerId: string | null;
      subject: string;
    },
    actingUserId: string,
  ) {
    this.notify(
      courrier,
      [courrier.ownerId ?? (await this.validatorOf(courrier))],
      actingUserId,
      {
        type: 'COURRIER_TRANSMITTED',
        message: `« ${courrier.subject} » vous a été transmis.`,
      },
    );
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
    return this.withApprovers(data.map(formatCourrier));
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
      const now = new Date();
      const { count } = await tx.courrier.updateMany({
        where: { id, status: CourrierStatus.EN_ATTENTE_VALIDATION },
        data: approved
          ? {
              status: CourrierStatus.VALIDE,
              approvedAt: now,
              approvedById: userId,
            }
          : { status: CourrierStatus.A_CORRIGER },
      });
      if (count === 0) {
        throw new ConflictException(
          'This courrier was decided on meanwhile — refresh and try again',
        );
      }
      // An approved sortant gets its outgoing reference — rolled back with
      // the rest if anything below fails.
      if (approved && courrier.direction === CourrierDirection.SORTANT) {
        await tx.courrier.update({
          where: { id },
          data: { reference: await nextOutgoingReference(tx, now) },
        });
      }
      await tx.validation.create({
        data: { courrierId: id, validatorId: userId, decision, motif },
      });
      return tx.courrier.findUniqueOrThrow({
        where: { id },
        include: mailInclude,
      });
    });
    this.recordCourrierEvent(
      id,
      approved ? 'COURRIER_VALIDE' : 'COURRIER_CORRECTIONS_DEMANDEES',
      approved ? { reference: updated?.reference } : { motif },
    );
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
  /**
   * Closing or archiving an effet (and taking it out of the archives) is
   * for those answering for it: its designated responsible, its supervisor
   * (a sortant: also its author), its site's responsible, a platform user
   * administrator — or whoever holds `permission` (COURRIER_CLOSE,
   * COURRIER_ARCHIVE) at its site. Merely seeing it is not enough: closing
   * an entrant cancels its open tasks.
   */
  private async assertMayConclude(
    courrier: {
      direction: CourrierDirection;
      ownerId?: string | null;
      supervisorId?: string | null;
      dossierId?: string | null;
      createdById?: string | null;
    },
    userId: string,
    permission: PermissionCode,
  ) {
    if (courrier.ownerId === userId || courrier.supervisorId === userId) {
      return;
    }
    if (
      courrier.direction === CourrierDirection.SORTANT &&
      courrier.createdById === userId
    ) {
      return;
    }
    if ((await this.siteResponsibleOf(courrier)) === userId) return;
    const siteId = await this.siteOfEffet(
      courrier.dossierId ?? null,
      courrier.createdById ?? null,
    );
    const sites = await this.rbac.sitesWithPermission(userId, permission);
    if (sites === 'ALL' || (siteId && sites.includes(siteId))) return;
    if (
      await this.rbac.hasGlobalPermission(
        userId,
        PermissionCode.AdminManageUsers,
      )
    ) {
      return;
    }
    throw new ForbiddenException(
      `Only its designated responsible, its supervisor, its site's responsible, an administrator or a holder of ${permission} can do this`,
    );
  }

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

  // Sortant: VALIDE -> SIGNE, with its signed scan, its signatory and the
  // date of signature.
  async sign(
    id: string,
    dto: SignMailDto,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    const courrier = await this.requireSortant(id, [CourrierStatus.VALIDE]);
    if (!file) {
      throw new BadRequestException('file (the signed scan) is required');
    }
    const signatory = await this.database.user.findUnique({
      where: { id: dto.signatoryId },
      select: { status: true },
    });
    if (signatory?.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        `signatoryId ${dto.signatoryId} is not an active user`,
      );
    }
    const updated = await this.withUploadedDocument(
      courrier.id,
      file,
      userId,
      'Effet signé',
      (tx, documentId) =>
        tx.courrier.updateMany({
          where: { id, status: CourrierStatus.VALIDE },
          data: {
            status: CourrierStatus.SIGNE,
            signedAt: new Date(dto.signedAt),
            signedById: dto.signatoryId,
            signedDocumentId: documentId,
          },
        }),
    );
    this.recordCourrierEvent(id, 'COURRIER_SIGNE', {
      signatoryId: dto.signatoryId,
      signedAt: dto.signedAt,
    });
    return formatCourrier(updated);
  }

  // Sortant: SIGNE -> ENVOYE, under the year's next bordereau de
  // transmission (BT-AAAA-NNNNNN).
  async send(id: string, dto: SendMailDto, userId: string) {
    const sortant = await this.requireSortant(id, SENDABLE_STATUSES);
    const canal = await assertCanalOfSite(
      this.database,
      dto.canalId,
      await this.siteOfEffet(sortant.dossierId, sortant.createdById),
    );
    const transmittedAt = new Date(dto.transmittedAt);
    const updated = await this.database.$transaction(async (tx) => {
      const { count } = await tx.courrier.updateMany({
        where: { id, status: { in: SENDABLE_STATUSES } },
        data: {
          status: CourrierStatus.ENVOYE,
          bordereauNumber: await nextBordereauNumber(tx, new Date()),
          canalId: dto.canalId,
          transmissionMode: canal.name,
          transmissionRecipient: dto.recipient,
          transmittedAt,
          transmittedById: userId,
          sentAt: transmittedAt,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'This courrier was sent meanwhile — refresh and try again',
        );
      }
      return tx.courrier.findUniqueOrThrow({
        where: { id },
        include: mailInclude,
      });
    });
    this.recordCourrierEvent(id, 'COURRIER_ENVOYE', {
      reference: updated.bordereauNumber,
      recipient: dto.recipient,
      mode: canal.name,
    });
    return formatCourrier(updated);
  }

  // The bordereau de transmission (model S·12) of a sent sortant.
  async bordereauPdf(id: string, userId: string) {
    await this.assertVisible(id, userId);
    const courrier = await this.database.courrier.findUniqueOrThrow({
      where: { id },
      include: {
        correspondent: { select: { name: true } },
        transmittedBy: {
          select: { name: true, site: { select: { name: true } } },
        },
        createdBy: { select: { name: true, site: { select: { name: true } } } },
        children: {
          select: {
            number: true,
            reference: true,
            subject: true,
            _count: { select: { documents: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { documents: true } },
      },
    });
    if (!courrier.bordereauNumber || !courrier.transmittedAt) {
      throw new BadRequestException(
        'Only a sent sortant (ENVOYE, DECHARGE) has a bordereau de transmission',
      );
    }
    const sender = courrier.transmittedBy ?? courrier.createdBy;
    const pdf = await renderBordereauPdf({
      bordereauNumber: courrier.bordereauNumber,
      transmittedAt: courrier.transmittedAt,
      transmissionMode: courrier.transmissionMode,
      issuer: { name: sender?.name ?? null, site: sender?.site?.name ?? null },
      recipient: {
        correspondent: courrier.correspondent?.name ?? null,
        person: courrier.transmissionRecipient,
      },
      rows: [courrier, ...courrier.children].map((row) => ({
        reference: row.reference ?? row.number,
        subject: row.subject,
        pieces: row._count.documents,
      })),
      issuedBy: courrier.transmittedBy?.name ?? null,
      receivedBy: courrier.dischargeReceivedBy,
      dischargedAt: courrier.dischargedAt,
    });
    return { pdf, filename: `${courrier.bordereauNumber}.pdf` };
  }

  // A sortant is cancelled with its reason (CancelMailDto: 10 characters
  // at least); for an entrant the reason is optional.
  async cancel(id: string, reason?: string) {
    const courrier = await this.requireStatus(id, [
      ...SORTANT_OPEN_STATUSES,
      ...ENTRANT_OPEN_STATUSES,
      // An entrant whose dispatching awaits validation.
      CourrierStatus.EN_ATTENTE_TRANSMISSION,
    ]);
    if (courrier.direction === CourrierDirection.SORTANT && !reason) {
      throw new BadRequestException(
        'reason is required to cancel a sortant (10 characters at least)',
      );
    }
    return formatCourrier(
      await this.setStatus(courrier.id, CourrierStatus.ANNULE, {
        data: { cancelledAt: new Date(), cancellationReason: reason ?? null },
        metadata: reason ? { reason } : undefined,
      }),
    );
  }

  // Entrant: mark a received courrier as fully treated (10.2.4.8), with an
  // optional note. Its instructions still open are cancelled with it.
  async close(id: string, dto: CloseMailDto = {}, userId?: string) {
    const courrier = await this.requireStatus(id, ENTRANT_CLOSABLE_STATUSES);
    if (courrier.direction !== CourrierDirection.ENTRANT) {
      throw new BadRequestException('Only an incoming courrier can be closed');
    }
    if (userId) {
      await this.assertMayConclude(
        courrier,
        userId,
        PermissionCode.CourrierClose,
      );
    }
    const note = dto.note || null;
    const [{ count: cancelledInstructions }, updated] =
      await this.database.$transaction([
        this.database.instruction.updateMany({
          where: {
            courrierId: id,
            status: { notIn: INSTRUCTION_DONE_STATUSES },
          },
          data: {
            status: InstructionStatus.ANNULEE,
            cancellationReason: 'Effet clôturé',
          },
        }),
        this.database.courrier.update({
          where: { id },
          data: {
            status: CourrierStatus.CLOTURE,
            closedAt: new Date(),
            closingNote: note,
          },
          include: mailInclude,
        }),
      ]);
    this.recordCourrierEvent(id, 'COURRIER_CLOTURE', {
      ...(note ? { note } : {}),
      cancelledInstructions,
    });
    return formatCourrier(updated);
  }

  // An entrant once treated (mirroring Dossier's close-before-archive
  // rule), a sortant once authorized or cancelled — with an optional
  // reason. The status it leaves is kept for unarchive().
  async archive(id: string, reason?: string, userId?: string) {
    const courrier = await this.findOne(id);
    if (userId) {
      await this.assertMayConclude(
        courrier,
        userId,
        PermissionCode.CourrierArchive,
      );
    }
    const allowed = ARCHIVABLE_STATUSES[courrier.direction];
    if (!allowed.includes(courrier.status)) {
      throw new BadRequestException(
        `Courrier is ${courrier.status}, expected one of: ${allowed.join(', ')}`,
      );
    }
    return formatCourrier(
      await this.setStatus(courrier.id, CourrierStatus.ARCHIVE, {
        data: {
          archivedAt: new Date(),
          archiveReason: reason ?? null,
          archivedFromStatus: courrier.status,
        },
        metadata: { from: courrier.status, ...(reason ? { reason } : {}) },
      }),
    );
  }

  // Inverse of archive(): back to the status it was archived from (an
  // entrant archived before that was recorded: CLOTURE).
  async unarchive(id: string, userId?: string) {
    const courrier = await this.requireStatus(id, [CourrierStatus.ARCHIVE]);
    if (userId) {
      await this.assertMayConclude(
        courrier,
        userId,
        PermissionCode.CourrierArchive,
      );
    }
    const status =
      courrier.archivedFromStatus ??
      (courrier.direction === CourrierDirection.SORTANT
        ? CourrierStatus.VALIDE
        : CourrierStatus.CLOTURE);
    return formatCourrier(
      await this.setStatus(courrier.id, status, {
        data: {
          archivedAt: null,
          archiveReason: null,
          archivedFromStatus: null,
        },
        action: 'COURRIER_DESARCHIVE',
        metadata: { to: status },
      }),
    );
  }

  // The PDF of an authorized sortant, with its SOR reference.
  async outgoingPdf(id: string, userId: string) {
    await this.assertVisible(id, userId);
    const courrier = await this.database.courrier.findUniqueOrThrow({
      where: { id },
      include: {
        correspondent: { select: { name: true } },
        dossier: { select: { number: true, title: true } },
        project: { select: { name: true } },
        contract: { select: { reference: true, title: true } },
        respondsTo: { select: { number: true, reference: true } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });
    const authorized =
      courrier.direction === CourrierDirection.SORTANT &&
      courrier.reference &&
      (SORTANT_AUTHORIZED_STATUSES.includes(courrier.status) ||
        (courrier.status === CourrierStatus.ARCHIVE &&
          courrier.archivedFromStatus !== CourrierStatus.ANNULE));
    if (!authorized || !courrier.reference) {
      throw new BadRequestException(
        'Only an authorized sortant (VALIDE, SIGNE, ENVOYE, DECHARGE) has a PDF',
      );
    }
    const pdf = await renderOutgoingPdf({
      reference: courrier.reference,
      number: courrier.number,
      subject: courrier.subject,
      body: courrier.body,
      approvedAt: courrier.approvedAt,
      approvedBy: courrier.approvedBy?.name ?? null,
      author: courrier.createdBy?.name ?? null,
      recipient: courrier.correspondent?.name ?? null,
      dossier: courrier.dossier
        ? `${courrier.dossier.number} – ${courrier.dossier.title}`
        : null,
      project: courrier.project?.name ?? null,
      contract: courrier.contract
        ? `${courrier.contract.reference} – ${courrier.contract.title}`
        : null,
      respondsTo: courrier.respondsTo
        ? (courrier.respondsTo.reference ?? courrier.respondsTo.number)
        : null,
    });
    return { pdf, filename: `${courrier.reference}.pdf` };
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

  // A sent sortant: ENVOYE -> DECHARGE, with the discharged bordereau, who
  // received it and when.
  // An entrant (RG-COU-007): the décharge handed to whoever brought it, once
  // registered — no status change.
  async discharge(
    id: string,
    dischargedById: string,
    dto: DischargeMailDto = {},
    file?: Express.Multer.File,
  ) {
    const courrier = await this.findOne(id);
    if (courrier.direction === CourrierDirection.SORTANT) {
      return this.dischargeSortant(courrier, dischargedById, dto, file);
    }
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

  private async dischargeSortant(
    courrier: { id: string; status: CourrierStatus },
    userId: string,
    dto: DischargeMailDto,
    file: Express.Multer.File | undefined,
  ) {
    if (courrier.status !== CourrierStatus.ENVOYE) {
      throw new BadRequestException(
        `Courrier is ${courrier.status}, expected one of: ENVOYE`,
      );
    }
    const { receivedBy, dischargedAt } = dto;
    if (!file || !receivedBy || !dischargedAt) {
      throw new BadRequestException(
        'file (the discharged bordereau), receivedBy and dischargedAt are required',
      );
    }
    const updated = await this.withUploadedDocument(
      courrier.id,
      file,
      userId,
      'Bordereau déchargé',
      (tx, documentId) =>
        tx.courrier.updateMany({
          where: { id: courrier.id, status: CourrierStatus.ENVOYE },
          data: {
            status: CourrierStatus.DECHARGE,
            dischargedAt: new Date(dischargedAt),
            dischargedById: userId,
            dischargedStamp: true,
            dischargeReceivedBy: receivedBy,
            dischargeDocumentId: documentId,
          },
        }),
    );
    this.recordCourrierEvent(courrier.id, 'COURRIER_DECHARGE', {
      receivedBy,
      dischargedAt,
    });
    return formatCourrier(updated);
  }

  // Stores `file` as a document of the courrier, then — in one transaction —
  // records it and applies `transition` (a guarded updateMany). If the
  // transition finds the courrier changed meanwhile, nothing is recorded and
  // the stored file is removed.
  private async withUploadedDocument(
    courrierId: string,
    file: Express.Multer.File,
    userId: string,
    name: string,
    transition: (
      tx: Prisma.TransactionClient,
      documentId: string,
    ) => Promise<{ count: number }>,
  ) {
    const { key } = await this.storage.upload(file.buffer, {
      originalName: file.originalname,
      contentType: file.mimetype,
      prefix: `courriers/${courrierId}`,
    });
    try {
      return await this.database.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            originalName: file.originalname,
            name,
            storageKey: key,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            courrierId,
            uploadedById: userId,
          },
        });
        const { count } = await transition(tx, document.id);
        if (count === 0) {
          throw new ConflictException(
            'This courrier changed meanwhile — refresh and try again',
          );
        }
        return tx.courrier.findUniqueOrThrow({
          where: { id: courrierId },
          include: mailInclude,
        });
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
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

  private async requireSortant(id: string, allowed: CourrierStatus[]) {
    const courrier = await this.requireStatus(id, allowed);
    if (courrier.direction !== CourrierDirection.SORTANT) {
      throw new BadRequestException('Only a sortant can go through this step');
    }
    return courrier;
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

  // `data`: written with the status; `action` and `metadata`: its journal
  // entry (COURRIER_<status> by default).
  private async setStatus(
    id: string,
    status: CourrierStatus,
    extra: {
      data?: Prisma.CourrierUncheckedUpdateInput;
      action?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    const updated = await this.database.courrier.update({
      where: { id },
      data: { ...extra.data, status },
      include: mailInclude,
    });
    this.recordCourrierEvent(
      id,
      extra.action ?? `COURRIER_${status}`,
      extra.metadata,
    );
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
   * The sortants of the list as CSV — same filters as findOutgoing, every
   * page. UTF-8 with BOM, for Excel.
   */
  async exportOutgoing(
    query: FindOutgoingMailsQueryDto,
    userId: string,
  ): Promise<Buffer> {
    const { where } = await this.outgoingWhere(query, userId);
    const rows = await this.database.courrier.findMany({
      where,
      include: {
        correspondent: { select: { name: true } },
        dossier: { select: { number: true, title: true } },
        project: { select: { name: true } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const day = (value: Date | null) =>
      value ? value.toISOString().slice(0, 10) : '';
    return toCsv(
      [
        'Numéro',
        'Référence',
        'Objet',
        'Statut',
        'Destinataire',
        'Projet',
        'Dossier',
        'Rédigé par',
        'Approuvé par',
        'Date création',
        'Date soumission',
        'Date approbation',
        'Date signature',
        'Date envoi',
        'Bordereau',
        'Date décharge',
        'Motif annulation',
      ],
      rows.map((r) => [
        r.number,
        r.reference,
        r.subject,
        r.status,
        r.correspondent?.name,
        r.project?.name,
        r.dossier ? `${r.dossier.number} – ${r.dossier.title}` : '',
        r.createdBy?.name,
        r.approvedBy?.name,
        day(r.createdAt),
        day(r.submittedAt),
        day(r.approvedAt),
        day(r.signedAt),
        day(r.transmittedAt ?? r.sentAt),
        r.bordereauNumber,
        day(r.dischargedAt),
        r.cancellationReason,
      ]),
    );
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
    const where = incomingWhere(query, visible);

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

    return toCsv(
      [
        'Numéro',
        'Objet',
        'Statut',
        'Correspondant',
        'Nature',
        'Dossier',
        'Responsable',
        'Date réception',
        'Date enregistrement',
      ],
      rows.map((r) => [
        r.number,
        r.subject,
        r.status,
        r.correspondent?.name,
        r.nature?.name,
        r.dossier ? `${r.dossier.number} – ${r.dossier.title}` : '',
        r.owner?.name,
        r.receivedAt ? r.receivedAt.toISOString().slice(0, 10) : '',
        r.createdAt.toISOString().slice(0, 10),
      ]),
    );
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

// Statuses an entrant can be transmitted from: dispatched (AFFECTE), or
// registered with its dossier.
const TRANSMITTABLE_STATUSES: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
  CourrierStatus.AFFECTE,
];

// Transmitting hands an entrant to its designated responsible: only an
// entrant whose dossier (or contract) is known, not yet transmitted.
// `status` is omitted when the caller checks it itself (requireStatus) or
// the courrier is being created.
function assertTransmittable(
  direction: CourrierDirection,
  dossierOrContractId: string | null,
  status?: CourrierStatus,
) {
  if (direction !== CourrierDirection.ENTRANT) {
    throw new BadRequestException('Only an entrant can be transmitted');
  }
  if (!dossierOrContractId) {
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

// Its dossier still open — or, without a dossier, its contract still active.
const DISPATCH_TARGET_OPEN: Prisma.CourrierWhereInput = {
  OR: [
    {
      dossier: {
        status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
      },
    },
    { dossierId: null, contract: { status: ContractStatus.ACTIVE } },
  ],
};

// The entrants of the list (and its export) among the `visible` ones.
function incomingWhere(
  query: FindIncomingMailsQueryDto,
  visible: Prisma.CourrierWhereInput,
): Prisma.CourrierWhereInput {
  const received = dateRange(query.receivedFrom, query.receivedTo);
  const tabStatuses = resolveIncomingTabStatuses(query.tab);
  return {
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
      query.tab === 'dispatched' ? DISPATCH_TARGET_OPEN : undefined,
      query.withoutLiveSheet
        ? { analysisSheets: { none: LIVE_ANALYSIS_SHEET_WHERE } }
        : undefined,
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
}

// Free text against the subject, internal number or printed reference.
function searchWhere(search?: string): Prisma.CourrierWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: 'insensitive' as const };
  return {
    OR: [{ subject: contains }, { number: contains }, { reference: contains }],
  };
}
