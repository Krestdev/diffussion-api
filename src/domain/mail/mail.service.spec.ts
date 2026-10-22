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
import { StorageService } from '../../storage/storage.service';

describe('MailService', () => {
  let service: MailService;
  let database: {
    courrier: Record<string, jest.Mock>;
    dossier: Record<string, jest.Mock>;
    document: Record<string, jest.Mock>;
    site: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let circuitInstanceService: Record<string, jest.Mock>;
  let rbac: Record<string, jest.Mock>;
  let storage: { upload: jest.Mock };

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
      dossier: { findUnique: jest.fn(), updateMany: jest.fn() },
      document: { create: jest.fn() },
      site: { findUnique: jest.fn() },
      validation: { create: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    circuitInstanceService = { start: jest.fn() };
    rbac = {
      hasPermission: jest.fn().mockResolvedValue(false),
      // Global grant by default: no site restriction.
      siteFilter: jest.fn().mockResolvedValue({}),
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ key: 'test-key' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: DatabaseService, useValue: database },
        { provide: CircuitInstanceService, useValue: circuitInstanceService },
        { provide: RbacService, useValue: rbac },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('findIncoming', () => {
    beforeEach(() => {
      database.courrier.findMany.mockResolvedValue([{ id: 'c-1' }]);
      database.courrier.count
        .mockResolvedValueOnce(1) // filtered total
        .mockResolvedValueOnce(57) // metrics.total
        .mockResolvedValueOnce(9); // metrics.archived
    });

    it('returns the page plus unfiltered metrics in one payload', async () => {
      const result = await service.findIncoming({ skip: 0, take: 20 }, 'u-1');

      expect(result).toEqual({
        data: [{ id: 'c-1' }],
        total: 1,
        skip: 0,
        take: 20,
        metrics: { total: 57, archived: 9 },
      });
    });

    it('filters by circuit owner, without touching the metrics', async () => {
      await service.findIncoming({ ownerId: 'owner-1' }, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.ownerId).toBe('owner-1');
      expect(database.courrier.count.mock.calls[1][0].where).not.toHaveProperty(
        'ownerId',
      );
    });

    it('scopes to incoming courriers in dossiers the user can see', async () => {
      await service.findIncoming({}, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.direction).toBe(CourrierDirection.ENTRANT);
      expect(where.OR[0].dossier.AND[0].OR).toContainEqual({
        responsibleId: 'u-1',
      });
      // The metric counts use the same visibility scope, without filters.
      const metricsWhere = database.courrier.count.mock.calls[1][0].where;
      expect(metricsWhere).toEqual({
        direction: CourrierDirection.ENTRANT,
        OR: where.OR,
      });
    });

    it('only lists courriers on the sites where the user may read them', async () => {
      rbac.siteFilter.mockImplementation((_u, _code, toWhere) =>
        Promise.resolve(toWhere({ in: ['s-A'] })),
      );

      await service.findIncoming({}, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.OR[0].dossier.AND[1]).toEqual({ siteId: { in: ['s-A'] } });
      // Own drafts without a dossier are not tied to a site.
      expect(where.OR[1]).toEqual({ dossierId: null, createdById: 'u-1' });
    });

    it('searches subject, number and reference, and includes the whole "to" day', async () => {
      await service.findIncoming(
        {
          search: 'raccord',
          receivedFrom: '2026-09-01',
          receivedTo: '2026-09-30',
        },
        'u-1',
      );

      const { where } = database.courrier.findMany.mock.calls[0][0];
      const [search, received] = where.AND;
      expect(search.OR).toHaveLength(3);
      expect(received.OR[0].receivedAt).toEqual({
        gte: new Date('2026-09-01'),
        lt: new Date('2026-10-01'),
      });
      expect(received.OR[1]).toEqual({
        receivedAt: null,
        createdAt: received.OR[0].receivedAt,
      });
    });
  });

  describe('findOutgoing', () => {
    beforeEach(() => {
      database.courrier.findMany.mockResolvedValue([{ id: 's-1' }]);
      database.courrier.count
        .mockResolvedValueOnce(1) // filtered total
        .mockResolvedValueOnce(4) // pending
        .mockResolvedValueOnce(3) // approved
        .mockResolvedValueOnce(2) // rejected
        .mockResolvedValueOnce(10); // all
    });

    it('returns one tab of rows plus every tab count', async () => {
      const result = await service.findOutgoing(
        { group: 'pending', skip: 0, take: 20 },
        'u-1',
      );

      expect(result).toEqual({
        data: [{ id: 's-1' }],
        total: 1,
        skip: 0,
        take: 20,
        metrics: { pending: 4, approved: 3, rejected: 2, total: 10 },
      });
    });

    it('filters by circuit owner, without touching the tab counts', async () => {
      await service.findOutgoing(
        { group: 'pending', ownerId: 'owner-1' },
        'u-1',
      );

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.ownerId).toBe('owner-1');
      for (const call of database.courrier.count.mock.calls.slice(1)) {
        expect(call[0].where).not.toHaveProperty('ownerId');
      }
    });

    it('turns a tab into its statuses and keeps the visibility scope', async () => {
      await service.findOutgoing({ group: 'approved' }, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.direction).toBe(CourrierDirection.SORTANT);
      expect(where.OR[0].dossier.AND[0].OR).toContainEqual({
        createdById: 'u-1',
      });
      // The caller's own drafts not yet attached to a dossier stay listed.
      expect(where.OR).toContainEqual({ dossierId: null, createdById: 'u-1' });
      expect(where.AND).toContainEqual({
        status: {
          in: [
            CourrierStatus.VALIDE,
            CourrierStatus.PRET_A_ENVOYER,
            CourrierStatus.ENVOYE,
          ],
        },
      });
      // Tab counts ignore the selected tab and other filters.
      const pendingWhere = database.courrier.count.mock.calls[1][0].where;
      expect(pendingWhere).toEqual({
        direction: CourrierDirection.SORTANT,
        OR: where.OR,
        status: { in: [CourrierStatus.BROUILLON, CourrierStatus.EN_CIRCUIT] },
      });
    });

    it('filters the registration date, including the whole "to" day', async () => {
      await service.findOutgoing({ createdTo: '2026-09-30' }, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.createdAt).toEqual({ lt: new Date('2026-10-01') });
      expect(where.AND).toEqual([]);
    });
  });

  describe('createOutgoingDraft', () => {
    it('creates a numbered sortant BROUILLON from its subject alone', async () => {
      database.courrier.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'c-1', ...data }),
      );

      const result = await service.createOutgoingDraft(
        { subject: 'Réponse au chantier' },
        'u-1',
      );

      expect(result).toMatchObject({
        subject: 'Réponse au chantier',
        direction: CourrierDirection.SORTANT,
        status: CourrierStatus.BROUILLON,
        createdById: 'u-1',
      });
      expect(result.number).toMatch(/^M-\d{6}$/);
      expect(database.courrier.create.mock.calls[0][0].data).not.toHaveProperty(
        'dossierId',
      );
    });
  });

  describe('update', () => {
    const draft = {
      id: 'c-1',
      status: CourrierStatus.BROUILLON,
      dossierId: null,
    };

    it('attaches a draft to its dossier and starts that dossier', async () => {
      database.courrier.findUnique.mockResolvedValue(draft);
      database.dossier.findUnique.mockResolvedValue({
        number: 'D-1',
        status: 'OPEN',
        siteId: 's-1',
      });
      database.site.findUnique.mockResolvedValue({
        name: 'Douala',
        status: 'ACTIVE',
      });
      database.courrier.update.mockResolvedValue({
        ...draft,
        dossierId: 'd-1',
      });

      await service.update('c-1', { dossierId: 'd-1' });

      expect(database.courrier.update.mock.calls[0][0].data.dossierId).toBe(
        'd-1',
      );
      expect(database.dossier.updateMany).toHaveBeenCalledWith({
        where: { id: 'd-1', status: 'OPEN' },
        data: { status: 'IN_PROGRESS' },
      });
    });

    it('refuses to attach a draft to a closed dossier', async () => {
      database.courrier.findUnique.mockResolvedValue(draft);
      database.dossier.findUnique.mockResolvedValue({
        number: 'D-1',
        status: 'CLOSED',
        siteId: 's-1',
      });

      await expect(
        service.update('c-1', { dossierId: 'd-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.courrier.update).not.toHaveBeenCalled();
    });

    it('leaves the dossier alone when it is not changed', async () => {
      database.courrier.findUnique.mockResolvedValue(draft);
      database.courrier.update.mockResolvedValue(draft);

      await service.update('c-1', { subject: 'Nouveau sujet' });

      expect(database.dossier.findUnique).not.toHaveBeenCalled();
      expect(database.dossier.updateMany).not.toHaveBeenCalled();
    });
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

    it("allows the owning site's responsible", async () => {
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
