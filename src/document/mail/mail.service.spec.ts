import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MailService } from './mail.service';
import { DatabaseService } from '../../database/database.service';
import { CircuitInstanceService } from '../../circuits/circuit-instance/circuit-instance.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import {
  CourrierDirection,
  CourrierStatus,
} from '../../../generated/prisma/client';

describe('MailService', () => {
  let service: MailService;
  let database: {
    courrier: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let circuitInstanceService: Record<string, jest.Mock>;
  let rbac: Record<string, jest.Mock>;

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
    circuitInstanceService = { start: jest.fn() };
    rbac = { hasPermission: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: DatabaseService, useValue: database },
        { provide: CircuitInstanceService, useValue: circuitInstanceService },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitForVerification', () => {
    it('refuses a sortant courrier that is not a draft', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        direction: CourrierDirection.SORTANT,
        status: CourrierStatus.ENVOYE,
      });

      await expect(
        service.submitForVerification('c-1', 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(circuitInstanceService.start).not.toHaveBeenCalled();
    });

    it('starts a circuit instance for a sortant courrier and returns it', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        direction: CourrierDirection.SORTANT,
        status: CourrierStatus.BROUILLON,
      });
      circuitInstanceService.start.mockResolvedValue({ id: 'ci-1' });

      const result = await service.submitForVerification('c-1', 'u-1');

      expect(circuitInstanceService.start).toHaveBeenCalledWith(
        { courrierId: 'c-1' },
        'u-1',
      );
      expect(result.id).toBe('c-1');
    });

    it('refuses an entrant courrier still awaiting transmission', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        direction: CourrierDirection.ENTRANT,
        status: CourrierStatus.RECU,
      });

      await expect(
        service.submitForVerification('c-1', 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(circuitInstanceService.start).not.toHaveBeenCalled();
    });

    it('starts a circuit instance for an entrant courrier once transmitted', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        direction: CourrierDirection.ENTRANT,
        status: CourrierStatus.TRANSMIS,
      });
      circuitInstanceService.start.mockResolvedValue({ id: 'ci-1' });

      const result = await service.submitForVerification('c-1', 'u-1');

      expect(circuitInstanceService.start).toHaveBeenCalledWith(
        { courrierId: 'c-1' },
        'u-1',
      );
      expect(result.id).toBe('c-1');
    });
  });

  describe('setOwner', () => {
    function withActingUser(actingId: string | null) {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        createdById: actingId,
        dossier: { site: { responsibleId: null } },
      });
    }

    it('allows the courrier creator', async () => {
      withActingUser('u-1');
      database.courrier.update.mockResolvedValue({ id: 'c-1', ownerId: 'u-2' });

      await service.setOwner('c-1', { ownerId: 'u-2' }, 'u-1');

      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ownerId: 'u-2' } }),
      );
    });

    it('allows the owning site\'s responsible', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        createdById: 'someone-else',
        dossier: { site: { responsibleId: 'u-1' } },
      });
      database.courrier.update.mockResolvedValue({ id: 'c-1' });

      await expect(
        service.setOwner('c-1', { ownerId: 'u-2' }, 'u-1'),
      ).resolves.toBeDefined();
    });

    it('allows a platform admin', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        createdById: 'someone-else',
        dossier: { site: { responsibleId: 'someone-else-too' } },
      });
      rbac.hasPermission.mockResolvedValue(true);
      database.courrier.update.mockResolvedValue({ id: 'c-1' });

      await expect(
        service.setOwner('c-1', { ownerId: 'u-2' }, 'u-1'),
      ).resolves.toBeDefined();
    });

    it('refuses anyone else', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        createdById: 'someone-else',
        dossier: { site: { responsibleId: 'someone-else-too' } },
      });

      await expect(
        service.setOwner('c-1', { ownerId: 'u-2' }, 'u-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.courrier.update).not.toHaveBeenCalled();
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
