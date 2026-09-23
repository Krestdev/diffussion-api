import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CircuitService } from './circuit.service';

describe('CircuitService', () => {
  let service: CircuitService;
  let database: {
    circuit: Record<string, jest.Mock>;
    dossierType: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    database = {
      circuit: {
        create: jest.fn().mockResolvedValue({ id: 'c-1' }),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      dossierType: { findUnique: jest.fn().mockResolvedValue({ id: 'dt-1' }) },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'r-1' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();

    service = module.get<CircuitService>(CircuitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates the circuit when both references exist', async () => {
      await service.create({
        name: 'Validation',
        dossierTypeId: 'dt-1',
        roleId: 'r-1',
      });

      expect(database.circuit.create).toHaveBeenCalled();
    });

    it('names the unknown dossier type instead of failing on a foreign key', async () => {
      database.dossierType.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Validation', dossierTypeId: 'missing' }),
      ).rejects.toThrow(
        new BadRequestException('Dossier type missing not found'),
      );
      expect(database.circuit.create).not.toHaveBeenCalled();
    });

    it('names the unknown role', async () => {
      database.role.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Validation', roleId: 'missing' }),
      ).rejects.toThrow(new BadRequestException('Role missing not found'));
      expect(database.circuit.create).not.toHaveBeenCalled();
    });
  });
});
