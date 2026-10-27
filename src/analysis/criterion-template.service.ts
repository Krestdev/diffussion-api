import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { AuditLog } from '../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../database/database.service';
import {
  CreateCriterionTemplateDto,
  UpdateCriterionTemplateDto,
} from './dto/analysis.dto';

/**
 * The "document de critères d'analyse" as data: the default grid proposed on
 * every element. Editing it never rewrites sheets already filled — criteria
 * are copied onto each element at creation.
 */
@Injectable()
export class CriterionTemplateService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'analysis-criterion.created',
    entityType: 'analysis-criterion-template',
    operation: 'CREATE',
  })
  create(dto: CreateCriterionTemplateDto) {
    return this.database.analysisCriterionTemplate.create({ data: dto });
  }

  findAll() {
    return this.database.analysisCriterionTemplate.findMany({
      orderBy: { order: 'asc' },
    });
  }

  async findOne(id: string) {
    const template = await this.database.analysisCriterionTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException(`Criterion template ${id} not found`);
    }
    return template;
  }

  @AuditLog({
    action: 'analysis-criterion.updated',
    entityType: 'analysis-criterion-template',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateCriterionTemplateDto) {
    await this.findOne(id);
    return this.database.analysisCriterionTemplate.update({
      where: { id },
      data: dto,
    });
  }

  @AuditLog({
    action: 'analysis-criterion.deleted',
    entityType: 'analysis-criterion-template',
    operation: 'DELETE',
  })
  async remove(id: string) {
    await this.findOne(id);
    // Criteria already copied onto elements keep their own label, so removing
    // a template never mutates a filled sheet.
    await this.database.analysisCriterionTemplate.delete({ where: { id } });
  }
}
