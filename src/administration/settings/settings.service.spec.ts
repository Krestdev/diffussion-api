import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { AccessService } from '../../auth/access/access.service';
import { Permission } from '../../auth/permissions';
import {
  accessMock,
  type AccessMock,
} from '../../activity/access-mock.testing-spec';
import { DatabaseService } from '../../database/database.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let companyValues: Record<string, unknown> | null;
  let database: {
    appSettings: Record<string, jest.Mock>;
    companySettings: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let access: AccessMock;

  beforeEach(async () => {
    companyValues = null;
    database = {
      appSettings: {
        findUnique: jest.fn().mockResolvedValue({
          maxActiveInstructionsPerAgent: 5,
          values: { defaultTreatmentDays: 12 },
          updatedAt: new Date(),
        }),
        upsert: jest.fn(),
      },
      companySettings: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            companyValues
              ? { values: companyValues, updatedAt: new Date() }
              : null,
          ),
        ),
        upsert: jest.fn(
          ({ create }: { create: { values: Record<string, unknown> } }) => {
            companyValues = create.values;
            return Promise.resolve();
          },
        ),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 's-1' }) },
    };
    // Administers the settings of company s-1.
    access = accessMock({
      companyId: 's-1',
      permissions: [Permission.SETTINGS_UPDATE],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  it('a company inherits the defaults and the common values', async () => {
    const settings = await service.get('s-1');

    expect(settings).toMatchObject({
      companyId: 's-1',
      defaultTreatmentDays: 12, // common
      maxActiveInstructionsPerAgent: 5, // common column
      outgoingReplyDays: 15, // default
      autoArchiveAfterMonths: null, // default: never
    });
    expect(settings.inherited).toContain('defaultTreatmentDays');
  });

  it("a company's own value wins, and can be given up", async () => {
    await service.update(
      { defaultTreatmentDays: 7, autoArchiveAfterMonths: null },
      'u-admin-s1',
    );
    let settings = await service.get('s-1');
    expect(settings.defaultTreatmentDays).toBe(7);
    expect(settings.inherited).not.toContain('defaultTreatmentDays');

    await service.update({ reset: ['defaultTreatmentDays'] }, 'u-admin-s1');
    settings = await service.get('s-1');
    expect(settings.defaultTreatmentDays).toBe(12);
  });

  it("refuses another company's settings, and the common ones", async () => {
    await expect(
      service.update(
        { companyId: 's-2', defaultTreatmentDays: 3 },
        'u-admin-s1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Without the permission, not even their own company's.
    access.state.permissions = [];
    await expect(
      service.update({ defaultTreatmentDays: 3 }, 'u-admin-s1'),
    ).rejects.toThrow('companyId is required');
  });

  it("reads one's own company's settings by default", async () => {
    const settings = await service.getFor({}, 'u-agent');

    expect(settings.companyId).toBe('s-1');
  });
});
