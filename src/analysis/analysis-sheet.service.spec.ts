import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../activity/activity.service';
import { RbacService } from '../auth/rbac/rbac.service';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { AnalysisSheetService, sheetsAtSites } from './analysis-sheet.service';
import { CriterionTemplateService } from './criterion-template.service';

describe('AnalysisSheetService', () => {
  let service: AnalysisSheetService;
  let database: {
    analysisSheet: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
  };
  let rbac: { siteFilter: jest.Mock };

  const siteOnly = sheetsAtSites({ in: ['s-1'] });

  beforeEach(async () => {
    database = {
      analysisSheet: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      courrier: { findUnique: jest.fn() },
    };
    // The caller reads analyses at site s-1 only.
    rbac = { siteFilter: jest.fn().mockResolvedValue(siteOnly) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisSheetService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
        { provide: ActivityService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: CriterionTemplateService, useValue: {} },
      ],
    }).compile();

    service = module.get(AnalysisSheetService);
  });

  const where = () =>
    (database.analysisSheet.findMany.mock.calls[0][0] as { where: object })
      .where;

  describe('list: only the sheets of the sites the caller reads', () => {
    it('keeps the site filter without a search', async () => {
      await service.findAll({}, 'u-1');

      expect(where()).toMatchObject({ AND: [siteOnly] });
    });

    it('keeps it alongside a search', async () => {
      await service.findAll({ search: 'plan' }, 'u-1');

      expect(where()).toMatchObject({
        AND: [siteOnly],
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
      expect(grouped.where).toMatchObject({ AND: [siteOnly] });
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
