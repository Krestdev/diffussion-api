import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  Prisma,
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
import { CircuitInstanceService } from '../../circuits/circuit-instance/circuit-instance.service';
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
// approved by its circuit (which leaves it VALIDE).
const ENTRANT_CLOSABLE_STATUSES: CourrierStatus[] = [
  ...ENTRANT_OPEN_STATUSES,
  CourrierStatus.VALIDE,
];

// Sortant workflow: statuses before it's been sent — cancellable.
const SORTANT_OPEN_STATUSES: CourrierStatus[] = [
  CourrierStatus.BROUILLON,
  CourrierStatus.EN_CIRCUIT,
  CourrierStatus.A_CORRIGER,
];

// Statuses submitForVerification() may start a circuit from, per direction
// (BAD 10.6 applies to entrant treatment as much as sortant drafting — the
// circuit itself and the CourrierStatus it moves through are already
// shared between both, see the CourrierStatus enum comment).
const CIRCUIT_ELIGIBLE_STATUSES: Record<CourrierDirection, CourrierStatus[]> = {
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
    private readonly circuitInstanceService: CircuitInstanceService,
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
    await assertDossierOpenForActivity(this.database, dto.dossierId);
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

    await markDossierInProgress(this.database, dto.dossierId);

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
  // responsible for treatment).
  async transmit(id: string) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.RECU,
      CourrierStatus.ENREGISTRE,
    ]);
    return this.setStatus(courrier.id, CourrierStatus.TRANSMIS);
  }

  // Sortant: BROUILLON | A_CORRIGER -> EN_CIRCUIT. Entrant: TRANSMIS |
  // EN_TRAITEMENT | A_CORRIGER -> EN_CIRCUIT — both directions share the
  // same CircuitInstance mechanics and the same EN_CIRCUIT/VALIDE/
  // A_CORRIGER statuses (10.6 / RG-VAL-*). Starts a CircuitInstance
  // resolved from the courrier's dossier type — the number of approval
  // steps is whatever that Circuit template defines. Throws if the
  // dossier's type has no circuit configured; see
  // CircuitInstanceService.start().
  async submitForVerification(id: string, userId: string) {
    const courrier = await this.findOne(id);
    const allowed = CIRCUIT_ELIGIBLE_STATUSES[courrier.direction];
    if (!allowed.includes(courrier.status)) {
      throw new BadRequestException(
        `Courrier is ${courrier.status}, expected one of: ${allowed.join(', ')}`,
      );
    }
    await this.circuitInstanceService.start({ courrierId: id }, userId);
    return this.findOne(id);
  }

  // Circuit owner (10.6): can decide any step of this courrier's circuit
  // regardless of role/site gating. Settable at creation (CreateMailDto) or
  // — since it can be left unset — completed/reassigned later, but only by
  // the courrier's creator, the responsible of the dossier's owning site,
  // or a platform admin (ADMIN_MANAGE_CIRCUITS).
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
    const isPlatformAdmin = await this.rbac.hasPermission(
      actingUserId,
      PermissionCode.AdminManageCircuits,
    );
    if (!isCreator && !isSiteAdmin && !isPlatformAdmin) {
      throw new ForbiddenException(
        "Only the creator, the site responsible, or a platform admin can assign this courrier's circuit owner",
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

  // Dossiers on the sites where the caller may read courriers.
  private readableSites(userId: string) {
    return this.rbac.siteFilter(
      userId,
      PermissionCode.CourrierRead,
      (siteId): Prisma.DossierWhereInput => ({ siteId }),
    );
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

// Incoming/outgoing courriers the caller may see: those in dossiers visible
// to them (see visibleDossierWhere) on the sites they may read courriers at
// (`sites`), plus their own drafts not yet attached to a dossier.
function visibleMailsWhere(
  direction: CourrierDirection,
  userId: string,
  sites: Prisma.DossierWhereInput,
): Prisma.CourrierWhereInput {
  return {
    direction,
    OR: [
      { dossier: { AND: [visibleDossierWhere(userId), sites] } },
      { dossierId: null, createdById: userId },
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
