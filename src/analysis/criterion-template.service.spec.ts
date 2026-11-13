import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../activity/activity.service';
import { RbacService } from '../auth/rbac/rbac.service';
import { DatabaseService } from '../database/database.service';
import { CriterionTemplateService } from './criterion-template.service';
import { withScopeChecks } from '../auth/rbac/rbac.testing-spec';

describe('CriterionTemplateService', () => {
  let service: CriterionTemplateService;
  let database: {
    analysisCriterionTemplate: Record<string, jest.Mock>;
    analysisSettings: Record<string, jest.Mock>;
    analysisSiteSettings: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let rbac: {
    managedSites: jest.Mock;
    hasGlobalPermission: jest.Mock;
    worksAtSite: jest.Mock;
  };

  const createdData = () =>
    (
      database.analysisCriterionTemplate.create.mock.calls[0][0] as {
        data: { siteId: string | null };
      }
    ).data;

  beforeEach(async () => {
    database = {
      analysisCriterionTemplate: {
        create: jest.fn().mockResolvedValue({ id: 't-new' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
      },
      analysisSettings: {
        findUnique: jest.fn().mockResolvedValue({
          allowCustomCriteria: true,
          updatedAt: new Date(),
        }),
        upsert: jest.fn(),
      },
      analysisSiteSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ siteId: 's-1' }) },
    };
    // Manages the criteria of site s-1 only.
    rbac = {
      managedSites: jest.fn().mockResolvedValue(['s-1']),
      hasGlobalPermission: jest.fn().mockResolvedValue(false),
      worksAtSite: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CriterionTemplateService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: withScopeChecks(rbac) },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(CriterionTemplateService);
  });

  describe('a site manager', () => {
    it("creates their site's criteria without naming it", async () => {
      await service.create({ label: 'Lisibilité' }, 'u-s1');

      expect(createdData().siteId).toBe('s-1');
    });

    it("cannot create another site's, nor a common one", async () => {
      await expect(
        service.create({ label: 'X', siteId: 's-2' }, 'u-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      rbac.managedSites.mockResolvedValue(['s-1', 's-2']);
      await expect(
        service.create({ label: 'X', siteId: undefined }, 'u-s1'),
      ).rejects.toThrow('siteId is required');
    });

    it('cannot change a common criterion', async () => {
      database.analysisCriterionTemplate.findUnique.mockResolvedValue({
        id: 't-1',
        label: 'Forme',
        siteId: null,
      });

      await expect(
        service.update('t-1', { label: 'Forme bis' }, 'u-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("sets their site's settings, not the common ones", async () => {
      await service.updateSettings(
        { siteId: 's-1', allowCustomCriteria: false },
        'u-s1',
      );
      expect(database.analysisSiteSettings.upsert).toHaveBeenCalled();

      await expect(
        service.updateSettings({ allowCustomCriteria: false }, 'u-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('a platform administrator creates common criteria', async () => {
    rbac.managedSites.mockResolvedValue('ALL');

    await service.create({ label: 'Forme' }, 'super');

    expect(createdData().siteId).toBeNull();
  });

  it("offers a site's fiches its own criteria only", async () => {
    await service.findAll({ siteId: 's-1' }, 'u-s1');

    expect(database.analysisCriterionTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: 's-1' } }),
    );
  });

  it('a site without its own settings inherits the common ones', async () => {
    const settings = await service.getSettings('s-1');

    expect(settings).toMatchObject({
      allowCustomCriteria: true,
      siteId: 's-1',
      inherited: true,
    });
  });
});
