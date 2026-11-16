import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
import {
  assertCompanyExists,
  companyReferentialsWhere,
} from '../../common/utils/company-referentials';
import { DatabaseService } from '../../database/database.service';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import {
  CreateCorrespondentContactDto,
  UpdateCorrespondentContactDto,
} from './dto/correspondent-contact.dto';
import { CreateCorrespondentDto } from './dto/create-correspondent.dto';
import { WorkflowService } from '../../workflow/workflow.service';
import { CORRESPONDENT_STATES } from './correspondent.states';
import { FindCorrespondantsQueryDto } from './dto/find-correspondents.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondent.dto';

const includeType = {
  type: true,
  company: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CorrespondentInclude;

const contactSelect = {
  id: true,
  correspondentId: true,
  name: true,
  position: true,
  phone: true,
  email: true,
  createdAt: true,
} satisfies Prisma.CorrespondentContactSelect;

/**
 * A correspondent belongs to one company: only that company's effets use it. Made
 * and managed by whoever holds the correspondent codes in that company;
 * everyone sees their own company's.
 */
@Injectable()
export class CorrespondantService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly workflow: WorkflowService,
  ) {}

  @AuditLog({
    action: 'correspondent.created',
    entityType: 'correspondent',
    operation: 'CREATE',
  })
  async create(dto: CreateCorrespondentDto, actingUserId: string) {
    await this.assertManages(
      dto.companyId,
      actingUserId,
      Permission.CORRESPONDENT_CREATE,
    );
    await assertCompanyExists(this.database, dto.companyId);
    if (dto.typeId) await this.assertTypeUsable(dto.typeId, dto.companyId);
    return createWithUniqueReference('CP', (code) =>
      this.database.$transaction(async (tx) => {
        const created = await tx.correspondent.create({
          data: {
            ...dto,
            code,
            contacts: dto.mainContact?.trim()
              ? { create: { name: dto.mainContact.trim() } }
              : undefined,
          },
          include: includeType,
        });
        await this.workflow.record(tx, {
          table: CORRESPONDENT_STATES,
          entityId: created.id,
          toStatus: created.status,
          companyId: created.companyId,
        });
        return created;
      }),
    );
  }

  async findAll(query: FindCorrespondantsQueryDto, userId: string) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.CorrespondentWhereInput = {
      ...(await companyReferentialsWhere(
        this.access,
        this.database,
        userId,
        query.companyId,
      )),
      typeId: query.typeId,
      city: query.city
        ? { contains: query.city, mode: 'insensitive' }
        : undefined,
      status: query.status,
      OR: contains && [
        { name: contains },
        { code: contains },
        { email: contains },
        { phone: contains },
        { mainContact: contains },
      ],
    };

    const [data, total] = await this.database.$transaction([
      this.database.correspondent.findMany({
        where,
        include: includeType,
        orderBy: { name: 'asc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.correspondent.count({ where }),
    ]);

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(uuid: string, userId?: string) {
    const correspondent = await this.database.correspondent.findFirst({
      where: {
        id: uuid,
        ...(userId
          ? await companyReferentialsWhere(this.access, this.database, userId)
          : {}),
      },
      // The counts for its card only: @AuditLog compares the bare row.
      include: userId
        ? {
            ...includeType,
            _count: { select: { courriers: true, contacts: true } },
          }
        : includeType,
    });
    if (!correspondent) {
      throw new NotFoundException(`Correspondent ${uuid} not found`);
    }
    return correspondent;
  }

  @AuditLog({
    action: 'correspondent.updated',
    entityType: 'correspondent',
    operation: 'UPDATE',
  })
  async update(
    uuid: string,
    dto: UpdateCorrespondantDto,
    actingUserId: string,
  ) {
    const existing = await this.findOne(uuid);
    // Turning it off or on needs CORRESPONDENT_ARCHIVE, and only that.
    const statusChanges =
      dto.status !== undefined && dto.status !== existing.status;
    if (statusChanges) {
      await this.assertManages(
        existing.companyId,
        actingUserId,
        Permission.CORRESPONDENT_ARCHIVE,
      );
    }
    const changesOtherFields = Object.entries(dto).some(
      ([field, value]) => field !== 'status' && value !== undefined,
    );
    if (!statusChanges || changesOtherFields) {
      await this.assertManages(
        existing.companyId,
        actingUserId,
        Permission.CORRESPONDENT_UPDATE,
      );
    }
    if (dto.typeId && dto.typeId !== existing.typeId) {
      await this.assertTypeUsable(dto.typeId, existing.companyId);
    }
    const contactToAdd = await this.newMainContact(
      uuid,
      dto.mainContact,
      existing.mainContact,
    );
    const { status, ...fields } = dto;
    return this.database.$transaction(async (tx) => {
      // Turned off or on: DEACTIVATE / ACTIVATE (StatusHistory).
      if (statusChanges) {
        await this.workflow.transition(tx, {
          table: CORRESPONDENT_STATES,
          delegate: tx.correspondent,
          entityId: uuid,
          event: status === 'INACTIVE' ? 'DEACTIVATE' : 'ACTIVATE',
          from: existing.status,
          companyId: existing.companyId,
        });
      }
      return tx.correspondent.update({
        where: { id: uuid },
        data: {
          ...fields,
          contacts: contactToAdd
            ? { create: { name: contactToAdd } }
            : undefined,
        },
        include: includeType,
      });
    });
  }

  @AuditLog({
    action: 'correspondent.deleted',
    entityType: 'correspondent',
    operation: 'DELETE',
  })
  async remove(uuid: string, actingUserId: string) {
    const existing = await this.findOne(uuid);
    await this.assertManages(
      existing.companyId,
      actingUserId,
      Permission.CORRESPONDENT_ARCHIVE,
    );
    try {
      await this.database.correspondent.delete({ where: { id: uuid } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Correspondent is still referenced by one or more courriers',
        );
      }
      throw error;
    }
  }

  // A changed main contact joins the contacts, unless already among them.
  private async newMainContact(
    correspondentId: string,
    mainContact: string | undefined,
    previous: string | null,
  ) {
    const name = mainContact?.trim();
    if (!name || name === previous) return undefined;
    const known = await this.database.correspondentContact.count({
      where: { correspondentId, name: { equals: name, mode: 'insensitive' } },
    });
    return known ? undefined : name;
  }

  async findContacts(
    correspondentId: string,
    query: PaginationQueryDto,
    userId: string,
  ) {
    await this.findOne(correspondentId, userId);
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where = { correspondentId };
    const [data, total] = await this.database.$transaction([
      this.database.correspondentContact.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        select: contactSelect,
      }),
      this.database.correspondentContact.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async createContact(
    correspondentId: string,
    dto: CreateCorrespondentContactDto,
    userId: string,
  ) {
    await this.assertManagesContacts(correspondentId, userId);
    const contact = await this.database.correspondentContact.create({
      data: { ...dto, correspondentId },
      select: contactSelect,
    });
    await this.journalContact('created', correspondentId, contact.name);
    return contact;
  }

  async updateContact(
    correspondentId: string,
    contactId: string,
    dto: UpdateCorrespondentContactDto,
    userId: string,
  ) {
    await this.assertManagesContacts(correspondentId, userId);
    await this.findContact(correspondentId, contactId);
    const contact = await this.database.correspondentContact.update({
      where: { id: contactId },
      data: dto,
      select: contactSelect,
    });
    await this.journalContact('updated', correspondentId, contact.name);
    return contact;
  }

  async removeContact(
    correspondentId: string,
    contactId: string,
    userId: string,
  ) {
    await this.assertManagesContacts(correspondentId, userId);
    const contact = await this.findContact(correspondentId, contactId);
    await this.database.correspondentContact.delete({
      where: { id: contactId },
    });
    await this.journalContact('deleted', correspondentId, contact.name);
  }

  private async findContact(correspondentId: string, contactId: string) {
    const contact = await this.database.correspondentContact.findFirst({
      where: { id: contactId, correspondentId },
      select: contactSelect,
    });
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found`);
    return contact;
  }

  private async assertManagesContacts(correspondentId: string, userId: string) {
    const correspondent = await this.findOne(correspondentId);
    await this.access.assertManages(
      userId,
      Permission.CORRESPONDENT_UPDATE,
      correspondent.companyId,
      'Cet expéditeur',
    );
  }

  // On the correspondent's own history.
  private journalContact(
    event: 'created' | 'updated' | 'deleted',
    correspondentId: string,
    name: string,
  ) {
    return this.activity.tryRecord({
      action: `correspondent.contact.${event}`,
      entityType: 'correspondent',
      entityId: correspondentId,
      metadata: { contact: name },
    });
  }

  private async assertManages(
    companyId: string,
    userId: string,
    permission: Permission,
  ) {
    await this.access.assertManages(
      userId,
      permission,
      companyId,
      'Cet expéditeur',
    );
  }

  // A correspondent's kind: an active type of its own company.
  private async assertTypeUsable(typeId: string, companyId: string) {
    const type = await this.database.correspondentType.findUnique({
      where: { id: typeId },
      select: { name: true, companyId: true, active: true },
    });
    if (!type) {
      throw new BadRequestException(`Correspondent type ${typeId} not found`);
    }
    if (type.companyId !== companyId) {
      throw new BadRequestException(
        `The correspondent type « ${type.name} » belongs to another company`,
      );
    }
    if (!type.active) {
      throw new BadRequestException(
        `The correspondent type « ${type.name} » is inactive and can no longer be chosen`,
      );
    }
  }
}
