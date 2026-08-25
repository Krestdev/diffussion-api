import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MailService } from './mail.service';
import { DatabaseService } from '../../database/database.service';
import { CourrierStatus } from '../../../generated/prisma/client';

describe('MailService', () => {
  let service: MailService;
  let database: {
    courrier: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      courrier: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      validation: { create: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitForVerification', () => {
    it('refuses when the courrier is not a draft', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.ENVOYE,
      });

      await expect(service.submitForVerification('c-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('moves a draft to EN_VERIFICATION', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.BROUILLON,
      });
      database.courrier.update.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.EN_VERIFICATION,
      });

      const result = await service.submitForVerification('c-1');

      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: CourrierStatus.EN_VERIFICATION },
        }),
      );
      expect(result.status).toBe(CourrierStatus.EN_VERIFICATION);
    });
  });

  describe('discharge', () => {
    it('refuses a décharge before the courrier is registered (RG-COU-007)', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.RECU,
      });

      await expect(service.discharge('c-1', 'u-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a courrier that has already been transmitted (RG-COU-004)', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.TRANSMIS,
      });

      await expect(service.remove('c-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.courrier.delete).not.toHaveBeenCalled();
    });
  });
});
