import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  CourrierStatus,
  DossierConfidentiality,
  DossierStatus,
  InstructionStatus,
  Prisma,
  UserStatus,
} from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService } from '../../auth/rbac/rbac.service';
import { SetAccessDto } from '../../common/dto/access.dto';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import { computeDossierProgress } from '../../common/utils/dossier-lifecycle';
import {
  livrableValidations,
  withLivrableHistory,
} from '../../common/utils/livrable-history';
import { visibleDossierWhere } from '../../common/utils/dossier-visibility';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { assertSiteActive } from '../../common/utils/referential-guards';
import { DatabaseService } from '../../database/database.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { FindDossiersQueryDto } from './dto/find-dossiers.query.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

const dossierInclude = {
  site: true,
  category: true,
  project: true,
  contract: {
    select: { id: true, number: true, title: true, reference: true },
  },
  responsible: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  _count: { select: { courriers: true, instructions: true } },
} satisfies Prisma.DossierInclude;

const dossierAccessInclude = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DossierAccessInclude;

const TERMINAL_INSTRUCTION_STATUSES: InstructionStatus[] = [
  InstructionStatus.TERMINEE,
  InstructionStatus.ANNULEE,
];

// Statuses that turn LATE once the due date has passed (and that a LATE
// dossier returns from, as IN_PROGRESS, when its due date is pushed back).
const LATENESS_ELIGIBLE_STATUSES: DossierStatus[] = [
  DossierStatus.OPEN,
  DossierStatus.IN_PROGRESS,
  DossierStatus.PENDING,
];

// Status a dossier should have given its due date, right now. Time passing
// is handled by DossierLatenessService; this covers due-date edits.
export function statusForDueDate(
  status: DossierStatus,
  dueDate: Date | null,
): DossierStatus {
  const overdue = dueDate !== null && dueDate.getTime() < Date.now();
  if (overdue && LATENESS_ELIGIBLE_STATUSES.includes(status)) {
    return DossierStatus.LATE;
  }
  if (!overdue && status === DossierStatus.LATE) {
    return DossierStatus.IN_PROGRESS;
  }
  return status;
}

function paging(query: PaginationQueryDto) {
  return { skip: query.skip ?? 0, take: query.take ?? DEFAULT_TAKE };
}

