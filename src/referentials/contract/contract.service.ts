import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  ProjectContentType,
  ProjectStatus,
  Prisma,
  UserStatus,
} from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService } from '../../auth/rbac/rbac.service';
import { ownSiteFilter } from '../../common/utils/site-referentials';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import {
  assertActiveUsers,
  visibleContractWhere,
} from '../../common/utils/referential-access';
import { assertCorrespondentActive } from '../../common/utils/referential-guards';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { endingWithin } from '../project/project.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { FindContractsQueryDto } from './dto/find-contracts.query.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

const contractInclude = {
  project: {
    select: { id: true, name: true, reference: true, contentType: true },
  },
  client: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true, email: true } },
  _count: { select: { dossiers: true, accesses: true } },
} satisfies Prisma.ContractInclude;

type ContractRow = Prisma.ContractGetPayload<{
  include: typeof contractInclude;
}>;

/**
 * Contracts (marchés): optionally part of a project, they contain dossiers
 * (Dossier.contractId). Each may list the users allowed to open it
 * (ContractAccess, see visibleContractWhere); platform administrators see
 * them all.
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
  ) {}

  // The active contract types (PA·7), in their order — the form's choices.
  async types() {
    const types = await this.database.contractTypeItem.findMany({
      where: { active: true },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      select: { code: true, label: true, description: true },
    });
    return types.map((type) => ({
      value: type.code,
      label: type.label,
      description: type.description,
    }));
  }

  // A contract's kind: an active type, checked when it changes.
  private async assertTypeUsable(
    code: string | undefined,
    current?: string | null,
  ) {
    if (!code || code === current) return;
    const type = await this.database.contractTypeItem.findUnique({
      where: { code },
      select: { active: true, label: true },
    });
    if (!type) throw new BadRequestException(`Unknown contract type ${code}`);
    if (!type.active) {
      throw new BadRequestException(
        `The contract type « ${type.label} » is inactive and can no longer be chosen`,
      );
    }
  }

  @AuditLog({
    action: 'contract.created',
    entityType: 'contract',
    operation: 'CREATE',
  })
  async create(dto: CreateContractDto, actingUserId: string) {
    const { startDate, endDate, signedAt, authorizedUserIds, ...data } = dto;
    await this.assertTypeUsable(dto.type);
    await this.assertProjectOpen(dto.projectId);
    await this.assertManages(
      await this.siteOfProject(dto.projectId ?? null),
      actingUserId,
      PermissionCode.ContractCreate,
    );
    await this.assertLinks(data);
    const dates = toDates(startDate, endDate);
    assertDateOrder(dates.startDate, dates.endDate);
    const authorized = await assertActiveUsers(
      this.database,
      authorizedUserIds ?? [],
    );
    const contract = await createWithUniqueReference('CT', (number) =>
      this.database.contract.create({
        data: {
          ...data,
          ...dates,
          signedAt: toDate(signedAt),
          number,
          accesses: {
            create: authorized.map((userId) => ({ userId })),
          },
        },
        include: contractInclude,
      }),
    );
    return (await this.withCounts([contract]))[0];
  }

  async findAll(query: FindContractsQueryDto, userId: string) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const now = new Date();
    const where: Prisma.ContractWhereInput = {
      projectId: query.projectId,
      project: query.siteId ? { siteId: query.siteId } : undefined,
      status: query.status,
      type: query.type,
      endDate:
        query.endingWithinDays !== undefined
          ? endingWithin(
              query.endingWithinDays,
              new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            )
          : undefined,
      OR: contains && [
        { number: contains },
        { title: contains },
        { reference: contains },
        { tenderReference: contains },
      ],
      AND: [
        await this.visibleTo(userId),
        query.correspondentId
          ? {
              OR: [
                { clientId: query.correspondentId },
                {
                  courriers: {
                    some: { correspondentId: query.correspondentId },
                  },
                },
                {
                  dossiers: {
                    some: {
                      courriers: {
                        some: { correspondentId: query.correspondentId },
                      },
                    },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const [rows, total] = await this.database.$transaction([
      this.database.contract.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: contractInclude,
        skip,
        take,
      }),
      this.database.contract.count({ where }),
    ]);
    return { data: await this.withCounts(rows), total, skip, take };
  }

  // Unrestricted: used internally and by @AuditLog. Users go through
  // findOneFor.
  async findOne(id: string) {
    const contract = await this.database.contract.findUnique({
      where: { id },
      include: {
        ...contractInclude,
        dossiers: {
          select: { id: true, number: true, title: true, status: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!contract) {
      throw new NotFoundException(`Contract ${id} not found`);
    }
    return (await this.withCounts([contract]))[0];
  }

  async findOneFor(id: string, userId: string) {
    await this.assertVisible(id, userId);
    return this.findOne(id);
  }

  // Moving a contract to another project moves its dossiers with it: they
  // belong to their contract's project. An archived contract is frozen
  // until it is unarchived.
  @AuditLog({
    action: 'contract.updated',
    entityType: 'contract',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateContractDto, actingUserId: string) {
    const existing = await this.findOne(id);
    const siteId = await this.siteOfProject(existing.projectId);
    await this.assertManages(
      siteId,
      actingUserId,
      PermissionCode.ContractUpdate,
    );
    // It stays on its site: moved to another project of the same site only.
    if (
      dto.projectId !== undefined &&
      dto.projectId !== existing.projectId &&
      existing.projectId &&
      (await this.siteOfProject(dto.projectId)) !== siteId
    ) {
      throw new BadRequestException(
        'A contract can only move to another project of its own site',
      );
    }
    if (existing.status === ContractStatus.ARCHIVED) {
      throw new BadRequestException(
        'This contract is archived — unarchive it before changing it',
      );
    }
    const { startDate, endDate, signedAt, ...data } = dto;
    await this.assertTypeUsable(dto.type, existing.type);
    await this.assertLinks(data, existing);
    const dates = toDates(startDate, endDate);
    assertDateOrder(
      dates.startDate !== undefined ? dates.startDate : existing.startDate,
      dates.endDate !== undefined ? dates.endDate : existing.endDate,
    );
    const projectChanged =
      dto.projectId !== undefined && dto.projectId !== existing.projectId;
    await this.database.$transaction(async (tx) => {
      if (projectChanged) {
        await tx.dossier.updateMany({
          where: { contractId: id },
          data: { projectId: dto.projectId },
        });
      }
      await tx.contract.update({
        where: { id },
        data: { ...data, ...dates, signedAt: toDate(signedAt) },
      });
    });
    return this.findOne(id);
  }

  @AuditLog({
    action: 'contract.archived',
    entityType: 'contract',
    operation: 'UPDATE',
  })
  async archive(id: string, actingUserId: string, reason?: string) {
    const contract = await this.findOne(id);
    await this.assertManages(
      await this.siteOfProject(contract.projectId),
      actingUserId,
      PermissionCode.ContractArchive,
    );
    if (contract.status === ContractStatus.ARCHIVED) {
      throw new BadRequestException('This contract is already archived');
    }
    await this.database.contract.update({
      where: { id },
      data: {
        status: ContractStatus.ARCHIVED,
        archivedAt: new Date(),
        archiveReason: reason ?? null,
      },
    });
    return this.findOne(id);
  }

  @AuditLog({
    action: 'contract.unarchived',
    entityType: 'contract',
    operation: 'UPDATE',
    metadata: (args) => (args[2] ? { note: args[2] } : undefined),
  })
  async unarchive(id: string, actingUserId: string, note?: string) {
    void note; // Read by @AuditLog.
    const contract = await this.findOne(id);
    await this.assertManages(
      await this.siteOfProject(contract.projectId),
      actingUserId,
      PermissionCode.ContractArchive,
    );
    if (contract.status !== ContractStatus.ARCHIVED) {
      throw new BadRequestException('This contract is not archived');
    }
    await this.database.contract.update({
      where: { id },
      data: {
        status: ContractStatus.ACTIVE,
        archivedAt: null,
        archiveReason: null,
      },
    });
    return this.findOne(id);
  }

  @AuditLog({
    action: 'contract.deleted',
    entityType: 'contract',
    operation: 'DELETE',
  })
  async remove(id: string, actingUserId: string) {
    const contract = await this.findOne(id);
    await this.assertManages(
      await this.siteOfProject(contract.projectId),
      actingUserId,
      PermissionCode.ContractArchive,
    );
    if (contract._count.dossiers > 0) {
      throw new ConflictException(
        `This contract still contains ${contract._count.dossiers} dossier(s) — move or detach them first`,
      );
    }
    const documents = await this.database.document.count({
      where: { contractId: id },
    });
    if (documents > 0) {
      throw new ConflictException(
        `This contract still has ${documents} document(s) — remove them first`,
      );
    }
    await this.database.contract.delete({ where: { id } });
  }

  async getAccess(id: string, userId: string) {
    await this.assertVisible(id, userId);
    return this.accessList(id);
  }

  // Replaces the list. A platform administrator or the contract's
  // responsible may.
  async setAccess(id: string, userIds: string[], actingUserId: string) {
    const contract = await this.findOne(id);
    if (
      contract.responsibleId !== actingUserId &&
      !(await this.isAdmin(actingUserId))
    ) {
      throw new ForbiddenException(
        "Only the contract's responsible or a platform administrator can change who may open it",
      );
    }
    const before = (await this.accessList(id)).map((user) => user.id);
    const allowed = await assertActiveUsers(this.database, userIds);
    await this.database.$transaction([
      this.database.contractAccess.deleteMany({ where: { contractId: id } }),
      this.database.contractAccess.createMany({
        data: allowed.map((userId) => ({ contractId: id, userId })),
      }),
    ]);
    await this.activity.tryRecord({
      action: 'contract.access.updated',
      entityType: 'contract',
      entityId: id,
      changes: { authorized: [before, allowed] },
    });
    await this.notifications.notifyAccessChanged(
      allowed.filter((userId) => !before.includes(userId)),
      actingUserId,
      `Vous avez désormais accès au contrat « ${contract.title} ».`,
    );
    return this.accessList(id);
  }

  // What was done on the contract itself, latest first.
  async history(id: string, userId: string, query: PaginationQueryDto) {
    await this.assertVisible(id, userId);
    return this.activity.findAll(
      {
        entityType: 'contract',
        entityId: id,
        skip: query.skip,
        take: query.take,
      },
      'ALL',
    );
  }

  private accessList(contractId: string) {
    return this.database.user.findMany({
      where: { contractAccesses: { some: { contractId } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  // `_count` as the page shows it: dossiers, authorized users, and the
  // courriers dispatched to it or in its dossiers (one query for the whole
  // page).
  private async withCounts<T extends ContractRow>(contracts: T[]) {
    const ids = contracts.map((contract) => contract.id);
    const courriers = await this.database.courrier.findMany({
      where: {
        OR: [
          { contractId: { in: ids } },
          { dossier: { contractId: { in: ids } } },
        ],
      },
      select: { contractId: true, dossier: { select: { contractId: true } } },
    });
    const contractOf = (courrier: (typeof courriers)[number]) =>
      courrier.contractId ?? courrier.dossier?.contractId;
    return contracts.map(({ _count, ...contract }) => ({
      ...contract,
      _count: {
        dossiers: _count.dossiers,
        authorized: _count.accesses,
        courriers: courriers.filter(
          (courrier) => contractOf(courrier) === contract.id,
        ).length,
      },
    }));
  }

  private isAdmin(userId: string) {
    return this.rbac.hasGlobalPermission(
      userId,
      PermissionCode.AdminManageReferentials,
    );
  }

  // Those of its own site's projects (open to them) — all of them for a
  // platform administrator. A contract without a project is the platform
  // administrators' only.
  private async visibleTo(userId: string): Promise<Prisma.ContractWhereInput> {
    const site = await ownSiteFilter(this.rbac, this.database, userId);
    return site ? { project: site, ...visibleContractWhere(userId) } : {};
  }

  private async assertProjectOpen(projectId?: string | null) {
    if (!projectId) return;
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { name: true, status: true },
    });
    if (
      project?.status === ProjectStatus.CLOSED ||
      project?.status === ProjectStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        `The project "${project.name}" is closed — nothing new can be added to it`,
      );
    }
  }

  private async siteOfProject(projectId: string | null) {
    if (!projectId) return null;
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { siteId: true },
    });
    if (!project) {
      throw new BadRequestException(`Project ${projectId} not found`);
    }
    return project.siteId;
  }

  // A contract is managed by the responsible of its project's site, whoever
  // holds ADMIN_MANAGE_REFERENTIALS there, or a platform administrator (the
  // only one for a contract without project).
  private async assertManages(
    siteId: string | null,
    userId: string,
    permission: PermissionCode,
  ) {
    await this.rbac.assertManagesSite(userId, permission, siteId, 'Ce contrat');
  }

  // A contract the user may not open is reported as not found.
  private async assertVisible(id: string, userId: string) {
    const visible = await this.database.contract.count({
      where: { id, AND: [await this.visibleTo(userId)] },
    });
    if (!visible) {
      throw new NotFoundException(`Contract ${id} not found`);
    }
  }

  // Project, client and responsible must exist (and be active) — checked
  // only when they change.
  private async assertLinks(
    dto: { projectId?: string; clientId?: string; responsibleId?: string },
    current?: {
      projectId: string | null;
      clientId: string | null;
      responsibleId: string | null;
    },
  ) {
    if (dto.projectId && dto.projectId !== current?.projectId) {
      const project = await this.database.project.findUnique({
        where: { id: dto.projectId },
        select: { name: true, contentType: true },
      });
      if (!project) {
        throw new BadRequestException(`Project ${dto.projectId} not found`);
      }
      if (project.contentType === ProjectContentType.DOSSIERS) {
        throw new BadRequestException(
          `Le projet « ${project.name} » ne contient que des dossiers : aucun contrat ne peut y être rattaché`,
        );
      }
    }
    if (dto.clientId && dto.clientId !== current?.clientId) {
      await assertCorrespondentActive(this.database, dto.clientId);
    }
    if (dto.responsibleId && dto.responsibleId !== current?.responsibleId) {
      const user = await this.database.user.findUnique({
        where: { id: dto.responsibleId },
        select: { status: true },
      });
      if (user?.status !== UserStatus.ACTIVE) {
        throw new BadRequestException(
          `User ${dto.responsibleId} not found or inactive`,
        );
      }
    }
  }
}

function toDate(value?: string) {
  return value !== undefined ? new Date(value) : undefined;
}

// `undefined` keeps a date as is (update), a string sets it.
function toDates(startDate?: string, endDate?: string) {
  return { startDate: toDate(startDate), endDate: toDate(endDate) };
}

function assertDateOrder(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
) {
  if (startDate && endDate && endDate < startDate) {
    throw new BadRequestException(
      "A contract can't end before it starts (endDate before startDate)",
    );
  }
}
