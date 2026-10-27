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
import { FindIncomingMailsQueryDto } from './dto/find-incoming-mails.query.dto';
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

const mailInclude = {
  correspondent: true,
  nature: true,
  canal: true,
  owner: { select: { id: true, name: true, email: true } },
  // `priority` is included so the frontend can show a courrier's urgency —
  // Courrier has no priority of its own, it inherits its dossier's.
  dossier: { select: { id: true, number: true, title: true, priority: true } },
  respondsTo: {
    select: { id: true, number: true, subject: true, direction: true },
  },
  documents: { orderBy: { createdAt: 'asc' } },
  validations: {
    include: { validator: { select: { id: true, name: true } } },
    orderBy: { decidedAt: 'desc' },
  },
} satisfies Prisma.CourrierInclude;

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
  ) {}

  // (dto already carries ownerId straight through via `...data` below —
  // Prisma accepts the scalar FK field directly on CourrierCreateInput.)
  async create(
    dto: CreateMailDto,
    createdById: string,
    files?: Express.Multer.File[],
  ) {
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
    const { receivedAt, documents: documentMetas, ...data } = dto;
    const courrier = await createWithUniqueReference('M', (number) =>
      this.database.courrier.create({
        data: {
          ...data,
          number,
          receivedAt: receivedAt ? new Date(receivedAt) : undefined,
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

    if (files && files.length > 0) {
      return this.findOne(courrier.id);
    }

    return courrier;
  }

  // Sortant draft from its subject alone: a BROUILLON with its internal
  // number, not yet attached to a dossier. Everything else, dossier
  // included, is completed through update() before submitForVerification().
  async createOutgoingDraft(dto: CreateOutgoingMailDto, createdById: string) {
    return createWithUniqueReference('M', (number) =>
      this.database.courrier.create({
        data: {
          subject: dto.subject,
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

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
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
    const where: Prisma.CourrierWhereInput = {
      ...visible,
      status: query.status,
      dossierId: query.dossierId,
      correspondentId: query.correspondentId,
      natureId: query.natureId,
      ownerId: query.ownerId,
      AND: [
        searchWhere(query.search),
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

    const [data, total, allCount, archivedCount] =
      await this.database.$transaction([
        this.database.courrier.findMany({
          where,
          include: mailInclude,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.database.courrier.count({ where }),
        this.database.courrier.count({ where: visible }),
        this.database.courrier.count({
          where: { ...visible, status: CourrierStatus.ARCHIVE },
        }),
      ]);

    return {
      data,
      total,
      skip,
      take,
      metrics: { total: allCount, archived: archivedCount },
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
      ownerId: query.ownerId,
      createdAt: created,
      AND: [
        searchWhere(query.search),
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
      data,
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
    return courrier;
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

  async update(id: string, dto: UpdateMailDto) {
    const courrier = await this.ensureEditable(id);
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
    const { receivedAt, ...data } = dto;
    const updated = await this.database.courrier.update({
      where: { id: courrier.id },
      data: {
        ...data,
        receivedAt: receivedAt ? new Date(receivedAt) : undefined,
      },
      include: mailInclude,
    });
    if (dossierChanged) {
      await markDossierInProgress(this.database, dto.dossierId!);
    }
    return updated;
  }

  async remove(id: string) {
    await this.ensureEditable(id);
    await this.database.courrier.delete({ where: { id } });
  }

  // Entrant: ENREGISTRE -> TRANSMIS (10.2.4.7 — handed to the dossier's
  // responsible for treatment), so its dossier must be known by then.
  async transmit(id: string) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.RECU,
      CourrierStatus.ENREGISTRE,
    ]);
    if (!courrier.dossierId) {
      throw new BadRequestException(
        'Attach this courrier to its dossier before transmitting it',
      );
    }
    return this.setStatus(courrier.id, CourrierStatus.TRANSMIS);
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
    return updated;
  }

  // EN_ATTENTE_VALIDATION -> VALIDE.
  validate(id: string, userId: string) {
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
  findAwaitingMyValidation(userId: string) {
    return this.database.courrier.findMany({
      where: awaitingValidationBy(userId),
      orderBy: { updatedAt: 'desc' },
      include: mailInclude,
    });
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
    this.notify(courrier, [courrier.createdById, courrier.ownerId], userId, {
      type: approved ? 'COURRIER_VALIDATED' : 'COURRIER_CORRECTIONS_REQUESTED',
      message: approved
        ? `« ${courrier.subject} » a été validé.`
        : `« ${courrier.subject} » doit être corrigé : ${motif}`,
    });
    return updated;
  }

  // The rule of awaitingValidationBy, for one courrier.
  private async validatorOf(courrier: {
    dossierId: string | null;
    createdById: string | null;
  }): Promise<string | null> {
    if (courrier.dossierId) {
      const dossier = await this.database.dossier.findUnique({
        where: { id: courrier.dossierId },
        select: {
          responsibleId: true,
          site: { select: { responsibleId: true } },
        },
      });
      return dossier?.responsibleId ?? dossier?.site.responsibleId ?? null;
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
    return this.database.courrier.update({
      where: { id: courrier.id },
      data: { status: CourrierStatus.ENVOYE, sentAt: new Date() },
      include: mailInclude,
    });
  }

  async cancel(id: string) {
    const courrier = await this.requireStatus(id, [
      ...SORTANT_OPEN_STATUSES,
      ...ENTRANT_OPEN_STATUSES,
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

  private setStatus(id: string, status: CourrierStatus) {
    return this.database.courrier.update({
      where: { id },
      data: { status },
      include: mailInclude,
    });
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
      ...(direction === CourrierDirection.ENTRANT
        ? [{ dossierId: null, createdBy: sites.registrant }]
        : []),
    ],
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
