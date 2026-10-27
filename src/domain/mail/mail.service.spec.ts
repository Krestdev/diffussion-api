import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MailService } from './mail.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import {
  CourrierDirection,
  CourrierStatus,
  ValidationDecision,
} from '../../../generated/prisma/client';
import { StorageService } from '../../storage/storage.service';

describe('MailService', () => {
  let service: MailService;
  let database: {
    courrier: Record<string, jest.Mock>;
    dossier: Record<string, jest.Mock>;
    document: Record<string, jest.Mock>;
    site: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let notifications: { create: jest.Mock };
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
        delete: jest.fn(),
      },
      dossier: { findUnique: jest.fn(), updateMany: jest.fn() },
      document: { create: jest.fn() },
      site: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      validation: { create: jest.fn() },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(database)
          : Promise.all(arg as unknown[]),
      ),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    rbac = {
      hasPermission: jest.fn().mockResolvedValue(false),
      hasGlobalPermission: jest.fn().mockResolvedValue(false),
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
        { provide: NotificationsService, useValue: notifications },
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

    it('filters by person in charge, without touching the metrics', async () => {
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
      // Entrants still waiting for their dossier: on the registrant's site.
      expect(where.OR[2]).toEqual({
        dossierId: null,
        createdBy: { siteId: { in: ['s-A'] } },
      });
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

    it('filters by person in charge, without touching the tab counts', async () => {
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
        status: {
          in: [CourrierStatus.BROUILLON, CourrierStatus.EN_ATTENTE_VALIDATION],
        },
      });
    });

    it('filters the registration date, including the whole "to" day', async () => {
      await service.findOutgoing({ createdTo: '2026-09-30' }, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.createdAt).toEqual({ lt: new Date('2026-10-01') });
      expect(where.AND).toEqual([]);
    });
  });

  describe('create (entrant)', () => {
    const ENTRANT = {
      direction: CourrierDirection.ENTRANT,
      subject: 'Demande du maître d’ouvrage',
    };

    beforeEach(() => {
      database.courrier.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'c-1', ...data }),
      );
    });

    it('registers an entrant without its dossier, on the registrant’s site', async () => {
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });

      const result = await service.create(ENTRANT, 'u-agent');

      expect(result).toMatchObject({
        status: CourrierStatus.RECU,
        createdById: 'u-agent',
      });
      expect(database.courrier.create.mock.calls[0][0].data.dossierId).toBe(
        undefined,
      );
      expect(database.dossier.updateMany).not.toHaveBeenCalled();
    });

    it('needs a dossier when the registrant belongs to no site', async () => {
      database.user.findUnique.mockResolvedValue({ siteId: null });

      await expect(
        service.create(ENTRANT, 'super-admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.courrier.create).not.toHaveBeenCalled();
    });
  });

  describe('transmit', () => {
    it('refuses an entrant not yet attached to its dossier', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.RECU,
        dossierId: null,
      });

      await expect(service.transmit('c-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.courrier.update).not.toHaveBeenCalled();
    });

    it('transmits it once its dossier is known', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.RECU,
        dossierId: 'd-1',
      });

      await service.transmit('c-1');

      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: CourrierStatus.TRANSMIS },
        }),
      );
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

  describe('validation', () => {
    // A courrier in the dossier d-1, whose responsible is the validator.
    const courrier = (
      status: CourrierStatus,
      direction: CourrierDirection = CourrierDirection.SORTANT,
    ) => ({
      id: 'c-1',
      subject: 'Réponse au maître d’ouvrage',
      direction,
      status,
      dossierId: 'd-1',
      createdById: 'u-author',
      ownerId: null,
    });
    const responsible = (
      responsibleId: string | null,
      siteResponsibleId: string | null = null,
    ) =>
      database.dossier.findUnique.mockResolvedValue({
        responsibleId,
        site: { responsibleId: siteResponsibleId },
      });

    describe('submitForValidation', () => {
      it('refuses a sortant courrier that is not a draft', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.ENVOYE),
        );

        await expect(
          service.submitForValidation('c-1', 'u-author'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(database.courrier.update).not.toHaveBeenCalled();
      });

      it('refuses an entrant courrier still awaiting transmission', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.RECU, CourrierDirection.ENTRANT),
        );

        await expect(
          service.submitForValidation('c-1', 'u-author'),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("waits on the dossier's responsible and tells them", async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.BROUILLON),
        );
        responsible('u-chef');

        await service.submitForValidation('c-1', 'u-author');

        expect(database.courrier.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { status: CourrierStatus.EN_ATTENTE_VALIDATION },
          }),
        );
        expect(notifications.create).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientIds: ['u-chef'],
            type: 'COURRIER_VALIDATION_PENDING',
          }),
        );
      });

      it("falls back to the site's responsible", async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.TRANSMIS, CourrierDirection.ENTRANT),
        );
        responsible(null, 'u-site');

        await service.submitForValidation('c-1', 'u-author');

        expect(notifications.create).toHaveBeenCalledWith(
          expect.objectContaining({ recipientIds: ['u-site'] }),
        );
      });

      it('refuses when nobody can validate', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.BROUILLON),
        );
        responsible(null, null);

        await expect(
          service.submitForValidation('c-1', 'u-author'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(database.courrier.update).not.toHaveBeenCalled();
      });
    });

    describe('validate / requestCorrections', () => {
      beforeEach(() => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.EN_ATTENTE_VALIDATION),
        );
        responsible('u-chef');
      });

      it('lets the validator validate, and records the decision', async () => {
        await service.validate('c-1', 'u-chef');

        expect(database.courrier.updateMany).toHaveBeenCalledWith({
          where: { id: 'c-1', status: CourrierStatus.EN_ATTENTE_VALIDATION },
          data: { status: CourrierStatus.VALIDE },
        });
        expect(database.validation.create).toHaveBeenCalledWith({
          data: {
            courrierId: 'c-1',
            validatorId: 'u-chef',
            decision: ValidationDecision.VALIDE,
            motif: undefined,
          },
        });
        expect(notifications.create).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientIds: ['u-author'],
            type: 'COURRIER_VALIDATED',
          }),
        );
      });

      it('sends it back for corrections with the motif', async () => {
        await service.requestCorrections(
          'c-1',
          'Signature manquante',
          'u-chef',
        );

        expect(database.courrier.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { status: CourrierStatus.A_CORRIGER },
          }),
        );
        expect(database.validation.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            decision: ValidationDecision.CORRECTIONS_DEMANDEES,
            motif: 'Signature manquante',
          }) as unknown,
        });
      });

      it('refuses anyone but the validator', async () => {
        await expect(
          service.validate('c-1', 'u-author'),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(database.courrier.updateMany).not.toHaveBeenCalled();
      });

      it('refuses a courrier that is not awaiting validation', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.BROUILLON),
        );

        await expect(service.validate('c-1', 'u-chef')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });

      it('refuses a second, concurrent decision', async () => {
        database.courrier.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.validate('c-1', 'u-chef')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(database.validation.create).not.toHaveBeenCalled();
      });
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
      rbac.hasGlobalPermission.mockResolvedValue(true);
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
