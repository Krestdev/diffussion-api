import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../activity/activity.service';
import { AccessService } from '../auth/access/access.service';
import { Permission } from '../auth/permissions';
import { DatabaseService } from '../database/database.service';
import { CriterionTemplateService } from './criterion-template.service';
import {
  accessMock,
  type AccessMock,
} from '../activity/access-mock.testing-spec';

describe('CriterionTemplateService', () => {
  let service: CriterionTemplateService;
  let database: {
    analysisCriterionTemplate: Record<string, jest.Mock>;
    analysisSettings: Record<string, jest.Mock>;
    analysisCompanySettings: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let access: AccessMock;

  const createdData = () =>
    (
      database.analysisCriterionTemplate.create.mock.calls[0][0] as {
        data: { companyId: string | null };
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
      analysisCompanySettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 's-1' }) },
    };
    // Manages the criteria of company s-1 only.
    access = accessMock({
      companyId: 's-1',
      permissions: [Permission.SETTINGS_UPDATE, Permission.ANALYSIS_READ],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CriterionTemplateService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(CriterionTemplateService);
  });

  describe('a company manager', () => {
    it("creates their company's criteria without naming it", async () => {
      await service.create({ label: 'Lisibilité' }, 'u-s1');

      expect(createdData().companyId).toBe('s-1');
    });

    it("cannot create another company's, nor a common one", async () => {
      await expect(
        service.create({ label: 'X', companyId: 's-2' }, 'u-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      access.state.permissions = [];
      await expect(
        service.create({ label: 'X', companyId: undefined }, 'u-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cannot change a common criterion', async () => {
      database.analysisCriterionTemplate.findUnique.mockResolvedValue({
        id: 't-1',
        label: 'Forme',
        companyId: null,
      });

      await expect(
        service.update('t-1', { label: 'Forme bis' }, 'u-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("sets their company's settings, not the common ones", async () => {
      await service.updateSettings(
        { companyId: 's-1', allowCustomCriteria: false },
        'u-s1',
      );
      expect(database.analysisCompanySettings.upsert).toHaveBeenCalled();

      await expect(
        service.updateSettings({ allowCustomCriteria: false }, 'u-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('a super-administrator creates common criteria', async () => {
    access.state.platformAdmin = true;

    await service.create({ label: 'Forme' }, 'super');

    expect(createdData().companyId).toBeNull();
  });

  it("offers a company's fiches its own criteria only", async () => {
    await service.findAll({ companyId: 's-1' }, 'u-s1');

    expect(database.analysisCriterionTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 's-1' } }),
    );
  });

  it('a company without its own settings inherits the common ones', async () => {
    const settings = await service.getSettings('s-1');

    expect(settings).toMatchObject({
      allowCustomCriteria: true,
      companyId: 's-1',
      inherited: true,
    });
  });
});