@Injectable()
export class DossierService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'dossier.created',
    entityType: 'dossier',
    operation: 'CREATE',
  })
  async create(dto: CreateDossierDto, createdById: string) {
    await assertSiteActive(this.database, dto.siteId);
    const responsibleId = dto.responsibleId ?? createdById;
    await this.assertEligibleResponsible(responsibleId, dto.siteId);

    const projectId = await this.projectUnderContract(
      dto.contractId,
      dto.projectId,
    );
    const { keywords, dueDate: rawDueDate, number: givenNumber, ...data } = dto;
    const openedAt = new Date();
    const dueDate = rawDueDate ? new Date(rawDueDate) : null;
    const retentionUntil = await this.computeRetentionUntil(
      dto.categoryId,
      openedAt,
    );
    const create = (number: string) =>
      this.database.dossier.create({
        data: {
          ...data,
          projectId,
          number,
          openedAt,
          dueDate,
          status: statusForDueDate(DossierStatus.OPEN, dueDate),
          retentionUntil,
          keywords: keywords ?? [],
          responsibleId,
          createdById,
        },
        include: dossierInclude,
      });
    if (!givenNumber) {
      return createWithUniqueReference('D', create);
    }
    const taken = await this.database.dossier.count({
      where: { number: givenNumber },
    });
    if (taken) {
      throw new ConflictException(
        `A dossier numbered ${givenNumber} already exists`,
      );
    }
    return create(givenNumber);
  }

  async findAll(query: FindDossiersQueryDto, userId?: string) {
    const where: Prisma.DossierWhereInput = {
      status: query.status,
      priority: query.priority,
      siteId: query.siteId,
      responsibleId: query.responsibleId,
      projectId: query.projectId,
      contractId: query.contractId,
      OR: query.search
        ? [
            { title: { contains: query.search, mode: 'insensitive' } },
            { number: { contains: query.search, mode: 'insensitive' } },
            // Exact keyword match (Postgres array containment).
            { keywords: { has: query.search } },
          ]
        : undefined,
    };

    if (userId) {
      where.AND = [
        visibleDossierWhere(userId),
        // Only the sites where the caller may read dossiers.
        await this.rbac.siteFilter(
          userId,
          PermissionCode.DossierRead,
          (siteId) => ({
            siteId,
          }),
        ),
      ];
    }

    const [data, total] = await this.database.$transaction([
      this.database.dossier.findMany({
        where,
        include: dossierInclude,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.dossier.count({ where }),
    ]);

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(id: string, userId?: string) {
    const dossier = await this.database.dossier.findUnique({
      where: { id },
      include: dossierInclude,
    });
    if (!dossier) {
      throw new NotFoundException(`Dossier ${id} not found`);
    }

    if (
      userId &&
      dossier.confidentiality === DossierConfidentiality.RESTRICTED
    ) {
      if (dossier.createdById !== userId && dossier.responsibleId !== userId) {
        const access = await this.database.dossierAccess.findUnique({
          where: { dossierId_userId: { dossierId: id, userId } },
        });
        if (!access?.canView) {
          throw new ForbiddenException(
            `You do not have permission to view this restricted dossier`,
          );
        }
      }
    }

    return dossier;
  }

  @AuditLog({
    action: 'dossier.updated',
    entityType: 'dossier',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateDossierDto, actingUserId: string) {
    const dossier = await this.ensureMutable(id);

    // RG-DOS-004: a dossier always has a responsible — it can be replaced,
    // never cleared.
    if ('responsibleId' in dto && !dto.responsibleId) {
      throw new BadRequestException(
        'A dossier must always have a responsible — pass another user instead of clearing it',
      );
    }

    // RG-DOS-003: the owning site drives eligibility and access,
    // so moving a dossier is an administrative act, not a plain edit.
    const siteChanged =
      dto.siteId !== undefined && dto.siteId !== dossier.siteId;
    if (siteChanged) {
      const canMove = await this.rbac.hasPermission(
        actingUserId,
        PermissionCode.AdminManageSites,
      );
      if (!canMove) {
        throw new ForbiddenException(
          `Moving a dossier to another site requires ${PermissionCode.AdminManageSites}`,
        );
      }
      await assertSiteActive(this.database, dto.siteId!);
    }

    const targetSiteId = dto.siteId ?? dossier.siteId;
    const targetResponsibleId = dto.responsibleId ?? dossier.responsibleId;
    if (
      targetResponsibleId &&
      (siteChanged || targetResponsibleId !== dossier.responsibleId)
    ) {
      await this.assertEligibleResponsible(targetResponsibleId, targetSiteId);
    }

    const retentionUntil =
      dto.categoryId !== undefined && dto.categoryId !== dossier.categoryId
        ? await this.computeRetentionUntil(dto.categoryId, dossier.openedAt)
        : undefined;

    const projectId =
      dto.contractId !== undefined || dto.projectId !== undefined
        ? await this.projectUnderContract(
            dto.contractId !== undefined ? dto.contractId : dossier.contractId,
            dto.projectId !== undefined ? dto.projectId : dossier.projectId,
          )
        : undefined;
    const { keywords, dueDate: rawDueDate, ...data } = dto;
    const dueDateChanged = 'dueDate' in dto;
    const dueDate = rawDueDate ? new Date(rawDueDate) : null;

    return this.database.dossier.update({
      where: { id },
      data: {
        ...data,
        projectId,
        keywords,
        retentionUntil,
        ...(dueDateChanged
          ? { dueDate, status: statusForDueDate(dossier.status, dueDate) }
          : {}),
      },
      include: dossierInclude,
    });
  }

  // RG-DOS-005: a dossier can only close once every instruction attached to
  // it is terminated (validated) or cancelled, and none of its courriers is
  // still awaiting validation.
  @AuditLog({
    action: 'dossier.closed',
    entityType: 'dossier',
    operation: 'UPDATE',
  })
  async close(id: string) {
    await this.ensureMutable(id);

    const [pending, awaitingValidation] = await Promise.all([
      this.database.instruction.count({
        where: {
          dossierId: id,
          status: { notIn: TERMINAL_INSTRUCTION_STATUSES },
        },
      }),
      this.database.courrier.count({
        where: {
          dossierId: id,
          status: CourrierStatus.EN_ATTENTE_VALIDATION,
        },
      }),
    ]);
    if (pending > 0) {
      throw new BadRequestException(
        `${pending} instruction(s) are still open — a dossier can only be closed once every instruction is terminated or cancelled`,
      );
    }
    if (awaitingValidation > 0) {
      throw new BadRequestException(
        `${awaitingValidation} courrier(s) are still awaiting validation on this dossier — have them validated or sent back for corrections before closing`,
      );
    }

    return this.database.dossier.update({
      where: { id },
      data: { status: DossierStatus.CLOSED, closedAt: new Date() },
      include: dossierInclude,
    });
  }

  // RG-DOS-008: reopening is described as an exceptional procedure decided
  // outside the platform — exposed here as a distinct, separately
  // permissioned action rather than a plain field update.
  @AuditLog({
    action: 'dossier.reopened',
    entityType: 'dossier',
    operation: 'UPDATE',
  })
  async reopen(id: string) {
    const dossier = await this.findOne(id);
    if (dossier.status !== DossierStatus.CLOSED) {
      throw new BadRequestException('Only a closed dossier can be reopened');
    }
    return this.database.dossier.update({
      where: { id },
      data: {
        status: statusForDueDate(DossierStatus.IN_PROGRESS, dossier.dueDate),
        closedAt: null,
        archivedAt: null,
      },
      include: dossierInclude,
    });
  }

  // 10.8.3: a dossier must be closed before it is eligible for archiving.
  @AuditLog({
    action: 'dossier.archived',
    entityType: 'dossier',
    operation: 'UPDATE',
  })
  async archive(id: string, reason?: string) {
    const dossier = await this.findOne(id);
    if (dossier.status !== DossierStatus.CLOSED) {
      throw new BadRequestException('Only a closed dossier can be archived');
    }
    return this.database.dossier.update({
      where: { id },
      data: {
        status: DossierStatus.ARCHIVED,
        archivedAt: new Date(),
        archiveReason: reason ?? null,
      },
      include: dossierInclude,
    });
  }

  // Inverse of archive() — brings a dossier back to CLOSED (not straight to
  // IN_PROGRESS: archiving only ever happens from CLOSED, so this undoes
  // exactly that step; a further reopen() can resume active work from there).
  @AuditLog({
    action: 'dossier.unarchived',
    entityType: 'dossier',
    operation: 'UPDATE',
  })
  async unarchive(id: string) {
    const dossier = await this.findOne(id);
    if (dossier.status !== DossierStatus.ARCHIVED) {
      throw new BadRequestException('Only an archived dossier can be restored');
    }
    return this.database.dossier.update({
      where: { id },
      data: {
        status: DossierStatus.CLOSED,
        archivedAt: null,
        archiveReason: null,
      },
      include: dossierInclude,
    });
  }

  async getCourriers(id: string, query: PaginationQueryDto, userId?: string) {
    await this.findOne(id, userId);
    const { skip, take } = paging(query);
    const where: Prisma.CourrierWhereInput = {
      dossierId: id,
      OR: query.search
        ? [
            { subject: { contains: query.search, mode: 'insensitive' } },
            { number: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [data, total] = await this.database.$transaction([
      this.database.courrier.findMany({
        where,
        include: { correspondent: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.courrier.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async getInstructions(
    id: string,
    query: PaginationQueryDto,
    userId?: string,
  ) {
    await this.findOne(id, userId);
    const { skip, take } = paging(query);
    const where: Prisma.InstructionWhereInput = {
      dossierId: id,
      title: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };
    const [data, total] = await this.database.$transaction([
      this.database.instruction.findMany({
        where,
        // Never the whole user: it carries the password hash and the
        // refresh token.
        include: {
          assignees: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.instruction.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async getLivrables(id: string, query: PaginationQueryDto, userId?: string) {
    await this.findOne(id, userId);
    const { skip, take } = paging(query);
    // One row per livrable: its current version, earlier ones in `history`.
    const where: Prisma.LivrableWhereInput = {
      isLatest: true,
      instruction: { dossierId: id },
      title: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };
    const [data, total] = await this.database.$transaction([
      this.database.livrable.findMany({
        where,
        include: { validations: livrableValidations },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.livrable.count({ where }),
    ]);
    const withHistory = await withLivrableHistory(this.database, data, {
      validations: livrableValidations,
    });
    return { data: withHistory, total, skip, take };
  }

  // RG-AUD-*: full trail of everything recorded against this dossier.
  // `userId`/`actorLabel` on ActivityLog are loose references rather than a
  // relation (see schema), so there's no join to include here.
  async getHistorique(id: string, userId?: string) {
    await this.findOne(id, userId);
    return this.database.activityLog.findMany({
      where: { entityType: 'dossier', entityId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 10.1.8: progression derived from how many attached instructions are
  // terminated. Read-only — the persisted `progress` is kept up to date by
  // the instruction lifecycle (see refreshDossierProgress).
  async getProgression(id: string, userId?: string) {
    await this.findOne(id, userId);
    return computeDossierProgress(this.database, id);
  }

  // RG-DOS-*: explicit per-user grants on top of `confidentiality` — a
  // RESTRICTED dossier is otherwise only visible to its responsible/creator.
  async getAccess(id: string, userId?: string) {
    await this.findOne(id, userId);
    return this.database.dossierAccess.findMany({
      where: { dossierId: id },
      include: dossierAccessInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  // Full-replace: the entries given become the complete grant set for this
  // dossier — any existing grant for a user not listed is dropped.
  async setAccess(id: string, dto: SetAccessDto) {
    await this.findOne(id);

    const inconsistent = dto.entries.filter((e) => e.canEdit && !e.canView);
    if (inconsistent.length) {
      throw new BadRequestException(
        'canEdit requires canView — a user cannot edit a dossier they cannot see',
      );
    }
    const userIds = dto.entries.map((entry) => entry.userId);
    const known = await this.database.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });
    const unknown = userIds.filter((uid) => !known.some((u) => u.id === uid));
    if (unknown.length) {
      throw new BadRequestException(`Unknown user ids: ${unknown.join(', ')}`);
    }

    const before = await this.getAccess(id);

    await this.database.$transaction([
      this.database.dossierAccess.deleteMany({
        where: {
          dossierId: id,
          userId: { notIn: userIds.length > 0 ? userIds : ['__none__'] },
        },
      }),
      ...dto.entries.map((entry) =>
        this.database.dossierAccess.upsert({
          where: { dossierId_userId: { dossierId: id, userId: entry.userId } },
          create: {
            dossierId: id,
            userId: entry.userId,
            canView: entry.canView,
            canEdit: entry.canEdit,
          },
          update: { canView: entry.canView, canEdit: entry.canEdit },
        }),
      ),
    ]);

    const after = await this.getAccess(id);
    const summarize = (grants: typeof before) =>
      grants.map((g) => ({
        userId: g.userId,
        canView: g.canView,
        canEdit: g.canEdit,
      }));
    await this.activity.record({
      action: 'dossier.access-updated',
      entityType: 'dossier',
      entityId: id,
      changes: { accesses: [summarize(before), summarize(after)] },
    });
    return after;
  }

  // A dossier under a contract belongs to that contract's project: the
  // project is taken from the contract, and a different one is refused.
  // Returns the dossier's project.
  private async projectUnderContract(
    contractId: string | null | undefined,
    projectId: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (!contractId) return projectId;
    const contract = await this.database.contract.findUnique({
      where: { id: contractId },
      select: { number: true, projectId: true, status: true },
    });
    if (!contract) {
      throw new BadRequestException(`Contract ${contractId} not found`);
    }
    if (contract.status === ContractStatus.ARCHIVED) {
      throw new BadRequestException(
        `Contract ${contract.number} is archived — no dossier can be added to it`,
      );
    }
    if (!contract.projectId) return projectId;
    if (projectId && projectId !== contract.projectId) {
      throw new BadRequestException(
        `Contract ${contract.number} belongs to another project — a dossier under it belongs to the contract's project`,
      );
    }
    return contract.projectId;
  }

  // RG-DOS-004: the responsible must be able to act on the dossier —
  // an active user of its owning site (they validate its courriers, and
  // notifications are resolved through the users' sites).
  private async assertEligibleResponsible(userId: string, siteId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        status: true,
        siteId: true,
      },
    });
    if (!user) {
      throw new BadRequestException(`User ${userId} not found`);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        `${user.name} is suspended and cannot be responsible for a dossier`,
      );
    }
    if (user.siteId !== siteId) {
      throw new BadRequestException(
        `${user.name} does not belong to the dossier's site — pick another responsible`,
      );
    }
  }

  // RG-ARC-001: retention runs from the dossier's opening date for as many
  // months as its category prescribes; null when there's no category or
  // the category sets no retention.
  private async computeRetentionUntil(
    categoryId: string | null | undefined,
    openedAt: Date,
  ): Promise<Date | null> {
    if (!categoryId) return null;
    const category = await this.database.category.findUnique({
      where: { id: categoryId },
      select: { retentionMonths: true },
    });
    if (!category) {
      throw new NotFoundException(`Category ${categoryId} not found`);
    }
    if (category.retentionMonths == null) return null;
    const until = new Date(openedAt);
    until.setMonth(until.getMonth() + category.retentionMonths);
    return until;
  }

  private async ensureMutable(id: string) {
    const dossier = await this.findOne(id);
    if (
      dossier.status === DossierStatus.CLOSED ||
      dossier.status === DossierStatus.ARCHIVED
    ) {
      // RG-DOS-007
      throw new BadRequestException(
        `Dossier is ${dossier.status.toLowerCase()} and can only be consulted`,
      );
    }
    return dossier;
  }
}
