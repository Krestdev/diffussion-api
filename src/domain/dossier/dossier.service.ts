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
} from '../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
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
import { assertCompanyActive } from '../../common/utils/referential-guards';
import {
  assertProjectOfCompany,
  assertProjectTakesDossiers,
} from '../../common/utils/company-referentials';
import { assertDossierTypeUsable } from '../../referentials/dossier-type/dossier-type.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { can } from '../../auth/access/permission-checks';
import {
  ActionBlockReason,
  ActionStates,
  blocked,
  needsStatus,
} from '../../workflow/action-states';
import { WorkflowService } from '../../workflow/workflow.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { DOSSIER_STATES, DossierEvent } from './dossier.states';
import { FindDossiersQueryDto } from './dto/find-dossiers.query.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

const dossierInclude = {
  company: true,
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
// Still being worked on: editable (RG-DOS-007).
const ACTIVE_STATUSES: DossierStatus[] = [
  DossierStatus.OPEN,
  DossierStatus.IN_PROGRESS,
  DossierStatus.PENDING,
  DossierStatus.LATE,
];

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
    private readonly access: AccessService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly workflow: WorkflowService,
  ) {}

  @AuditLog({
    action: 'dossier.created',
    entityType: 'dossier',
    operation: 'CREATE',
  })
  async create(dto: CreateDossierDto, createdById: string) {
    await assertCompanyActive(this.database, dto.companyId);
    const responsibleId = dto.responsibleId ?? createdById;
    await this.assertEligibleResponsible(responsibleId, dto.companyId);
    if (dto.typeId) {
      await assertDossierTypeUsable(this.database, dto.typeId, dto.companyId);
    }

    const projectId = await this.projectUnderContract(
      dto.contractId,
      dto.projectId,
    );
    if (projectId) {
      await assertProjectOfCompany(this.database, projectId, dto.companyId);
      if (!dto.contractId) {
        await assertProjectTakesDossiers(this.database, projectId);
      }
    }
    const { keywords, dueDate: rawDueDate, number: givenNumber, ...data } = dto;
    const openedAt = new Date();
    const dueDate = rawDueDate ? new Date(rawDueDate) : null;
    const retentionUntil = await this.computeRetentionUntil(
      dto.categoryId,
      openedAt,
    );
    const create = (number: string) =>
      this.database.$transaction(async (tx) => {
        const created = await tx.dossier.create({
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
        await this.workflow.record(tx, {
          table: DOSSIER_STATES,
          entityId: created.id,
          toStatus: created.status,
          companyId: created.companyId,
        });
        return created;
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
      companyId: query.companyId,
      responsibleId: query.responsibleId,
      projectId: query.projectId,
      contractId: query.contractId,
      courriers: query.correspondentId
        ? { some: { correspondentId: query.correspondentId } }
        : undefined,
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
        // Only the companies where the caller may read dossiers.
        await this.access.companyFilter(
          userId,
          Permission.DOSSIER_READ,
          (companyId) => ({
            companyId,
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

    // RG-DOS-003: the owning company drives eligibility and access,
    // so moving a dossier is an administrative act, not a plain edit.
    const companyChanged =
      dto.companyId !== undefined && dto.companyId !== dossier.companyId;
    if (companyChanged) {
      const canMove = await this.access.has(
        actingUserId,
        Permission.COMPANY_UPDATE,
      );
      if (!canMove) {
        throw new ForbiddenException(
          `Moving a dossier to another company requires ${Permission.COMPANY_UPDATE}`,
        );
      }
      await assertCompanyActive(this.database, dto.companyId!);
    }

    const targetCompanyId = dto.companyId ?? dossier.companyId;
    // Its kind stays one of its company's active types.
    if (dto.typeId && (dto.typeId !== dossier.typeId || companyChanged)) {
      await assertDossierTypeUsable(this.database, dto.typeId, targetCompanyId);
    }
    const targetResponsibleId = dto.responsibleId ?? dossier.responsibleId;
    if (
      targetResponsibleId &&
      (companyChanged || targetResponsibleId !== dossier.responsibleId)
    ) {
      await this.assertEligibleResponsible(
        targetResponsibleId,
        targetCompanyId,
      );
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
    // Its project is of its company.
    const targetProjectId =
      projectId !== undefined ? projectId : dossier.projectId;
    if (targetProjectId && (projectId !== undefined || companyChanged)) {
      await assertProjectOfCompany(
        this.database,
        targetProjectId,
        targetCompanyId,
      );
    }
    const targetContractId =
      dto.contractId !== undefined ? dto.contractId : dossier.contractId;
    if (targetProjectId && projectId !== undefined && !targetContractId) {
      await assertProjectTakesDossiers(this.database, targetProjectId);
    }
    const { keywords, dueDate: rawDueDate, ...data } = dto;
    const dueDateChanged = 'dueDate' in dto;
    const dueDate = rawDueDate ? new Date(rawDueDate) : null;

    // A due date moved past (or back before) today changes the status (DUE_DATE_CHANGED).
    const status = dueDateChanged
      ? statusForDueDate(dossier.status, dueDate)
      : dossier.status;
    return this.database.$transaction(async (tx) => {
      if (status !== dossier.status) {
        await this.workflow.transition(tx, {
          table: DOSSIER_STATES,
          delegate: tx.dossier,
          entityId: id,
          event: 'DUE_DATE_CHANGED',
          from: dossier.status,
          to: status,
          companyId: dossier.companyId,
        });
      }
      return tx.dossier.update({
        where: { id },
        data: {
          ...data,
          projectId,
          keywords,
          retentionUntil,
          ...(dueDateChanged ? { dueDate } : {}),
        },
        include: dossierInclude,
      });
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
    const dossier = await this.findOne(id);
    this.workflow.assertAllowed(DOSSIER_STATES, dossier.status, 'CLOSE');

    const { pending, awaitingValidation } = await this.openWork(id);
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

    return this.move(dossier, 'CLOSE', { closedAt: new Date() });
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
    this.workflow.assertAllowed(DOSSIER_STATES, dossier.status, 'REOPEN');
    return this.move(
      dossier,
      'REOPEN',
      { closedAt: null, archivedAt: null },
      statusForDueDate(DossierStatus.IN_PROGRESS, dossier.dueDate),
    );
  }

  // 10.8.3: a dossier must be closed before it is eligible for archiving.
  @AuditLog({
    action: 'dossier.archived',
    entityType: 'dossier',
    operation: 'UPDATE',
  })
  async archive(id: string, reason?: string) {
    const dossier = await this.findOne(id);
    return this.move(
      dossier,
      'ARCHIVE',
      { archivedAt: new Date(), archiveReason: reason ?? null },
      undefined,
      reason,
    );
  }

  // Inverse of archive() — brings a dossier back to CLOSED (not straight to
  // IN_PROGRESS: archiving only ever happens from CLOSED, so this undoes
  // exactly that step; a further reopen() can resume active work from there).
  @AuditLog({
    action: 'dossier.unarchived',
    entityType: 'dossier',
    operation: 'UPDATE',
    metadata: (args) => (args[1] ? { note: args[1] } : undefined),
  })
  async unarchive(id: string, note?: string) {
    void note; // Read by @AuditLog.
    const dossier = await this.findOne(id);
    return this.move(
      dossier,
      'UNARCHIVE',
      { archivedAt: null, archiveReason: null },
      undefined,
      note,
    );
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
  async setAccess(id: string, dto: SetAccessDto, actingUserId: string) {
    const dossier = await this.findOne(id);

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
    const couldView = new Set(
      before.filter((grant) => grant.canView).map((grant) => grant.userId),
    );
    await this.notifications.notifyAccessChanged(
      dto.entries
        .filter((entry) => entry.canView && !couldView.has(entry.userId))
        .map((entry) => entry.userId),
      actingUserId,
      `Vous avez désormais accès au dossier « ${dossier.title} ».`,
      id,
    );
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
  // an active user of its owning company (they validate its courriers, and
  // notifications are resolved through the users' companies).
  private async assertEligibleResponsible(userId: string, companyId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        status: true,
        companyId: true,
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
    if (user.companyId !== companyId) {
      throw new BadRequestException(
        `${user.name} does not belong to the dossier's company — pick another responsible`,
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

  /** A dossier with the actions the signed-in person may take on it (GET /dossiers/:id). */
  async detail(id: string, userId?: string) {
    const dossier = await this.findOne(id, userId);
    return { ...dossier, actions: await this.actionsOf(dossier) };
  }

  /**
   * Every action on the dossier the person's permissions allow, disabled with the reason it
   * is blocked now (owner standard: hidden when the role can never do it).
   */
  async actionsOf(dossier: { id: string; status: DossierStatus }) {
    const status = dossier.status;
    const actions = new ActionStates<
      'edit' | 'close' | 'reopen' | 'archive' | 'unarchive'
    >();
    actions.addIf(
      can(Permission.DOSSIER_UPDATE),
      'edit',
      !ACTIVE_STATUSES.includes(status) &&
        blocked(ActionBlockReason.WRONG_STATUS, { status }),
    );
    if (can(Permission.DOSSIER_CLOSE)) {
      const wrong = needsStatus(DOSSIER_STATES, status, 'CLOSE');
      const work = wrong ? null : await this.openWork(dossier.id);
      actions.add(
        'close',
        wrong,
        !!work?.pending &&
          blocked(ActionBlockReason.INSTRUCTIONS_OPEN, {
            count: String(work.pending),
          }),
        !!work?.awaitingValidation &&
          blocked(ActionBlockReason.PREREQUISITE_MISSING, {
            missing: 'COURRIER_VALIDATION',
            count: String(work.awaitingValidation),
          }),
      );
    }
    actions.addIf(
      can(Permission.DOSSIER_REOPEN),
      'reopen',
      needsStatus(DOSSIER_STATES, status, 'REOPEN'),
    );
    const archiver = can(Permission.DOSSIER_ARCHIVE);
    actions.addIf(
      archiver,
      'archive',
      needsStatus(DOSSIER_STATES, status, 'ARCHIVE'),
    );
    actions.addIf(
      archiver,
      'unarchive',
      needsStatus(DOSSIER_STATES, status, 'UNARCHIVE'),
    );
    return actions.all;
  }

  // RG-DOS-005: what keeps a dossier from closing.
  private async openWork(id: string) {
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
    return { pending, awaitingValidation };
  }

  // One status change through the workflow engine (StatusHistory), with its fields.
  private async move(
    dossier: { id: string; status: DossierStatus; companyId: string },
    event: DossierEvent,
    data: Prisma.DossierUncheckedUpdateInput,
    to?: DossierStatus,
    reason?: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await this.workflow.transition(tx, {
        table: DOSSIER_STATES,
        delegate: tx.dossier,
        entityId: dossier.id,
        event,
        from: dossier.status,
        to,
        reason,
        data,
        companyId: dossier.companyId,
      });
      return tx.dossier.findUniqueOrThrow({
        where: { id: dossier.id },
        include: dossierInclude,
      });
    });
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
