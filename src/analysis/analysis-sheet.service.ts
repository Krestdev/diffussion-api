import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AnalysisOpinion,
  InstructionStatus,
  LivrableStatus,
  Prisma,
  UserInstructionRole,
  ValidationDecision,
} from '../../generated/prisma/client';
import { ActivityService } from '../activity/activity.service';
import { AuditLog } from '../activity/decorators/audit-log.decorator';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RbacService } from '../auth/rbac/rbac.service';
import { DEFAULT_TAKE } from '../common/dto/pagination.query.dto';
import {
  assertDossierOpenForActivity,
  refreshDossierProgress,
} from '../common/utils/dossier-lifecycle';
import { createWithUniqueReference } from '../common/utils/generate-reference';
import { DatabaseService } from '../database/database.service';
import { suggestItemOpinion, suggestSheetOpinion } from './analysis-opinion';
import {
  CreateAnalysisItemDto,
  CreateAnalysisSheetDto,
  DecideAnalysisSheetDto,
  FindAnalysisSheetsQueryDto,
  SetCriteriaDto,
  UpdateAnalysisItemDto,
  UpdateAnalysisSheetDto,
} from './dto/analysis.dto';

// A fiche is editable only while its livrable is still being prepared.
// Once submitted it is read-only, and a decision freezes it for good.
const EDITABLE_LIVRABLE_STATUSES: LivrableStatus[] = [
  LivrableStatus.EN_PREPARATION,
  LivrableStatus.DEPOSE,
];
const SUBMITTED_LIVRABLE_STATUSES: LivrableStatus[] = [
  LivrableStatus.SOUMIS,
  LivrableStatus.EN_VALIDATION,
];
// A rejected (or archived) fiche is history: it no longer occupies the
// delivery, so a new version may be opened on the same courrier.
const CLOSED_LIVRABLE_STATUSES: LivrableStatus[] = [
  LivrableStatus.REJETE,
  LivrableStatus.ARCHIVE,
];

const sheetInclude = {
  courrier: { select: { id: true, number: true, subject: true } },
  dossier: { select: { id: true, number: true, title: true } },
  project: {
    select: {
      id: true,
      name: true,
      reference: true,
      mode: true,
      maitreOuvrage: { select: { id: true, name: true } },
    },
  },
  livrable: {
    select: {
      id: true,
      title: true,
      status: true,
      version: true,
      instructionId: true,
    },
  },
  author: { select: { id: true, name: true, email: true } },
  decidedBy: { select: { id: true, name: true } },
  items: {
    orderBy: { order: 'asc' },
    include: {
      document: { select: { id: true, originalName: true } },
      criteria: { orderBy: { order: 'asc' } },
    },
  },
} satisfies Prisma.AnalysisSheetInclude;

