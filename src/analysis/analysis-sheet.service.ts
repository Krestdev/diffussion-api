import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { extname } from 'path';
import {
  AnalysisOpinion,
  AnalysisSheetStatus,
  ContractStatus,
  CourrierStatus,
  InstructionStatus,
  LivrableStatus,
  Prisma,
  UserInstructionRole,
  UserStatus,
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
import { nextLivrablePosition } from '../common/utils/livrable-history';
import { StorageService } from '../storage/storage.service';
import { suggestItemOpinion, suggestSheetOpinion } from './analysis-opinion';
import { renderAnalysisSheetPdf } from './analysis-sheet-pdf';
import { LIVE_ANALYSIS_SHEET_WHERE } from './live-sheet';
import { CriterionTemplateService } from './criterion-template.service';
import { DocumentIdentityService } from '../administration/settings/document-identity.service';
import {
  CreateAnalysisItemDto,
  CreateAnalysisSheetDto,
  DecideAnalysisSheetDto,
  FindAnalysisSheetsQueryDto,
  NewAnalysisVersionDto,
  SetCriteriaDto,
  SignAnalysisSheetDto,
  UpdateAnalysisItemDto,
  UpdateAnalysisSheetDto,
} from './dto/analysis.dto';

// A fiche linked to an instruction is editable only while its livrable is
// still being prepared. Once submitted it is read-only, and a decision
// freezes it for good.
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

// The fiche's own lifecycle: editable until it is signed.
const EDITABLE_STATUSES: AnalysisSheetStatus[] = [
  AnalysisSheetStatus.BROUILLON,
  AnalysisSheetStatus.ENREGISTREE,
];
// A new version is opened from a fiche that was recorded or signed.
const VERSIONABLE_STATUSES: AnalysisSheetStatus[] = [
  AnalysisSheetStatus.ENREGISTREE,
  AnalysisSheetStatus.SIGNEE,
];

const sheetInclude = {
  courrier: { select: { id: true, number: true, subject: true } },
  dossier: { select: { id: true, number: true, title: true } },
  contract: {
    select: { id: true, number: true, reference: true, title: true },
  },
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
      position: true,
      instructionId: true,
    },
  },
  author: { select: { id: true, name: true, email: true } },
  validator: { select: { id: true, name: true, email: true } },
  decidedBy: { select: { id: true, name: true } },
  signedDocument: true,
  nextVersion: { select: { id: true, version: true } },
  items: {
    orderBy: { order: 'asc' },
    include: {
      document: { select: { id: true, originalName: true } },
      criteria: { orderBy: { order: 'asc' } },
    },
  },
} satisfies Prisma.AnalysisSheetInclude;

type Sheet = Prisma.AnalysisSheetGetPayload<{ include: typeof sheetInclude }>;

// The fiches of the given sites: through their dossier, or — without one —
// the site of whoever registered their courrier (as for effets).
export function sheetsAtSites(siteId: {
  in: string[];
}): Prisma.AnalysisSheetWhereInput {
  return {
    OR: [
      { dossier: { siteId } },
      { dossierId: null, courrier: { createdBy: { siteId } } },
    ],
  };
}

// An effet in one of these is done with: no new fiche (nor new version) is
// opened on it. Its existing fiches stay readable.
const FROZEN_EFFET_STATUSES: CourrierStatus[] = [
  CourrierStatus.CLOTURE,
  CourrierStatus.ARCHIVE,
  CourrierStatus.ANNULE,
];

const FROZEN_LABEL: Partial<Record<CourrierStatus, string>> = {
  [CourrierStatus.CLOTURE]: 'clôturé',
  [CourrierStatus.ARCHIVE]: 'archivé',
  [CourrierStatus.ANNULE]: 'annulé',
};

// `value` without the given keys.
function withoutKeys<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

// "1.0" -> "1.1", "1.9" -> "1.10".
function nextVersionNumber(version: string): string {
  const [major, minor] = version.split('.').map((n) => parseInt(n, 10));
  return `${Number.isNaN(major) ? 1 : major}.${(Number.isNaN(minor) ? 0 : minor) + 1}`;
}

