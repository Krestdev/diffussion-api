import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { withScopeChecks } from '../../auth/rbac/rbac.testing-spec';
import { DatabaseService } from '../../database/database.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let siteValues: Record<string, unknown> | null;
  let database: {
    appSettings: Record<string, jest.Mock>;
    siteSettings: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let rbac: { managedSites: jest.Mock };

  beforeEach(async () => {
    siteValues = null;
    database = {
      appSettings: {
        findUnique: jest.fn().mockResolvedValue({
          maxActiveInstructionsPerAgent: 5,
          values: { defaultTreatmentDays: 12 },
          updatedAt: new Date(),
        }),
        upsert: jest.fn(),
      },
      siteSettings: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            siteValues ? { values: siteValues, updatedAt: new Date() } : null,
          ),
        ),
        upsert: jest.fn(
          ({ create }: { create: { values: Record<string, unknown> } }) => {
            siteValues = create.values;
            return Promise.resolve();
          },
        ),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ siteId: 's-1' }) },
    };
    // Administers the settings of site s-1.
    rbac = { managedSites: jest.fn().mockResolvedValue(['s-1']) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: withScopeChecks(rbac) },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  it('a site inherits the defaults and the common values', async () => {
    const settings = await service.get('s-1');

    expect(settings).toMatchObject({
      siteId: 's-1',
      defaultTreatmentDays: 12, // common
      maxActiveInstructionsPerAgent: 5, // common column
      outgoingReplyDays: 15, // default
      autoArchiveAfterMonths: null, // default: never
    });
    expect(settings.inherited).toContain('defaultTreatmentDays');
  });

  it("a site's own value wins, and can be given up", async () => {
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

  it("refuses another site's settings, and the common ones", async () => {
    await expect(
      service.update({ siteId: 's-2', defaultTreatmentDays: 3 }, 'u-admin-s1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    rbac.managedSites.mockResolvedValue(['s-1', 's-2']);
    await expect(
      service.update({ defaultTreatmentDays: 3 }, 'u-admin-s1'),
    ).rejects.toThrow('siteId is required');
  });

  it("reads one's own site's settings by default", async () => {
    const settings = await service.getFor({}, 'u-agent');

    expect(settings.siteId).toBe('s-1');
  });
});
