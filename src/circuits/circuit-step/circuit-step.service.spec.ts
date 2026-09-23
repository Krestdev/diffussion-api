import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CircuitStepService } from './circuit-step.service';

describe('CircuitStepService', () => {
  let service: CircuitStepService;
  let database: {
    circuit: Record<string, jest.Mock>;
    circuitInstance: Record<string, jest.Mock>;
    circuitStep: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    database = {
      circuit: { findUnique: jest.fn().mockResolvedValue({ id: 'c-1' }) },
      circuitStep: {
        create: jest.fn().mockResolvedValue({ id: 's-new' }),
        update: jest.fn().mockResolvedValue({ id: 's-1' }),
        delete: jest.fn(),
        // No clash and no parent unless a test says otherwise.
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'r-1' }) },
      // No run in progress unless a test says otherwise.
      circuitInstance: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitStepService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();

    service = module.get<CircuitStepService>(CircuitStepService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('order', () => {
    it('creates a step when its position is free', async () => {
      await service.create({ circuitId: 'c-1', order: 2 });
      expect(database.circuitStep.create).toHaveBeenCalled();
    });

    it('refuses a position already taken in the same circuit', async () => {
      database.circuitStep.findFirst.mockResolvedValue({ id: 's-other' });

      await expect(
        service.create({ circuitId: 'c-1', order: 1 }),
      ).rejects.toThrow(
        new BadRequestException(
          'Another step of this circuit already has order 1',
        ),
      );
      expect(database.circuitStep.create).not.toHaveBeenCalled();
    });
  });

  describe('parentStepId (rejection target)', () => {
    const step = (over: Record<string, unknown> = {}) => ({
      id: 's-1',
      circuitId: 'c-1',
      order: 2,
      parentStepId: null,
      ...over,
    });

    it('accepts an earlier step of the same circuit', async () => {
      database.circuitStep.findUnique.mockResolvedValue(
        step({ id: 's-0', order: 1 }),
      );

      await service.create({
        circuitId: 'c-1',
        order: 2,
        parentStepId: 's-0',
      });

      expect(database.circuitStep.create).toHaveBeenCalled();
    });

    it('refuses a target that sits after the step (rejection loop)', async () => {
      database.circuitStep.findUnique.mockResolvedValue(
        step({ id: 's-3', order: 3 }),
      );

      await expect(
        service.create({ circuitId: 'c-1', order: 2, parentStepId: 's-3' }),
      ).rejects.toThrow(
        new BadRequestException(
          'The rejection target must be an earlier step (its order 3 must be below 2)',
        ),
      );
      expect(database.circuitStep.create).not.toHaveBeenCalled();
    });

    it('refuses a target belonging to another circuit', async () => {
      database.circuitStep.findUnique.mockResolvedValue(
        step({ id: 's-x', circuitId: 'c-2', order: 1 }),
      );

      await expect(
        service.create({ circuitId: 'c-1', order: 2, parentStepId: 's-x' }),
      ).rejects.toThrow(
        new BadRequestException(
          'The rejection target must belong to the same circuit',
        ),
      );
    });

    it('refuses an unknown target', async () => {
      database.circuitStep.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ circuitId: 'c-1', order: 2, parentStepId: 'ghost' }),
      ).rejects.toThrow(new BadRequestException('Parent step ghost not found'));
    });

    it('refuses a step pointing at itself on update', async () => {
      database.circuitStep.findUnique.mockResolvedValue(step());

      await expect(
        service.update('s-1', { parentStepId: 's-1' }),
      ).rejects.toThrow(
        new BadRequestException('A step cannot be its own rejection target'),
      );
    });
  });

  describe('update', () => {
    it('refuses a move that would place the step at or after its children', async () => {
      database.circuitStep.findUnique.mockResolvedValue({
        id: 's-1',
        circuitId: 'c-1',
        order: 1,
        parentStepId: null,
      });
      // A step that falls back to s-1 sits at order 3.
      database.circuitStep.findMany.mockResolvedValue([{ order: 3 }]);

      await expect(service.update('s-1', { order: 4 })).rejects.toThrow(
        new BadRequestException(
          'Order 4 would place this step at or after step(s) 3 that fall back to it on rejection',
        ),
      );
      expect(database.circuitStep.update).not.toHaveBeenCalled();
    });
  });
});
