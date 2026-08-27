import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CircuitInstanceService } from './circuit-instance.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CircuitInstanceStatus,
  CourrierStatus,
  ValidationDecision,
} from '../../../generated/prisma/client';

describe('CircuitInstanceService', () => {
  let service: CircuitInstanceService;
  let notifications: { create: jest.Mock };
  let database: {
    courrier: Record<string, jest.Mock>;
    dossier: Record<string, jest.Mock>;
    document: Record<string, jest.Mock>;
    circuit: Record<string, jest.Mock>;
    circuitInstance: Record<string, jest.Mock>;
    circuitStepInstanceCircuit: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    assignment: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  // A minimal fake transaction client mirroring `database` — the service's
  // `$transaction(async (tx) => ...)` calls run their callback against this.
  function fakeTx() {
    return database;
  }

  beforeEach(async () => {
    database = {
      courrier: { findUnique: jest.fn(), update: jest.fn() },
      dossier: { findUnique: jest.fn() },
      document: { findUnique: jest.fn() },
      circuit: { findUnique: jest.fn(), findMany: jest.fn() },
      circuitInstance: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
      },
      circuitStepInstanceCircuit: { create: jest.fn() },
      userRole: { findFirst: jest.fn() },
      assignment: { findFirst: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      validation: { create: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(fakeTx())),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitInstanceService,
        { provide: DatabaseService, useValue: database },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<CircuitInstanceService>(CircuitInstanceService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('start', () => {
    it('refuses when neither courrierId nor documentId is given', async () => {
      await expect(service.start({}, 'u-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses when the dossier type has no circuit configured', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        dossierId: 'd-1',
      });
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        title: 'Test',
        typeId: 't-1',
        siteId: 'site-1',
      });
      database.circuit.findMany.mockResolvedValue([]);

      await expect(
        service.start({ courrierId: 'c-1' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a document with no reachable dossier', async () => {
      database.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        dossierId: null,
        courrier: null,
      });

      await expect(
        service.start({ documentId: 'doc-1' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when the user holds the role but is not assigned to the site', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        dossierId: 'd-1',
        ownerId: null,
      });
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        title: 'Test',
        typeId: 't-1',
        siteId: 'site-1',
      });
      database.circuit.findMany.mockResolvedValue([
        {
          id: 'ci-1',
          name: 'Circuit',
          roleId: 'r-1',
          steps: [{ id: 's-1', order: 1 }],
        },
      ]);
      database.userRole.findFirst.mockResolvedValue({ id: 'ur-1' });
      database.assignment.findFirst.mockResolvedValue(null);

      await expect(
        service.start({ courrierId: 'c-1' }, 'u-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when the user is assigned to the site but lacks the role', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        dossierId: 'd-1',
        ownerId: null,
      });
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        title: 'Test',
        typeId: 't-1',
        siteId: 'site-1',
      });
      database.circuit.findMany.mockResolvedValue([
        {
          id: 'ci-1',
          name: 'Circuit',
          roleId: 'r-1',
          steps: [{ id: 's-1', order: 1 }],
        },
      ]);
      database.userRole.findFirst.mockResolvedValue(null);
      database.assignment.findFirst.mockResolvedValue({ id: 'a-1' });

      await expect(
        service.start({ courrierId: 'c-1' }, 'u-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a role-gated circuit to be triggered by the courrier owner even without the role', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        dossierId: 'd-1',
        ownerId: 'u-1',
      });
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        title: 'Test',
        typeId: 't-1',
        siteId: 'site-1',
      });
      database.circuit.findMany.mockResolvedValue([
        {
          id: 'circ-1',
          name: 'Circuit',
          roleId: 'r-1',
          steps: [{ id: 's-1', order: 1 }],
        },
      ]);
      database.circuitInstance.create.mockResolvedValue({ id: 'inst-1' });
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        currentStepId: 's-1',
      });

      const result = await service.start({ courrierId: 'c-1' }, 'u-1');

      expect(database.userRole.findFirst).not.toHaveBeenCalled();
      expect(result.id).toBe('inst-1');
    });

    it('creates the instance on the first step and marks the courrier EN_CIRCUIT', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        dossierId: 'd-1',
      });
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        title: 'Test',
        typeId: 't-1',
        siteId: 'site-1',
      });
      database.circuit.findMany.mockResolvedValue([
        {
          id: 'circ-1',
          name: 'Circuit',
          roleId: null,
          steps: [{ id: 's-1', order: 1 }],
        },
      ]);
      database.circuitInstance.create.mockResolvedValue({ id: 'inst-1' });
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        currentStepId: 's-1',
      });

      const result = await service.start({ courrierId: 'c-1' }, 'u-1');

      expect(database.circuitInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            circuitId: 'circ-1',
            dossierId: 'd-1',
            courrierId: 'c-1',
            documentId: undefined,
            currentStepId: 's-1',
          }),
        }),
      );
      expect(database.courrier.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { status: CourrierStatus.EN_CIRCUIT },
      });
      expect(result.id).toBe('inst-1');
    });

    it('starts a circuit directly on a document, resolving the dossier through its courrier', async () => {
      database.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        dossierId: null,
        ownerId: null,
        courrier: { dossierId: 'd-1' },
      });
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        title: 'Test',
        typeId: 't-1',
        siteId: 'site-1',
      });
      database.circuit.findMany.mockResolvedValue([
        {
          id: 'circ-1',
          name: 'Circuit',
          roleId: null,
          steps: [{ id: 's-1', order: 1 }],
        },
      ]);
      database.circuitInstance.create.mockResolvedValue({ id: 'inst-1' });
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        currentStepId: 's-1',
      });

      await service.start({ documentId: 'doc-1' }, 'u-1');

      expect(database.circuitInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dossierId: 'd-1',
            courrierId: undefined,
            documentId: 'doc-1',
          }),
        }),
      );
      // No courrier attached to this instance — its status is untouched.
      expect(database.courrier.update).not.toHaveBeenCalled();
    });
  });

  describe('decide', () => {
    function instanceAtStep(
      step: {
        id: string;
        order: number;
        roleId?: string | null;
        parentStepId?: string | null;
      },
      target: {
        courrier?: { ownerId: string | null; siteId: string | null } | null;
        document?: { ownerId: string | null; siteId: string | null } | null;
      } = {},
    ) {
      return {
        id: 'inst-1',
        status: CircuitInstanceStatus.IN_PROGRESS,
        courrierId: target.courrier ? 'c-1' : null,
        currentStep: { roleId: null, ...step },
        circuit: {
          steps: [{ id: 's-1', order: 1 }, { id: 's-2', order: 2 }, step]
            .filter(
              (s, index, arr) =>
                arr.findIndex((other) => other.id === s.id) === index,
            )
            .sort((a, b) => a.order - b.order),
        },
        courrier: target.courrier
          ? {
              ownerId: target.courrier.ownerId,
              dossier: { siteId: target.courrier.siteId },
            }
          : undefined,
        document: target.document
          ? {
              ownerId: target.document.ownerId,
              dossier: { siteId: target.document.siteId },
              courrier: null,
            }
          : undefined,
      };
    }

    it('refuses to decide on a non-IN_PROGRESS instance', async () => {
      database.circuitInstance.findUnique.mockResolvedValue({
        ...instanceAtStep({ id: 's-1', order: 1 }),
        status: CircuitInstanceStatus.COMPLETED,
      });

      await expect(
        service.decide(
          'inst-1',
          { decision: ValidationDecision.VALIDE },
          'u-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for an unknown instance', async () => {
      database.circuitInstance.findUnique.mockResolvedValue(null);

      await expect(
        service.decide(
          'missing',
          { decision: ValidationDecision.VALIDE },
          'u-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses when the user holds the role but is not assigned to the courrier site', async () => {
      database.circuitInstance.findUnique.mockResolvedValue(
        instanceAtStep(
          { id: 's-1', order: 1, roleId: 'r-1' },
          { courrier: { ownerId: null, siteId: 'site-1' } },
        ),
      );
      database.userRole.findFirst.mockResolvedValue({ id: 'ur-1' });
      database.assignment.findFirst.mockResolvedValue(null);

      await expect(
        service.decide(
          'inst-1',
          { decision: ValidationDecision.VALIDE },
          'u-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the courrier owner to decide a role-gated step without holding the role', async () => {
      database.circuitInstance.findUnique.mockResolvedValue(
        instanceAtStep(
          { id: 's-1', order: 1, roleId: 'r-1' },
          { courrier: { ownerId: 'u-1', siteId: 'site-1' } },
        ),
      );
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        currentStepId: 's-2',
      });

      await service.decide(
        'inst-1',
        { decision: ValidationDecision.VALIDE },
        'u-1',
      );

      expect(database.userRole.findFirst).not.toHaveBeenCalled();
      expect(database.circuitInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { currentStepId: 's-2' },
      });
    });

    it('allows a role-and-site-eligible user to decide a document-attached step', async () => {
      database.circuitInstance.findUnique.mockResolvedValue(
        instanceAtStep(
          { id: 's-1', order: 1, roleId: 'r-1' },
          { document: { ownerId: null, siteId: 'site-1' } },
        ),
      );
      database.userRole.findFirst.mockResolvedValue({ id: 'ur-1' });
      database.assignment.findFirst.mockResolvedValue({ id: 'a-1' });
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        currentStepId: 's-2',
      });

      await service.decide(
        'inst-1',
        { decision: ValidationDecision.VALIDE },
        'u-1',
      );

      expect(database.assignment.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u-1', siteId: 'site-1' },
      });
      expect(database.circuitInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { currentStepId: 's-2' },
      });
    });

    it('advances to the next step on approval', async () => {
      database.circuitInstance.findUnique.mockResolvedValue(
        instanceAtStep({ id: 's-1', order: 1 }),
      );
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        currentStepId: 's-2',
      });

      await service.decide(
        'inst-1',
        { decision: ValidationDecision.VALIDE },
        'u-1',
      );

      expect(database.circuitInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { currentStepId: 's-2' },
      });
      expect(database.courrier.update).not.toHaveBeenCalled();
    });

    it('completes the instance and validates the courrier on the last step', async () => {
      database.circuitInstance.findUnique.mockResolvedValue({
        ...instanceAtStep({ id: 's-2', order: 2 }),
        courrierId: 'c-1',
      });
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        status: CircuitInstanceStatus.COMPLETED,
      });

      await service.decide(
        'inst-1',
        { decision: ValidationDecision.VALIDE },
        'u-1',
      );

      expect(database.circuitInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: {
          status: CircuitInstanceStatus.COMPLETED,
          completedAt: expect.any(Date),
        },
      });
      expect(database.courrier.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { status: CourrierStatus.VALIDE },
      });
    });

    it('falls back to the parent step on rejection', async () => {
      database.circuitInstance.findUnique.mockResolvedValue(
        instanceAtStep({ id: 's-2', order: 2, parentStepId: 's-1' }),
      );
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        currentStepId: 's-1',
      });

      await service.decide(
        'inst-1',
        { decision: ValidationDecision.CORRECTIONS_DEMANDEES },
        'u-1',
      );

      expect(database.circuitInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { currentStepId: 's-1' },
      });
      expect(database.courrier.update).not.toHaveBeenCalled();
    });

    it('cancels the instance and sends the courrier back to correction when there is no fallback step', async () => {
      database.circuitInstance.findUnique.mockResolvedValue({
        ...instanceAtStep({ id: 's-1', order: 1, parentStepId: null }),
        courrierId: 'c-1',
      });
      database.circuitInstance.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-1',
        status: CircuitInstanceStatus.CANCELLED,
      });

      await service.decide(
        'inst-1',
        { decision: ValidationDecision.REJETE },
        'u-1',
      );

      expect(database.circuitInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: {
          status: CircuitInstanceStatus.CANCELLED,
          completedAt: expect.any(Date),
        },
      });
      expect(database.courrier.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { status: CourrierStatus.A_CORRIGER },
      });
    });
  });
});
