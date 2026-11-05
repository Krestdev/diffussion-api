import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { SiteService } from './site.service';

const SITE = { id: 's-1', name: 'Cristal', responsibleId: 'u-old' };

describe('SiteService', () => {
  let service: SiteService;
  let database: {
    site: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    delegation: Record<string, jest.Mock>;
    analysisCriterionTemplate: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let rbac: { administeredSites: jest.Mock };

  const responsible = (overrides: Record<string, unknown> = {}) => ({
    name: 'Awa',
    status: 'ACTIVE',
    siteId: 's-9',
    managedSites: [],
    ...overrides,
  });

  beforeEach(async () => {
    database = {
      site: {
        create: jest.fn().mockResolvedValue({ id: 's-new' }),
        findUnique: jest.fn().mockResolvedValue(SITE),
        update: jest.fn().mockResolvedValue(SITE),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(responsible()),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ siteId: 's-9' }),
        update: jest.fn(),
      },
      userRole: { updateMany: jest.fn(), deleteMany: jest.fn() },
      delegation: { deleteMany: jest.fn() },
      // The common model of analysis criteria, copied onto a new site.
      analysisCriterionTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            label: 'Forme',
            description: null,
            order: 1,
            isActive: true,
            appliedByDefault: true,
          },
        ]),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    database.$transaction.mockImplementation(
      (change: (tx: typeof database) => unknown) => change(database),
    );
    rbac = { administeredSites: jest.fn().mockResolvedValue('ALL') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiteService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
        {
          provide: ActivityService,
          useValue: {
            record: jest.fn().mockResolvedValue('log-1'),
            tryRecord: jest.fn().mockResolvedValue('log-1'),
          },
        },
      ],
    }).compile();

    service = module.get<SiteService>(SiteService);
  });

  describe('create with a responsible', () => {
    it('moves the responsible into the new site, with their roles', async () => {
      await service.create({ name: 'Bonaberi', responsibleId: 'u-1' });

      expect(database.userRole.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        data: { siteId: 's-new' },
      });
      expect(database.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { siteId: 's-new' },
      });
    });

    it('refuses a platform administrator', async () => {
      database.user.findUnique.mockResolvedValue(responsible({ siteId: null }));

      await expect(
        service.create({ name: 'Bonaberi', responsibleId: 'u-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.site.create).not.toHaveBeenCalled();
    });

    it('refuses the responsible of another site', async () => {
      database.user.findUnique.mockResolvedValue(
        responsible({ managedSites: [{ id: 's-9', name: 'Akwa' }] }),
      );

      await expect(
        service.create({ name: 'Bonaberi', responsibleId: 'u-1' }),
      ).rejects.toThrow('Awa is already the responsible of site "Akwa"');
    });
  });

  describe('update', () => {
    it('lets the responsible edit their own site', async () => {
      rbac.administeredSites.mockResolvedValue(['s-1']);

      await service.update('s-1', { city: 'Douala' }, 'u-old');

      expect(database.site.update).toHaveBeenCalled();
    });

    it("refuses another site's responsible", async () => {
      rbac.administeredSites.mockResolvedValue(['s-2']);

      await expect(
        service.update('s-1', { city: 'Douala' }, 'u-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("doesn't let the responsible hand the site over", async () => {
      rbac.administeredSites.mockResolvedValue(['s-1']);

      await expect(
        service.update('s-1', { responsibleId: 'u-1' }, 'u-old'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a platform administrator change the responsible', async () => {
      await service.update('s-1', { responsibleId: 'u-1' }, 'super-admin');

      expect(database.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { siteId: 's-1' },
      });
      expect(database.site.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { responsibleId: 'u-1' } }),
      );
    });
  });

  it('gives a new site its own copy of the analysis criteria', async () => {
    await service.create({ name: 'Garoua' });

    expect(database.analysisCriterionTemplate.createMany).toHaveBeenCalledWith({
      data: [
        {
          label: 'Forme',
          description: null,
          order: 1,
          isActive: true,
          appliedByDefault: true,
          siteId: 's-new',
        },
      ],
    });
  });
});