@Injectable()
export class AnalysisSheetService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly storage: StorageService,
    private readonly criteria: CriterionTemplateService,
    private readonly identity: DocumentIdentityService,
  ) {}

  /**
   * Opens the fiche for a delivery. With an instruction, the sheet is carried
   * by one of its Livrables, so the analysis behaves like any other
   * deliverable (same validation screens). Without one, it stands on its own
   * effet entrant.
   */
  @AuditLog({
    action: 'analysis-sheet.created',
    entityType: 'analysis-sheet',
    operation: 'CREATE',
  })
  async create(dto: CreateAnalysisSheetDto, creatorId: string) {
    // Its author: the one named, else whoever opens it.
    const authorId = dto.authorId ?? creatorId;
    const courrier = await this.database.courrier.findUnique({
      where: { id: dto.courrierId },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    if (!courrier) {
      throw new NotFoundException(`Courrier ${dto.courrierId} not found`);
    }
    assertEffetOpen(courrier);
    // Its dossier, or — dispatched to a contract — its contract: either one
    // will do.
    const { dossierId, contractId } = courrier;
    if (dossierId) {
      await assertDossierOpenForActivity(this.database, dossierId);
    } else if (contractId) {
      await this.assertContractOpen(contractId);
    } else {
      throw new BadRequestException(
        `Courrier ${courrier.number} is attached to neither a dossier nor a contract yet — attach it to one first`,
      );
    }
    await this.assertNoLiveSheet(dto.courrierId, courrier.number);
    if (dto.validatorId) await this.assertActiveUser(dto.validatorId);
    if (dto.authorId) await this.assertActiveUser(dto.authorId, 'authorId');

    const { instructionId } = dto;
    if (instructionId) {
      await this.assertInstructionExecutant(
        instructionId,
        { dossierId, contractId },
        authorId,
      );
    }

    // The elements: those given, else one per document of the courrier.
    const documentIds = new Set(courrier.documents.map((d) => d.id));
    for (const item of dto.items ?? []) {
      if (item.documentId && !documentIds.has(item.documentId)) {
        throw new BadRequestException(
          `Document ${item.documentId} was not delivered with courrier ${courrier.number}`,
        );
      }
    }
    const items: CreateAnalysisItemDto[] =
      dto.items ??
      ((dto.seedItemsFromCourrier ?? true)
        ? courrier.documents.map((document) => ({
            documentId: document.id,
            label: document.originalName,
          }))
        : []);
    const templates = await this.defaultTemplates(
      await this.siteOfEffet(courrier),
    );

    const { courrierId, projectId, remise, ...fields } = dto;
    const rest = withoutKeys(fields, [
      'items',
      'seedItemsFromCourrier',
      'instructionId',
      'authorId',
    ]);

    const sheet = await this.database.$transaction(async (tx) => {
      const livrable = instructionId
        ? await tx.livrable.create({
            data: {
              instructionId,
              title: `Fiche d'analyse — ${courrier.number}`,
              position: await nextLivrablePosition(tx, instructionId),
              createdById: creatorId,
            },
          })
        : null;

      return createWithUniqueReference('FA', (reference) =>
        tx.analysisSheet.create({
          data: {
            ...rest,
            reference,
            livrableId: livrable?.id,
            courrierId,
            dossierId,
            contractId,
            projectId,
            authorId,
            remise: remise ? new Date(remise) : undefined,
            items: {
              create: items.map((item, index) => ({
                documentId: item.documentId,
                label: item.label,
                description: item.description,
                norms: item.norms,
                observation: item.observation,
                opinion: item.opinion,
                order: item.order ?? index + 1,
                criteria: {
                  create: templates.map((template, position) => ({
                    templateId: template.id,
                    label: template.label,
                    order: position + 1,
                  })),
                },
              })),
            },
          },
        }),
      );
    });
    return this.refresh(sheet.id);
  }

  async findAll(query: FindAnalysisSheetsQueryDto, userId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    // Everything but the status: the tab counts ignore the tab shown.
    // Only the sites where the caller may read analyses. Kept in AND: the
    // site filter is itself an OR, which the search below must not replace.
    const atSites = await this.rbac.siteFilter(
      userId,
      PermissionCode.AnalysisRead,
      (siteId): Prisma.AnalysisSheetWhereInput => sheetsAtSites(siteId),
    );
    const scope: Prisma.AnalysisSheetWhereInput = {
      AND: [atSites],
      dossierId: query.dossierId,
      contractId: query.contractId,
      courrierId: query.courrierId,
      authorId: query.authorId,
      overallOpinion: query.overallOpinion,
      OR: query.search
        ? [
            { reference: { contains: query.search, mode: 'insensitive' } },
            { refBL: { contains: query.search, mode: 'insensitive' } },
            { title: { contains: query.search, mode: 'insensitive' } },
            {
              courrier: {
                subject: { contains: query.search, mode: 'insensitive' },
              },
            },
          ]
        : undefined,
    };
    const where = { ...scope, status: query.status };
    const [data, total, byStatus] = await Promise.all([
      this.database.analysisSheet.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          version: true,
          courrierId: true,
          createdAt: true,
          updatedAt: true,
          suggestedOpinion: true,
          overallOpinion: true,
          decidedAt: true,
          signedAt: true,
          courrier: { select: { id: true, number: true, subject: true } },
          dossier: { select: { id: true, number: true } },
          contract: { select: { id: true, reference: true, title: true } },
          author: { select: { id: true, name: true } },
          livrable: { select: { status: true, version: true } },
          _count: { select: { items: true } },
        },
        skip,
        take,
      }),
      this.database.analysisSheet.count({ where }),
      this.database.analysisSheet.groupBy({
        by: ['status'],
        where: scope,
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(
      Object.values(AnalysisSheetStatus).map((status) => [status, 0]),
    ) as Record<AnalysisSheetStatus, number>;
    for (const group of byStatus) counts[group.status] = group._count._all;
    return { data, total, skip, take, metrics: { byStatus: counts } };
  }

  async findOne(id: string) {
    const sheet = await this.findSheet(id);
    return { ...sheet, versions: await this.versionsOf(sheet) };
  }

  /**
   * The récapitulatif of spec §8: one line per element with its avis, so the
   * synthesis is readable without opening every table.
   */
  async summary(id: string) {
    const sheet = await this.findSheet(id);
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
    const sheet = await this.assertEditable(id);
    // courrierId/instructionId are fixed once the fiche exists, and the
    // seeding flag only applies at creation.
    const { courrierId, remise, ...fields } = dto;
    const rest = withoutKeys(fields, [
      'instructionId',
      'seedItemsFromCourrier',
    ]);
    if (courrierId) {
      throw new BadRequestException(
        'The delivery a fiche analyses cannot be changed — create a fiche on the other courrier instead',
      );
    }
    if (dto.validatorId) await this.assertActiveUser(dto.validatorId);
    if (dto.authorId && dto.authorId !== sheet.authorId) {
      await this.assertActiveUser(dto.authorId, 'authorId');
      // A fiche answering an instruction stays an executant's.
      if (sheet.livrable) {
        await this.assertInstructionExecutant(
          sheet.livrable.instructionId,
          sheet,
          dto.authorId,
        );
      }
    }
    await this.database.analysisSheet.update({
      where: { id },
      data: {
        ...rest,
        ...(remise !== undefined ? { remise: new Date(remise) } : {}),
      },
    });
    return this.findOne(id);
  }

  async addItem(sheetId: string, dto: CreateAnalysisItemDto) {
    const sheet = await this.assertEditable(sheetId);
    if (dto.documentId) {
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
    }

    const templates = await this.defaultTemplates(
      await this.siteOfSheet(sheetId),
    );
    const order =
      dto.order ??
      sheet.items.reduce((max, item) => Math.max(max, item.order), 0) + 1;

    await this.database.analysisItem.create({
      data: {
        sheetId,
        documentId: dto.documentId,
        label: dto.label,
        description: dto.description,
        norms: dto.norms,
        observation: dto.observation,
        opinion: dto.opinion,
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
    const item = await this.findItem(itemId);
    await this.assertEditable(item.sheetId);
    await this.database.analysisItem.update({
      where: { id: itemId },
      data: dto,
    });
    return this.refresh(item.sheetId);
  }

  async removeItem(itemId: string) {
    const item = await this.findItem(itemId);
    await this.assertEditable(item.sheetId);
    await this.database.analysisItem.delete({ where: { id: itemId } });
    return this.refresh(item.sheetId);
  }

  /**
   * Full-replace of one element's grid. Criteria are copied per element, so
   * editing this grid never affects another element (spec §4). With custom
   * criteria turned off, every criterion must come from the catalogue.
   */
  async setCriteria(itemId: string, dto: SetCriteriaDto) {
    const item = await this.findItem(itemId);
    await this.assertEditable(item.sheetId);
    const labels = dto.criteria.map((c) => c.label);
    if (new Set(labels).size !== labels.length) {
      throw new BadRequestException(
        'Each criterion may appear only once on an element',
      );
    }
    const siteId = await this.siteOfSheet(item.sheetId);
    const { allowCustomCriteria } = await this.criteria.getSettings(siteId);
    if (!allowCustomCriteria) {
      const templateIds = dto.criteria.map((c) => c.templateId);
      // The catalogue of the fiche's site: common criteria and its own.
      const known = await this.database.analysisCriterionTemplate.count({
        where: {
          id: { in: templateIds.filter((t): t is string => Boolean(t)) },
          isActive: true,
          ...this.criteria.offeredWhere(siteId),
        },
      });
      if (templateIds.some((t) => !t) || known !== new Set(templateIds).size) {
        throw new BadRequestException(
          'Custom criteria are turned off: every criterion must be an active criterion of the catalogue (templateId)',
        );
      }
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
   * The author hands the fiche over for validation — only for a fiche
   * answering an instruction. Only they can: the fiche belongs to the person
   * who was asked to produce it. The livrable moves to SOUMIS and the
   * instruction to EN_ATTENTE_VALIDATION, so the analysis appears in the
   * supervisor's queue like any other deliverable.
   */
  @AuditLog({
    action: 'analysis-sheet.submitted',
    entityType: 'analysis-sheet',
    operation: 'UPDATE',
  })
  async submit(id: string, userId: string) {
    const sheet = await this.assertEditable(id);
    const livrable = this.requireLivrable(sheet);
    if (sheet.authorId !== userId) {
      throw new ForbiddenException(
        'Only the author of this fiche can submit it for validation',
      );
    }
    this.assertEveryItemJudged(sheet, 'submitting');

    await this.database.$transaction([
      this.database.livrable.update({
        where: { id: livrable.id },
        data: { status: LivrableStatus.SOUMIS },
      }),
      this.database.instruction.update({
        where: { id: livrable.instructionId },
        data: { status: InstructionStatus.EN_ATTENTE_VALIDATION },
      }),
      this.database.analysisSheet.update({
        where: { id },
        data: { status: AnalysisSheetStatus.ENREGISTREE },
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
    const sheet = await this.findSheet(id);
    const livrable = this.requireLivrable(sheet);
    if (!SUBMITTED_LIVRABLE_STATUSES.includes(livrable.status)) {
      throw new BadRequestException(
        sheet.decidedAt
          ? `This fiche was already decided on ${sheet.decidedAt.toISOString().slice(0, 10)} (${sheet.overallOpinion}) — a decision is final`
          : 'This fiche has not been submitted for validation yet',
      );
    }
    this.assertEveryItemJudged(sheet, 'concluding');
    if (dto.overallOpinion !== sheet.suggestedOpinion && !dto.motif) {
      throw new BadRequestException(
        `A motif is required when the avis (${dto.overallOpinion}) differs from the one suggested by the grid (${sheet.suggestedOpinion ?? 'none'})`,
      );
    }

    // AF/AFR accept the delivery; AS/AD send it back for a new analysis.
    const accepted =
      dto.overallOpinion === AnalysisOpinion.AF ||
      dto.overallOpinion === AnalysisOpinion.AFR;
    const { instructionId } = livrable;

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
        where: { id: livrable.id },
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
      if (sheet.dossierId) {
        await refreshDossierProgress(this.database, sheet.dossierId);
      }
      return this.findOne(id);
    }
    // Rejected: v1 stays as it is, readable for ever, and a fresh version is
    // opened for the author to redo the analysis — its judgements blank,
    // because they are precisely what was rejected. Not on an effet done
    // with (closed, archived, cancelled): the decision stands alone.
    const effet = await this.effetOf(sheet.courrierId);
    if (FROZEN_EFFET_STATUSES.includes(effet.status)) {
      return { ...(await this.findOne(id)), nextVersion: null };
    }
    const next = await this.createNextVersion(sheet, {
      keepJudgements: false,
      motif: dto.motif ?? `Avis ${dto.overallOpinion}`,
    });
    return { ...(await this.findOne(id)), nextVersion: next };
  }

  /**
   * Records the signed fiche (a PDF): SIGNEE, locked. Later changes go into
   * a new version.
   */
  @AuditLog({
    action: 'analysis-sheet.signed',
    entityType: 'analysis-sheet',
    operation: 'UPDATE',
  })
  async sign(
    id: string,
    dto: SignAnalysisSheetDto,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    const sheet = await this.assertEditable(id);
    if (!file || extname(file.originalname).toLowerCase() !== '.pdf') {
      throw new BadRequestException(
        'file (the signed fiche, as a PDF) is required',
      );
    }
    const { key } = await this.storage.upload(file.buffer, {
      originalName: file.originalname,
      contentType: file.mimetype,
      prefix: `analysis-sheets/${id}`,
    });
    try {
      await this.database.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            originalName: file.originalname,
            name: `Fiche d'analyse ${sheet.reference} v${sheet.version} signée`,
            storageKey: key,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            courrierId: sheet.courrierId,
            uploadedById: userId,
          },
        });
        const { count } = await tx.analysisSheet.updateMany({
          where: { id, status: { in: EDITABLE_STATUSES } },
          data: {
            status: AnalysisSheetStatus.SIGNEE,
            signedAt: new Date(dto.signedAt),
            signatoryName: dto.signatoryName,
            signedDocumentId: document.id,
          },
        });
        if (count === 0) {
          throw new ConflictException(
            'This fiche changed meanwhile — refresh and try again',
          );
        }
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    return this.findOne(id);
  }

  /**
   * Opens a new version of a recorded or signed fiche: a BROUILLON carrying
   * the same elements and criteria, judgements included, to be amended.
   */
  @AuditLog({
    action: 'analysis-sheet.new-version',
    entityType: 'analysis-sheet',
    operation: 'CREATE',
  })
  async newVersion(id: string, dto: NewAnalysisVersionDto) {
    const sheet = await this.findSheet(id);
    if (!VERSIONABLE_STATUSES.includes(sheet.status)) {
      throw new BadRequestException(
        `Fiche ${sheet.reference} is ${sheet.status}: a new version is opened from an ENREGISTREE or SIGNEE fiche`,
      );
    }
    if (sheet.nextVersion) {
      throw new ConflictException(
        `Fiche ${sheet.reference} already has its version ${sheet.nextVersion.version} — open a new version from the latest one`,
      );
    }
    assertEffetOpen(await this.effetOf(sheet.courrierId));
    const next = await this.createNextVersion(sheet, {
      keepJudgements: true,
      motif: dto.motif ?? null,
    });
    return this.findOne(next.id);
  }

  @AuditLog({
    action: 'analysis-sheet.archived',
    entityType: 'analysis-sheet',
    operation: 'UPDATE',
  })
  async archive(id: string, reason?: string) {
    const sheet = await this.findSheet(id);
    if (sheet.status === AnalysisSheetStatus.ARCHIVEE) {
      throw new BadRequestException(
        `Fiche ${sheet.reference} is already archived`,
      );
    }
    await this.database.analysisSheet.update({
      where: { id },
      data: {
        status: AnalysisSheetStatus.ARCHIVEE,
        archivedAt: new Date(),
        archiveReason: reason ?? null,
        archivedFromStatus: sheet.status,
      },
    });
    return this.findOne(id);
  }

  @AuditLog({
    action: 'analysis-sheet.unarchived',
    entityType: 'analysis-sheet',
    operation: 'UPDATE',
  })
  async unarchive(id: string) {
    const sheet = await this.findSheet(id);
    if (sheet.status !== AnalysisSheetStatus.ARCHIVEE) {
      throw new BadRequestException(`Fiche ${sheet.reference} is not archived`);
    }
    await this.database.analysisSheet.update({
      where: { id },
      data: {
        status: sheet.archivedFromStatus ?? AnalysisSheetStatus.ENREGISTREE,
        archivedAt: null,
        archiveReason: null,
        archivedFromStatus: null,
      },
    });
    return this.findOne(id);
  }

  // A draft only. A fiche carried by a livrable goes with its livrable.
  @AuditLog({
    action: 'analysis-sheet.deleted',
    entityType: 'analysis-sheet',
    operation: 'DELETE',
  })
  async remove(id: string) {
    const sheet = await this.findSheet(id);
    if (sheet.status !== AnalysisSheetStatus.BROUILLON) {
      throw new BadRequestException(
        `Fiche ${sheet.reference} is ${sheet.status}: only a draft (BROUILLON) can be deleted`,
      );
    }
    if (
      sheet.livrable &&
      !EDITABLE_LIVRABLE_STATUSES.includes(sheet.livrable.status)
    ) {
      throw new BadRequestException(
        `Fiche ${sheet.reference} has been submitted for validation and can no longer be deleted`,
      );
    }
    if (sheet.livrableId) {
      // Cascades to the sheet, its elements and their criteria.
      await this.database.livrable.delete({ where: { id: sheet.livrableId } });
    } else {
      await this.database.analysisSheet.delete({ where: { id } });
    }
  }

  /** The fiche as a PDF. */
  async pdf(id: string) {
    const sheet = await this.findSheet(id);
    const pdf = await renderAnalysisSheetPdf({
      reference: sheet.reference,
      version: sheet.version,
      status: sheet.status,
      title: sheet.title,
      courrier: `${sheet.courrier.number} — ${sheet.courrier.subject}`,
      header: [
        ['Projet', sheet.project?.name ?? null],
        [
          'Réf. projet',
          sheet.projectReference ?? sheet.project?.reference ?? null,
        ],
        [
          "Maître d'ouvrage",
          sheet.owner ?? sheet.project?.maitreOuvrage?.name ?? null,
        ],
        ['Mode', sheet.mode],
        ['Allotissement', sheet.allotment],
        [
          'Dossier',
          sheet.dossier
            ? `${sheet.dossier.number} — ${sheet.dossier.title}`
            : null,
        ],
        [
          'Contrat',
          sheet.contract
            ? `${sheet.contract.reference ?? sheet.contract.number} — ${sheet.contract.title}`
            : null,
        ],
        ['Réf. BL', sheet.refBL],
        ['Lieu d’usage', sheet.lieuUsage],
        [
          'Remise',
          sheet.remise ? sheet.remise.toLocaleDateString('fr-FR') : null,
        ],
        ['Norme', sheet.norme],
        ['Docs références', sheet.docsReferences.join(', ') || null],
      ],
      items: sheet.items.map((item) => ({
        order: item.order,
        label: item.label,
        document: item.document?.originalName ?? null,
        norms: item.norms,
        opinion: item.opinion,
        suggestedOpinion: item.suggestedOpinion,
        observation: item.observation,
        criteria: item.criteria.map((criterion) => ({
          label: criterion.label,
          opinion: criterion.opinion,
          observation: criterion.observation,
        })),
      })),
      suggestedOpinion: sheet.suggestedOpinion,
      overallOpinion: sheet.overallOpinion,
      comments: sheet.comments,
      author: { name: sheet.author.name, function: sheet.authorFunction },
      validator: {
        name: sheet.validator?.name ?? null,
        function: sheet.validatorFunction,
      },
      signedAt: sheet.signedAt,
      signatoryName: sheet.signatoryName,
      // The letterhead of the fiche's site (PA·3).
      identity: await this.identity.forPdf(await this.siteOfSheet(sheet.id)),
    });
    return {
      pdf,
      filename: `${sheet.reference}-v${sheet.version}.pdf`,
    };
  }

  /**
   * Opens the version that replaces `previous`: for a fiche answering an
   * instruction, a new livrable version of it too. Same structure —
   * elements and criteria — with the judgements kept or left blank.
   */
  private async effetOf(courrierId: string) {
    return this.database.courrier.findUniqueOrThrow({
      where: { id: courrierId },
      select: { number: true, status: true },
    });
  }

  private async createNextVersion(
    previous: Sheet,
    options: { keepJudgements: boolean; motif: string | null },
  ) {
    const keep = options.keepJudgements;
    return this.database.$transaction(async (tx) => {
      const livrable = previous.livrable
        ? await tx.livrable.create({
            data: {
              instructionId: previous.livrable.instructionId,
              title: previous.livrable.title,
              version: previous.livrable.version + 1,
              position: previous.livrable.position,
              parentVersionId: previous.livrable.id,
              createdById: previous.authorId,
            },
          })
        : null;

      return createWithUniqueReference('FA', (reference) =>
        tx.analysisSheet.create({
          data: {
            reference,
            livrableId: livrable?.id,
            courrierId: previous.courrierId,
            dossierId: previous.dossierId,
            contractId: previous.contractId,
            projectId: previous.projectId,
            authorId: previous.authorId,
            parentSheetId: previous.id,
            version: nextVersionNumber(previous.version),
            versionMotif: options.motif,
            refBL: previous.refBL,
            lieuUsage: previous.lieuUsage,
            remise: previous.remise,
            norme: previous.norme,
            docsReferences: previous.docsReferences,
            title: previous.title,
            mode: previous.mode,
            projectReference: previous.projectReference,
            owner: previous.owner,
            allotment: previous.allotment,
            authorFunction: previous.authorFunction,
            validatorId: previous.validatorId,
            validatorFunction: previous.validatorFunction,
            comments: previous.comments,
            suggestedOpinion: keep ? previous.suggestedOpinion : null,
            items: {
              create: previous.items.map((item) => ({
                documentId: item.documentId,
                label: item.label,
                description: item.description,
                norms: item.norms,
                order: item.order,
                // A rejected version's observation and opinion are left
                // empty: they justified the judgement that was rejected.
                ...(keep
                  ? {
                      observation: item.observation,
                      opinion: item.opinion,
                      suggestedOpinion: item.suggestedOpinion,
                    }
                  : {}),
                criteria: {
                  create: item.criteria.map((criterion) => ({
                    templateId: criterion.templateId,
                    label: criterion.label,
                    order: criterion.order,
                    ...(keep
                      ? {
                          opinion: criterion.opinion,
                          observation: criterion.observation,
                        }
                      : {}),
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

  // Every version of the fiche, oldest first, along parentSheetId.
  private async versionsOf(sheet: Sheet) {
    const select = {
      id: true,
      version: true,
      status: true,
      createdAt: true,
      signedAt: true,
      versionMotif: true,
      parentSheetId: true,
      nextVersion: { select: { id: true } },
    } satisfies Prisma.AnalysisSheetSelect;
    type Version = Prisma.AnalysisSheetGetPayload<{ select: typeof select }>;
    const chain: Version[] = [];
    let current: Version | null = await this.database.analysisSheet.findUnique({
      where: { id: sheet.id },
      select,
    });
    const self = current;
    while (current?.parentSheetId) {
      current = await this.database.analysisSheet.findUnique({
        where: { id: current.parentSheetId },
        select,
      });
      if (current) chain.unshift(current);
    }
    if (self) chain.push(self);
    current = self;
    while (current?.nextVersion) {
      current = await this.database.analysisSheet.findUnique({
        where: { id: current.nextVersion.id },
        select,
      });
      if (current) chain.push(current);
    }
    return chain.map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      createdAt: version.createdAt,
      signedAt: version.signedAt,
      motif: version.versionMotif,
    }));
  }

  /**
   * A delivery may carry several fiches over time, but only one live at a
   * time: the others are replaced versions, rejected or archived ones.
   */
  private async assertNoLiveSheet(courrierId: string, courrierNumber: string) {
    const live = await this.database.analysisSheet.findFirst({
      where: { courrierId, ...LIVE_ANALYSIS_SHEET_WHERE },
      select: { reference: true },
    });
    if (live) {
      throw new BadRequestException(
        `Courrier ${courrierNumber} already has the analysis sheet ${live.reference} — one live fiche per delivery (open a new version of it instead)`,
      );
    }
  }

  // The instruction works on the fiche's dossier, or — the fiche having
  // none — on its contract.
  private async assertInstructionExecutant(
    instructionId: string,
    target: { dossierId: string | null; contractId: string | null },
    authorId: string,
  ) {
    const instruction = await this.database.instruction.findUnique({
      where: { id: instructionId },
      select: {
        id: true,
        dossierId: true,
        contractId: true,
        assignees: { select: { userId: true, role: true } },
      },
    });
    if (!instruction) {
      throw new NotFoundException(`Instruction ${instructionId} not found`);
    }
    const sameTarget = target.dossierId
      ? instruction.dossierId === target.dossierId
      : instruction.contractId === target.contractId;
    if (!sameTarget) {
      throw new BadRequestException(
        target.dossierId
          ? 'The instruction and the courrier belong to different dossiers'
          : 'The instruction and the courrier belong to different contracts',
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
  }

  private async assertContractOpen(contractId: string) {
    const contract = await this.database.contract.findUnique({
      where: { id: contractId },
      select: { number: true, status: true },
    });
    if (!contract) {
      throw new NotFoundException(`Contract ${contractId} not found`);
    }
    if (contract.status === ContractStatus.ARCHIVED) {
      throw new BadRequestException(
        `Contract ${contract.number} is archived — no fiche d'analyse can be opened on it`,
      );
    }
  }

  private async assertActiveUser(userId: string, field = 'validatorId') {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (user?.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(`${field} ${userId} is not an active user`);
    }
  }

  private requireLivrable(sheet: Sheet) {
    if (!sheet.livrable) {
      throw new BadRequestException(
        `Fiche ${sheet.reference} answers no instruction: it is signed (POST /analysis-sheets/:id/sign), not submitted for validation`,
      );
    }
    return sheet.livrable;
  }

  private assertEveryItemJudged(sheet: Sheet, step: string) {
    if (sheet.items.length === 0) {
      throw new BadRequestException('This fiche has no element');
    }
    const undecided = sheet.items.filter((item) => item.opinion === null);
    if (undecided.length > 0) {
      throw new BadRequestException(
        `${undecided.length} element(s) have no avis yet — pronounce on each element before ${step}`,
      );
    }
  }

  /** Blocks every change once the fiche is signed, archived or submitted. */
  private async assertEditable(id: string) {
    const sheet = await this.findSheet(id);
    if (!EDITABLE_STATUSES.includes(sheet.status)) {
      throw new BadRequestException(
        `Fiche ${sheet.reference} is ${sheet.status} and can no longer be modified — open a new version instead`,
      );
    }
    if (
      sheet.livrable &&
      !EDITABLE_LIVRABLE_STATUSES.includes(sheet.livrable.status)
    ) {
      throw new BadRequestException(
        sheet.decidedAt
          ? `Fiche ${sheet.reference} was decided (${sheet.overallOpinion}) and can no longer be modified`
          : `Fiche ${sheet.reference} has been submitted for validation and can no longer be modified`,
      );
    }
    return sheet;
  }

  private async findSheet(id: string): Promise<Sheet> {
    const sheet = await this.database.analysisSheet.findUnique({
      where: { id },
      include: sheetInclude,
    });
    if (!sheet) {
      throw new NotFoundException(`Analysis sheet ${id} not found`);
    }
    return sheet;
  }

  private async findItem(itemId: string) {
    const item = await this.database.analysisItem.findUnique({
      where: { id: itemId },
      select: { sheetId: true },
    });
    if (!item) {
      throw new NotFoundException(`Analysis item ${itemId} not found`);
    }
    return item;
  }

  /**
   * The grid put on a new element: the active criteria applied by default,
   * common and of the fiche's site.
   */
  private defaultTemplates(siteId: string | null) {
    return this.database.analysisCriterionTemplate.findMany({
      where: {
        isActive: true,
        appliedByDefault: true,
        ...this.criteria.offeredWhere(siteId),
      },
      orderBy: [{ siteId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }],
    });
  }

  // A fiche's site: its effet's (its dossier's, else its registrant's).
  private async siteOfSheet(sheetId: string): Promise<string | null> {
    const sheet = await this.database.analysisSheet.findUnique({
      where: { id: sheetId },
      select: {
        dossier: { select: { siteId: true } },
        courrier: { select: { createdBy: { select: { siteId: true } } } },
      },
    });
    return sheet?.dossier?.siteId ?? sheet?.courrier?.createdBy?.siteId ?? null;
  }

  private async siteOfEffet(effet: {
    dossierId: string | null;
    createdById: string | null;
  }): Promise<string | null> {
    if (effet.dossierId) {
      const dossier = await this.database.dossier.findUnique({
        where: { id: effet.dossierId },
        select: { siteId: true },
      });
      return dossier?.siteId ?? null;
    }
    if (!effet.createdById) return null;
    const registrant = await this.database.user.findUnique({
      where: { id: effet.createdById },
      select: { siteId: true },
    });
    return registrant?.siteId ?? null;
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

// No new fiche, nor new version, on an effet closed, archived or cancelled.
function assertEffetOpen(effet: { number: string; status: CourrierStatus }) {
  if (FROZEN_EFFET_STATUSES.includes(effet.status)) {
    throw new BadRequestException(
      `L'effet ${effet.number} est ${FROZEN_LABEL[effet.status]} : aucune nouvelle fiche d'analyse ne peut y être ouverte`,
    );
  }
}