@Injectable()
export class AnalysisSheetService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  /**
   * Opens the fiche for a delivery. The sheet is carried by a Livrable of the
   * given instruction, so an analysis behaves like any other deliverable:
   * same lifecycle, same versioning, same validation screens.
   */
  @AuditLog({
    action: 'analysis-sheet.created',
    entityType: 'analysis-sheet',
    operation: 'CREATE',
  })
  async create(dto: CreateAnalysisSheetDto, authorId: string) {
    const courrier = await this.database.courrier.findUnique({
      where: { id: dto.courrierId },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    if (!courrier) {
      throw new NotFoundException(`Courrier ${dto.courrierId} not found`);
    }
    const { dossierId } = courrier;
    if (!dossierId) {
      throw new BadRequestException(
        `Courrier ${courrier.number} is not attached to a dossier yet`,
      );
    }
    await assertDossierOpenForActivity(this.database, dossierId);

    await this.assertNoLiveSheet(dto.courrierId, courrier.number);

    const instruction = await this.database.instruction.findUnique({
      where: { id: dto.instructionId },
      select: {
        id: true,
        dossierId: true,
        assignees: { select: { userId: true, role: true } },
      },
    });
    if (!instruction) {
      throw new NotFoundException(`Instruction ${dto.instructionId} not found`);
    }
    if (instruction.dossierId !== dossierId) {
      throw new BadRequestException(
        'The instruction and the courrier belong to different dossiers',
      );
    }
    // The author is whoever was asked to do the analysis — an executant of
    // the instruction. Nobody else may open the fiche in their name.
    const isExecutant = instruction.assignees.some(
      (assignee) =>
        assignee.userId === authorId &&
        assignee.role === UserInstructionRole.EXECUTANT,
    );
    if (!isExecutant) {
      throw new ForbiddenException(
        "Only an executant of this instruction can produce its fiche d'analyse",
      );
    }

    const templates = await this.activeTemplates();
    const seedItems = dto.seedItemsFromCourrier ?? true;

    const { courrierId, instructionId, projectId, remise, ...rest } = dto;
    delete (rest as { seedItemsFromCourrier?: boolean }).seedItemsFromCourrier;

    return this.database.$transaction(async (tx) => {
      const livrable = await tx.livrable.create({
        data: {
          instructionId,
          title: `Fiche d'analyse — ${courrier.number}`,
          createdById: authorId,
        },
      });

      const sheet = await createWithUniqueReference('FA', (reference) =>
        tx.analysisSheet.create({
          data: {
            ...rest,
            reference,
            livrableId: livrable.id,
            courrierId,
            dossierId,
            projectId,
            authorId,
            remise: remise ? new Date(remise) : undefined,
            items: seedItems
              ? {
                  create: courrier.documents.map((document, index) => ({
                    documentId: document.id,
                    label: document.originalName,
                    order: index + 1,
                    criteria: {
                      create: templates.map((template, position) => ({
                        templateId: template.id,
                        label: template.label,
                        order: position + 1,
                      })),
                    },
                  })),
                }
              : undefined,
          },
          include: sheetInclude,
        }),
      );
      return sheet;
    });
  }

  async findAll(query: FindAnalysisSheetsQueryDto, userId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.AnalysisSheetWhereInput = {
      // Only the sites where the caller may read analyses.
      ...(await this.rbac.siteFilter(
        userId,
        PermissionCode.AnalysisRead,
        (siteId): Prisma.AnalysisSheetWhereInput => ({ dossier: { siteId } }),
      )),
      dossierId: query.dossierId,
      courrierId: query.courrierId,
      authorId: query.authorId,
      overallOpinion: query.overallOpinion,
      OR: query.search
        ? [
            { reference: { contains: query.search, mode: 'insensitive' } },
            { refBL: { contains: query.search, mode: 'insensitive' } },
            {
              courrier: {
                subject: { contains: query.search, mode: 'insensitive' },
              },
            },
          ]
        : undefined,
    };
    const [data, total] = await this.database.$transaction([
      this.database.analysisSheet.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          createdAt: true,
          suggestedOpinion: true,
          overallOpinion: true,
          decidedAt: true,
          courrier: { select: { id: true, number: true, subject: true } },
          dossier: { select: { id: true, number: true } },
          author: { select: { id: true, name: true } },
          livrable: { select: { status: true, version: true } },
          _count: { select: { items: true } },
        },
        skip,
        take,
      }),
      this.database.analysisSheet.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async findOne(id: string) {
    const sheet = await this.database.analysisSheet.findUnique({
      where: { id },
      include: sheetInclude,
    });
    if (!sheet) {
      throw new NotFoundException(`Analysis sheet ${id} not found`);
    }
    return sheet;
  }

  /**
   * The récapitulatif of spec §8: one line per element with its avis, so the
   * synthesis is readable without opening every table.
   */
  async summary(id: string) {
    const sheet = await this.findOne(id);
    return {
      reference: sheet.reference,
      courrier: sheet.courrier,
      author: sheet.author,
      suggestedOpinion: sheet.suggestedOpinion,
      overallOpinion: sheet.overallOpinion,
      decidedBy: sheet.decidedBy,
      decidedAt: sheet.decidedAt,
      items: sheet.items.map((item) => ({
        order: item.order,
        label: item.label,
        document: item.document,
        suggestedOpinion: item.suggestedOpinion,
        opinion: item.opinion,
        observation: item.observation,
      })),
    };
  }

  @AuditLog({
    action: 'analysis-sheet.updated',
    entityType: 'analysis-sheet',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateAnalysisSheetDto) {
    await this.assertEditable(id);
    // courrierId/instructionId are fixed once the fiche exists, and the
    // seeding flag only applies at creation.
    const { courrierId, remise, ...rest } = dto;
    delete (rest as { instructionId?: string }).instructionId;
    delete (rest as { seedItemsFromCourrier?: boolean }).seedItemsFromCourrier;
    if (courrierId) {
      throw new BadRequestException(
        'The delivery a fiche analyses cannot be changed — create a fiche on the other courrier instead',
      );
    }
    return this.database.analysisSheet.update({
      where: { id },
      data: {
        ...rest,
        ...(remise !== undefined ? { remise: new Date(remise) } : {}),
      },
      include: sheetInclude,
    });
  }

  async addItem(sheetId: string, dto: CreateAnalysisItemDto) {
    const sheet = await this.assertEditable(sheetId);
    const document = await this.database.document.findUnique({
      where: { id: dto.documentId },
      select: { courrierId: true },
    });
    if (!document) {
      throw new NotFoundException(`Document ${dto.documentId} not found`);
    }
    if (document.courrierId !== sheet.courrierId) {
      throw new BadRequestException(
        'This document was not delivered with the courrier this fiche analyses',
      );
    }
    if (sheet.items.some((item) => item.documentId === dto.documentId)) {
      throw new BadRequestException(
        'This document is already an element of the fiche',
      );
    }

    const templates = await this.activeTemplates();
    const order =
      dto.order ??
      sheet.items.reduce((max, item) => Math.max(max, item.order), 0) + 1;

    await this.database.analysisItem.create({
      data: {
        sheetId,
        documentId: dto.documentId,
        label: dto.label,
        description: dto.description,
        observation: dto.observation,
        order,
        criteria: {
          create: templates.map((template, position) => ({
            templateId: template.id,
            label: template.label,
            order: position + 1,
          })),
        },
      },
    });
    return this.refresh(sheetId);
  }

  async updateItem(itemId: string, dto: UpdateAnalysisItemDto) {
    const item = await this.database.analysisItem.findUnique({
      where: { id: itemId },
      select: { sheetId: true },
    });
    if (!item) {
      throw new NotFoundException(`Analysis item ${itemId} not found`);
    }
    await this.assertEditable(item.sheetId);
    await this.database.analysisItem.update({
      where: { id: itemId },
      data: dto,
    });
    return this.refresh(item.sheetId);
  }

  async removeItem(itemId: string) {
    const item = await this.database.analysisItem.findUnique({
      where: { id: itemId },
      select: { sheetId: true },
    });
    if (!item) {
      throw new NotFoundException(`Analysis item ${itemId} not found`);
    }
    await this.assertEditable(item.sheetId);
    await this.database.analysisItem.delete({ where: { id: itemId } });
    return this.refresh(item.sheetId);
  }

  /**
   * Full-replace of one element's grid. Criteria are copied per element, so
   * editing this grid never affects another element (spec §4).
   */
  async setCriteria(itemId: string, dto: SetCriteriaDto) {
    const item = await this.database.analysisItem.findUnique({
      where: { id: itemId },
      select: { sheetId: true },
    });
    if (!item) {
      throw new NotFoundException(`Analysis item ${itemId} not found`);
    }
    await this.assertEditable(item.sheetId);
    const labels = dto.criteria.map((c) => c.label);
    if (new Set(labels).size !== labels.length) {
      throw new BadRequestException(
        'Each criterion may appear only once on an element',
      );
    }

    await this.database.$transaction([
      this.database.analysisItemCriterion.deleteMany({ where: { itemId } }),
      this.database.analysisItemCriterion.createMany({
        data: dto.criteria.map((criterion, index) => ({
          itemId,
          templateId: criterion.templateId,
          label: criterion.label,
          opinion: criterion.opinion,
          observation: criterion.observation,
          order: index + 1,
        })),
      }),
    ]);
    return this.refresh(item.sheetId);
  }

  /**
   * The author hands the fiche over for validation. Only they can: the fiche
   * belongs to the person who was asked to produce it. The livrable moves to
   * SOUMIS and the instruction to EN_ATTENTE_VALIDATION, so the analysis
   * appears in the supervisor's queue like any other deliverable.
   */
  @AuditLog({
    action: 'analysis-sheet.submitted',
    entityType: 'analysis-sheet',
    operation: 'UPDATE',
  })
  async submit(id: string, userId: string) {
    const sheet = await this.assertEditable(id);
    if (sheet.authorId !== userId) {
      throw new ForbiddenException(
        'Only the author of this fiche can submit it for validation',
      );
    }
    if (sheet.items.length === 0) {
      throw new BadRequestException('This fiche has no element to submit');
    }
    const undecided = sheet.items.filter((item) => item.opinion === null);
    if (undecided.length > 0) {
      throw new BadRequestException(
        `${undecided.length} element(s) have no avis yet — pronounce on each element before submitting`,
      );
    }

    await this.database.$transaction([
      this.database.livrable.update({
        where: { id: sheet.livrableId },
        data: { status: LivrableStatus.SOUMIS },
      }),
      this.database.instruction.update({
        where: { id: sheet.livrable.instructionId },
        data: { status: InstructionStatus.EN_ATTENTE_VALIDATION },
      }),
    ]);
    return this.findOne(id);
  }

  /**
   * The person in charge pronounces the avis of the delivery. They may depart
   * from the suggestion — with a motif — because the system proposes and the
   * chef de projet decides (spec §9).
   */
  @AuditLog({
    action: 'analysis-sheet.decided',
    entityType: 'analysis-sheet',
    operation: 'UPDATE',
  })
  async decide(id: string, dto: DecideAnalysisSheetDto, decidedById: string) {
    const sheet = await this.findOne(id);
    if (!SUBMITTED_LIVRABLE_STATUSES.includes(sheet.livrable.status)) {
      throw new BadRequestException(
        sheet.decidedAt
          ? `This fiche was already decided on ${sheet.decidedAt.toISOString().slice(0, 10)} (${sheet.overallOpinion}) — a decision is final`
          : 'This fiche has not been submitted for validation yet',
      );
    }
    const undecided = sheet.items.filter((item) => item.opinion === null);
    if (undecided.length > 0) {
      throw new BadRequestException(
        `${undecided.length} element(s) have no avis yet — pronounce on each element before concluding`,
      );
    }
    if (dto.overallOpinion !== sheet.suggestedOpinion && !dto.motif) {
      throw new BadRequestException(
        `A motif is required when the avis (${dto.overallOpinion}) differs from the one suggested by the grid (${sheet.suggestedOpinion ?? 'none'})`,
      );
    }

    // AF/AFR accept the delivery; AS/AD send it back for a new analysis.
    const accepted =
      dto.overallOpinion === AnalysisOpinion.AF ||
      dto.overallOpinion === AnalysisOpinion.AFR;
    const instructionId = sheet.livrable.instructionId;

    await this.database.$transaction(async (tx) => {
      await tx.analysisSheet.update({
        where: { id },
        data: {
          overallOpinion: dto.overallOpinion,
          opinionMotif: dto.motif,
          decidedById,
          decidedAt: new Date(),
        },
      });
      // Same trail as courrier validation: who decided, what, why.
      await tx.validation.create({
        data: {
          analysisSheetId: id,
          validatorId: decidedById,
          decision: accepted
            ? ValidationDecision.VALIDE
            : ValidationDecision.REJETE,
          motif: dto.motif,
        },
      });
      await tx.livrable.update({
        where: { id: sheet.livrableId },
        data: {
          status: accepted ? LivrableStatus.VALIDE : LivrableStatus.REJETE,
        },
      });

      if (accepted) {
        // The task is done once nothing else is *pending* on it. Rejected or
        // archived versions are superseded history, not outstanding work —
        // counting them would leave the instruction open for ever.
        const outstanding = await tx.livrable.count({
          where: {
            instructionId,
            status: {
              notIn: [LivrableStatus.VALIDE, ...CLOSED_LIVRABLE_STATUSES],
            },
          },
        });
        if (outstanding === 0) {
          await tx.instruction.update({
            where: { id: instructionId },
            data: {
              status: InstructionStatus.TERMINEE,
              closedAt: new Date(),
            },
          });
        }
      } else {
        await tx.instruction.update({
          where: { id: instructionId },
          data: {
            status: InstructionStatus.A_CORRIGER,
            // Always leave a reason on the task, even when the avis followed
            // the grid and needed no motif of its own.
            refusalReason:
              dto.motif ??
              `Fiche ${sheet.reference} rejetée (avis ${dto.overallOpinion})`,
          },
        });
      }
    });

    if (accepted) {
      await refreshDossierProgress(this.database, sheet.dossierId);
      return this.findOne(id);
    }
    // Rejected: v1 stays as it is, readable for ever, and a fresh version is
    // opened for the author to redo the analysis.
    const next = await this.createNextVersion(id);
    return { ...(await this.findOne(id)), nextVersion: next };
  }

  /**
   * Opens the version that replaces a rejected fiche: a new livrable version
   * of the same instruction, and a sheet carrying the same structure —
   * elements and criteria — with every judgement blank, because the previous
   * one is precisely what was rejected.
   */
  private async createNextVersion(rejectedSheetId: string) {
    const previous = await this.findOne(rejectedSheetId);

    return this.database.$transaction(async (tx) => {
      const livrable = await tx.livrable.create({
        data: {
          instructionId: previous.livrable.instructionId,
          title: previous.livrable.title,
          version: previous.livrable.version + 1,
          parentVersionId: previous.livrableId,
          createdById: previous.authorId,
        },
      });

      return createWithUniqueReference('FA', (reference) =>
        tx.analysisSheet.create({
          data: {
            reference,
            livrableId: livrable.id,
            courrierId: previous.courrierId,
            dossierId: previous.dossierId,
            projectId: previous.projectId,
            authorId: previous.authorId,
            parentSheetId: previous.id,
            refBL: previous.refBL,
            lieuUsage: previous.lieuUsage,
            remise: previous.remise,
            norme: previous.norme,
            docsReferences: previous.docsReferences,
            items: {
              create: previous.items.map((item) => ({
                documentId: item.documentId,
                label: item.label,
                description: item.description,
                // observation and opinion deliberately left empty: they
                // justified the judgement that was just rejected.
                order: item.order,
                criteria: {
                  create: item.criteria.map((criterion) => ({
                    templateId: criterion.templateId,
                    label: criterion.label,
                    order: criterion.order,
                  })),
                },
              })),
            },
          },
          include: sheetInclude,
        }),
      );
    });
  }

  /**
   * A delivery may carry several fiches over time, but only one live at a
   * time — the others are rejected versions kept for the record.
   */
  private async assertNoLiveSheet(courrierId: string, courrierNumber: string) {
    const live = await this.database.analysisSheet.findFirst({
      where: {
        courrierId,
        livrable: { status: { notIn: CLOSED_LIVRABLE_STATUSES } },
      },
      select: { reference: true },
    });
    if (live) {
      throw new BadRequestException(
        `Courrier ${courrierNumber} already has the analysis sheet ${live.reference} — one live fiche per delivery`,
      );
    }
  }

  /** Blocks every change once the fiche has left the author's hands. */
  private async assertEditable(id: string) {
    const sheet = await this.findOne(id);
    if (!EDITABLE_LIVRABLE_STATUSES.includes(sheet.livrable.status)) {
      throw new BadRequestException(
        sheet.decidedAt
          ? `Fiche ${sheet.reference} was decided (${sheet.overallOpinion}) and can no longer be modified`
          : `Fiche ${sheet.reference} has been submitted for validation and can no longer be modified`,
      );
    }
    return sheet;
  }

  /** The default grid: every active criterion, the same for all dossiers. */
  private activeTemplates() {
    return this.database.analysisCriterionTemplate.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Recomputes every suggestion after a change: each element from its own
   * criteria, then the delivery from its elements. Suggestions only — the
   * pronounced opinions are never overwritten.
   */
  private async refresh(sheetId: string) {
    const items = await this.database.analysisItem.findMany({
      where: { sheetId },
      include: { criteria: { select: { opinion: true } } },
    });

    await this.database.$transaction(
      items.map((item) =>
        this.database.analysisItem.update({
          where: { id: item.id },
          data: { suggestedOpinion: suggestItemOpinion(item.criteria) },
        }),
      ),
    );

    const refreshed = items.map((item) => ({
      opinion: item.opinion,
      suggestedOpinion: suggestItemOpinion(item.criteria),
    }));
    await this.database.analysisSheet.update({
      where: { id: sheetId },
      data: { suggestedOpinion: suggestSheetOpinion(refreshed) },
    });

    return this.findOne(sheetId);
  }
}
