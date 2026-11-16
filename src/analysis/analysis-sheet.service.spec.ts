import { WorkflowService } from '../workflow/workflow.service';
import { ClsServiceManager } from 'nestjs-cls';
import { Permission } from '../auth/permissions';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  AnalysisSheetStatus,
  LivrableStatus,
} from '../generated/prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../activity/activity.service';
import { AccessService } from '../auth/access/access.service';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import {
  AnalysisSheetService,
  sheetsAtCompanies,
} from './analysis-sheet.service';
import { CriterionTemplateService } from './criterion-template.service';
import { DocumentIdentityService } from '../administration/settings/document-identity.service';

// The signed-in person, as CoreAuthGuard puts them in the request context: the
// workflow engine checks its rules' permissions against theirs.
const signedIn: Record<string, unknown> = {};
beforeEach(() => {
  for (const key of Object.keys(signedIn)) delete signedIn[key];
  Object.assign(signedIn, {
    userId: 'u-signed-in',
    companyId: 'company-1',
    permissions: Object.values(Permission),
  });
  jest.spyOn(ClsServiceManager, 'getClsService').mockReturnValue({
    isActive: () => true,
    get: (key: string) => signedIn[key],
  } as never);
});
afterEach(() => jest.restoreAllMocks());

describe('AnalysisSheetService', () => {
  let service: AnalysisSheetService;
  let database: {
    analysisSheet: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    livrable: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    statusHistory: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let rbac: { companyFilter: jest.Mock };

  const companyOnly = sheetsAtCompanies({ in: ['s-1'] });

  beforeEach(async () => {
    database = {
      analysisSheet: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      courrier: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      livrable: {
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      instruction: {
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      validation: { create: jest.fn() },
      statusHistory: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(database)
          : Promise.all(arg as unknown[]),
      ),
    };
    // The caller reads analyses at company s-1 only.
    rbac = { companyFilter: jest.fn().mockResolvedValue(companyOnly) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisSheetService,
        { provide: DatabaseService, useValue: database },
        WorkflowService,
        { provide: AccessService, useValue: rbac },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(null) },
        },
        { provide: StorageService, useValue: {} },
        { provide: CriterionTemplateService, useValue: {} },
        { provide: DocumentIdentityService, useValue: {} },
      ],
    }).compile();

    service = module.get(AnalysisSheetService);
  });

  const where = () =>
    (database.analysisSheet.findMany.mock.calls[0][0] as { where: object })
      .where;

  describe('list: only the sheets of the companies the caller reads', () => {
    it('keeps the company filter without a search', async () => {
      await service.findAll({}, 'u-1');

      expect(where()).toMatchObject({ AND: [companyOnly] });
    });

    it('keeps it alongside a search', async () => {
      await service.findAll({ search: 'plan' }, 'u-1');

      expect(where()).toMatchObject({
        AND: [companyOnly],
        OR: expect.arrayContaining([
          { reference: { contains: 'plan', mode: 'insensitive' } },
        ]),
      });
    });

    it('applies it to the tab counts too', async () => {
      await service.findAll({ status: 'SIGNEE' }, 'u-1');

      const grouped = database.analysisSheet.groupBy.mock.calls[0][0] as {
        where: object;
      };
      expect(grouped.where).toMatchObject({ AND: [companyOnly] });
    });
  });

  // A fiche answering instruction i-1 through livrable l-1 (version 1).
  const sheet = (fields: Record<string, unknown> = {}) => ({
    id: 's-1',
    reference: 'FA-1',
    version: '1.0',
    status: AnalysisSheetStatus.ENREGISTREE,
    courrierId: 'c-1',
    dossierId: 'd-1',
    contractId: null,
    projectId: null,
    authorId: 'u-author',
    parentSheetId: null,
    nextVersion: null,
    suggestedOpinion: 'AF',
    docsReferences: [],
    items: [],
    livrable: {
      id: 'l-1',
      title: "Fiche d'analyse — M-1",
      status: LivrableStatus.EN_PREPARATION,
      version: 1,
      position: 0,
      instructionId: 'i-1',
    },
    ...fields,
  });

  describe('new version (owner fix 2026-11-15)', () => {
    it("takes the previous livrable's isLatest away, and records both creations", async () => {
      database.analysisSheet.findUnique = jest.fn().mockResolvedValue(sheet());
      database.analysisSheet.create = jest.fn().mockResolvedValue({
        id: 's-2',
        status: AnalysisSheetStatus.BROUILLON,
      });
      database.courrier.findUniqueOrThrow.mockResolvedValue({
        number: 'M-1',
        status: 'TRANSMIS',
      });
      database.livrable.create.mockResolvedValue({
        id: 'l-2',
        status: LivrableStatus.EN_PREPARATION,
      });

      await service.newVersion('s-1', { motif: 'Erreur de saisie' });

      expect(database.livrable.updateMany).toHaveBeenCalledWith({
        where: { id: 'l-1', isLatest: true },
        data: { isLatest: false },
      });
      expect(database.livrable.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 2, parentVersionId: 'l-1' }),
      });
      const recorded = database.statusHistory.create.mock.calls.map(
        ([args]: [{ data: Record<string, unknown> }]) => args.data,
      );
      expect(recorded).toEqual([
        expect.objectContaining({
          entity: 'Livrable',
          entityId: 'l-2',
          event: 'NEW_VERSION',
        }),
        expect.objectContaining({
          entity: 'AnalysisSheet',
          entityId: 's-2',
          event: 'NEW_VERSION',
          toStatus: AnalysisSheetStatus.BROUILLON,
          reason: 'Erreur de saisie',
        }),
      ]);
    });
  });

  describe('archive and restore through the workflow', () => {
    it('archives a live fiche, keeping the status it leaves', async () => {
      database.analysisSheet.findUnique = jest.fn().mockResolvedValue(sheet());
      database.analysisSheet.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });

      await service.archive('s-1', 'Doublon');

      expect(database.analysisSheet.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', status: AnalysisSheetStatus.ENREGISTREE },
        data: expect.objectContaining({
          status: AnalysisSheetStatus.ARCHIVEE,
          archivedFromStatus: AnalysisSheetStatus.ENREGISTREE,
          archiveReason: 'Doublon',
        }),
      });
    });

    it('refuses an archived fiche (409 INVALID_TRANSITION)', async () => {
      database.analysisSheet.findUnique = jest
        .fn()
        .mockResolvedValue(sheet({ status: AnalysisSheetStatus.ARCHIVEE }));
      database.analysisSheet.updateMany = jest.fn();

      await expect(service.archive('s-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database.analysisSheet.updateMany).not.toHaveBeenCalled();
    });

    it('restores it to the status it was archived from', async () => {
      database.analysisSheet.findUnique = jest.fn().mockResolvedValue(
        sheet({
          status: AnalysisSheetStatus.ARCHIVEE,
          archivedFromStatus: AnalysisSheetStatus.SIGNEE,
        }),
      );
      database.analysisSheet.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });

      await service.unarchive('s-1');

      expect(database.analysisSheet.updateMany).toHaveBeenCalledWith({
        where: { id: 's-1', status: AnalysisSheetStatus.ARCHIVEE },
        data: expect.objectContaining({ status: AnalysisSheetStatus.SIGNEE }),
      });
    });
  });

  describe('no new fiche on an effet done with', () => {
    it.each([
      ['CLOTURE', 'clôturé'],
      ['ARCHIVE', 'archivé'],
      ['ANNULE', 'annulé'],
    ])('refuses one on an effet %s', async (status, label) => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        number: 'M-1',
        status,
        dossierId: 'd-1',
        contractId: null,
        documents: [],
      });

      const attempt = service.create({ courrierId: 'c-1', items: [] }, 'u-1');

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(label);
      expect(database.analysisSheet.findMany).not.toHaveBeenCalled();
    });
  });
});
