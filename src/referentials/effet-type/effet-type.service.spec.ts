import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import { accessMock, AccessMock } from '../access-mock.testing-spec';
import { EffetTypeService } from './effet-type.service';
import { ReferenceModelDto } from './dto/reference-model.dto';

const referenceModel: ReferenceModelDto = {
  prefix: 'LET',
  separator: '-',
  counterDigits: 6,
  counterReset: 'YEARLY',
  yearDigits: 4,
  monthIncluded: false,
  codes: [],
};

describe('EffetTypeService', () => {
  let service: EffetTypeService;
  let database: {
    effetType: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let access: AccessMock;

  const createdData = () =>
    (
      database.effetType.create.mock.calls[0][0] as {
        data: { companyId: unknown };
      }
    ).data;

  beforeEach(async () => {
    database = {
      effetType: {
        create: jest.fn().mockResolvedValue({ id: 't-new' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 't-1' }),
        delete: jest.fn(),
      },
      courrier: { count: jest.fn().mockResolvedValue(0) },
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 's-1' }) },
    };
    // settings.update in their company s-1 unless a test says otherwise.
    access = accessMock({ permissions: ['settings.update', 'settings.read'] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EffetTypeService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue('log-1') },
        },
      ],
    }).compile();

    service = module.get<EffetTypeService>(EffetTypeService);
  });

  describe('a holder of settings.update in their company', () => {
    it('creates types for their own company', async () => {
      await service.create(
        { name: 'Échantillon de sol', isPhysical: true, referenceModel },
        'resp-s1',
      );

      expect(createdData().companyId).toBe('s-1');
    });

    it('cannot create a type for another company', async () => {
      await expect(
        service.create(
          { name: 'Échantillon', companyId: 's-2', referenceModel },
          'resp-s1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.effetType.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a global type', null],
      ["another company's type", 's-2'],
    ])('cannot change or delete %s', async (_label, companyId) => {
      database.effetType.findUnique.mockResolvedValue({ id: 't-1', companyId });

      await expect(
        service.update('t-1', { name: 'X' }, 'resp-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove('t-1', 'resp-s1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('keeps the common types when filtering by company', async () => {
      await service.findAll({ companyId: 's-1' }, 'resp-s1');

      expect(database.effetType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { OR: [{ companyId: null }, { companyId: 's-1' }] },
              { OR: [{ companyId: null }, { companyId: 's-1' }] },
              {},
            ],
          },
        }),
      );
    });

    it('sees the global types and its own company’s', async () => {
      await service.findAll({}, 'resp-s1');

      expect(database.effetType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ OR: [{ companyId: null }, { companyId: 's-1' }] }, {}, {}],
          },
        }),
      );
    });
  });

  it('refuses someone who administers nothing', async () => {
    access.state.permissions = [];

    await expect(
      service.create({ name: 'Échantillon', referenceModel }, 'nobody'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates global types for a super-administrator', async () => {
    access.state.platformAdmin = true;

    await service.create({ name: 'Plan', referenceModel }, 'super-admin');

    expect(createdData().companyId).toBeNull();
  });

  it('keeps a type that effets use: deactivate it instead', async () => {
    database.effetType.findUnique.mockResolvedValue({
      id: 't-1',
      companyId: 's-1',
    });
    database.courrier.count.mockResolvedValue(4);

    await expect(service.remove('t-1', 'resp-s1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(database.effetType.delete).not.toHaveBeenCalled();
  });

  it('refuses a duplicate name within the same company', async () => {
    database.effetType.findFirst.mockResolvedValue({ id: 't-other' });

    await expect(
      service.create({ name: 'Échantillon', referenceModel }, 'resp-s1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('reference model', () => {
    it.each([
      ['a yearly counter without the year', { yearDigits: 0 }],
      [
        'a monthly counter without the month',
        { counterReset: 'MONTHLY', monthIncluded: false },
      ],
      [
        'a monthly counter without the year',
        { counterReset: 'MONTHLY', monthIncluded: true, yearDigits: 0 },
      ],
    ])('refuses %s', async (_label, change) => {
      await expect(
        service.create(
          {
            name: 'Lettre',
            referenceModel: { ...referenceModel, ...change },
          } as Parameters<EffetTypeService['create']>[0],
          'resp-s1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a prefix another type of the company already has', async () => {
      database.effetType.findFirst
        .mockResolvedValueOnce(null) // the name is free
        .mockResolvedValueOnce({ name: 'Courrier' });

      await expect(
        service.create({ name: 'Lettre', referenceModel }, 'resp-s1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('can be changed but not taken away', async () => {
      database.effetType.findUnique.mockResolvedValue({
        id: 't-1',
        companyId: 's-1',
        referenceModel,
      });

      await expect(
        service.update(
          't-1',
          { referenceModel: null } as unknown as Parameters<
            EffetTypeService['update']
          >[1],
          'resp-s1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
