import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import { CanalService } from './canal.service';
import { accessMock, AccessMock } from '../access-mock.testing-spec';

describe('CanalService', () => {
  let service: CanalService;
  let database: {
    canal: Record<string, jest.Mock>;
    company: Record<string, jest.Mock>;
  };
  let access: AccessMock;

  beforeEach(async () => {
    database = {
      canal: {
        create: jest.fn().mockResolvedValue({ id: 'k-new' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ id: 's-1' }) },
    };
    // settings.update held in company s-1 (their own).
    access = accessMock({ permissions: ['settings.update'] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanalService,
        { provide: DatabaseService, useValue: database },
        { provide: ActivityService, useValue: { tryRecord: jest.fn() } },
        { provide: AccessService, useValue: access },
      ],
    }).compile();

    service = module.get<CanalService>(CanalService);
  });

  it('lets whoever manages a company create its canaux', async () => {
    await service.create({ name: 'Coursier', companyId: 's-1' }, 'u-admin-s1');

    expect(access.assertManages).toHaveBeenCalledWith(
      'u-admin-s1',
      'settings.update',
      's-1',
      'Ce canal',
    );
    expect(database.canal.create).toHaveBeenCalled();
  });

  it("refuses another company's", async () => {
    await expect(
      service.create({ name: 'Coursier', companyId: 's-2' }, 'u-admin-s1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.canal.create).not.toHaveBeenCalled();
  });

  it('refuses someone who manages no company', async () => {
    access.state.permissions = [];

    await expect(
      service.create({ name: 'Coursier', companyId: 's-1' }, 'u-agent'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
