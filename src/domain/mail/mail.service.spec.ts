import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MailService, formatCourrier } from './mail.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import {
  CourrierDirection,
  CourrierStatus,
  ValidationDecision,
} from '../../../generated/prisma/client';
import { StorageService } from '../../storage/storage.service';
import { ActivityService } from '../../activity/activity.service';
import { SettingsService } from '../../administration/settings/settings.service';

// Global types, plus a type of site s-2.
const EFFET_TYPES: Record<string, Record<string, unknown>> = {
  't-courrier': {
    id: 't-courrier',
    name: 'Courrier',
    isPhysical: false,
    canListEffets: false,
    active: true,
    siteId: null,
  },
  't-bordereau': {
    id: 't-bordereau',
    name: 'Bordereau de transmission',
    isPhysical: false,
    canListEffets: true,
    active: true,
    siteId: null,
  },
  't-specimen': {
    id: 't-specimen',
    name: 'Matière / spécimen',
    isPhysical: true,
    canListEffets: false,
    active: true,
    siteId: null,
  },
  't-old': {
    id: 't-old',
    name: 'Ancien type',
    isPhysical: false,
    canListEffets: false,
    active: false,
    siteId: null,
  },
  't-site2': {
    id: 't-site2',
    name: 'Échantillon Akwa',
    isPhysical: true,
    canListEffets: false,
    active: true,
    siteId: 's-2',
  },
};

describe('MailService', () => {
  let service: MailService;
  let database: {
    courrier: Record<string, jest.Mock>;
    dossier: Record<string, jest.Mock>;
    project: Record<string, jest.Mock>;
    contract: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    document: Record<string, jest.Mock>;
    site: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    effetType: Record<string, jest.Mock>;
    canal: Record<string, jest.Mock>;
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let notifications: { create: jest.Mock };
  let rbac: Record<string, jest.Mock>;
  let storage: { upload: jest.Mock; delete: jest.Mock };

  // The site's settings (PA·8), as SettingsService.get gives them.
  let settings: Record<string, unknown> & {
    defaultTreatmentDays: number;
    outgoingReplyDays: number;
    dischargeExpectedDays: number;
    businessDaysOnly: boolean;
  };

  beforeEach(async () => {
    settings = {
      defaultTreatmentDays: 10,
      outgoingReplyDays: 15,
      dischargeExpectedDays: 8,
      businessDaysOnly: true,
    };
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
        groupBy: jest.fn().mockResolvedValue([]),
      },
      dossier: { findUnique: jest.fn(), updateMany: jest.fn() },
      project: { findUnique: jest.fn() },
      contract: { findUnique: jest.fn() },
      instruction: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      canal: { findUnique: jest.fn() },
      document: { create: jest.fn() },
      site: { findUnique: jest.fn() },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      validation: { create: jest.fn() },
      // The global "Courrier" type unless a test says otherwise.
      effetType: {
        findFirst: jest.fn().mockResolvedValue({ id: 't-courrier' }),
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve(EFFET_TYPES[where.id] ?? null),
          ),
      },
      // The yearly sequence of outgoing references.
      $queryRaw: jest.fn().mockResolvedValue([{ last: 7 }]),
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
      hasPermissionAtSite: jest.fn().mockResolvedValue(false),
      sitesWithPermission: jest.fn().mockResolvedValue([]),
      // Global grant by default: no site restriction.
      siteFilter: jest.fn().mockResolvedValue({}),
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ key: 'test-key' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: DatabaseService, useValue: database },
        { provide: NotificationsService, useValue: notifications },
        { provide: RbacService, useValue: rbac },
        { provide: StorageService, useValue: storage },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue('log-1') },
        },
        {
          provide: SettingsService,
          useValue: { get: jest.fn().mockResolvedValue(settings) },
        },
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
        .mockResolvedValueOnce(10) // toDispatch
        .mockResolvedValueOnce(5) // dispatchPending
        .mockResolvedValueOnce(3) // affected
        .mockResolvedValueOnce(8) // assigned
        .mockResolvedValueOnce(15) // inTreatment
        .mockResolvedValueOnce(4) // closed
        .mockResolvedValueOnce(9) // metrics.archived
        .mockResolvedValueOnce(6) // metrics.others
        .mockResolvedValueOnce(20); // dispatched
    });

    it('returns the page plus unfiltered metrics in one payload', async () => {
      const result = await service.findIncoming({ skip: 0, take: 20 }, 'u-1');

      expect(result).toEqual({
        data: [{ id: 'c-1', instructionsProgress: { done: 0, total: 0 } }],
        total: 1,
        skip: 0,
        take: 20,
        metrics: {
          total: 57,
          all: 57,
          archived: 9,
          toDispatch: 10,
          dispatchPending: 5,
          affected: 3,
          assigned: 8,
          inTreatment: 15,
          closed: 4,
          aDispatcher: 10,
          dispatchingAValider: 5,
          affectes: 8,
          enTraitement: 15,
          clotures: 4,
          others: 6,
          byTab: {
            all: 57,
            toDispatch: 10,
            dispatchPending: 5,
            affected: 3,
            assigned: 8,
            inTreatment: 15,
            closed: 4,
            archived: 9,
            others: 6,
            dispatched: 20,
          },
        },
      });
    });

    it('filters by tab (e.g. toDispatch)', async () => {
      await service.findIncoming({ tab: 'toDispatch' }, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      const tabFilter = where.AND.find((f: any) => f?.status?.in);
      expect(tabFilter.status.in).toEqual([
        CourrierStatus.RECU,
        CourrierStatus.ENREGISTRE,
      ]);
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
      // Whoever it is entrusted to sees it, wherever it sits.
      expect(where.OR).toContainEqual({ ownerId: 'u-1' });
      expect(where.OR).toContainEqual({ supervisorId: 'u-1' });
      // Entrants still waiting for their dossier: on the registrant's site.
      expect(where.OR).toContainEqual({
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
      database.courrier.findMany.mockResolvedValue([
        { id: 's-1', dossierId: null, createdById: 'u-1' },
      ]);
      database.courrier.count.mockResolvedValue(1);
      const counted = {
        BROUILLON: 3,
        EN_ATTENTE_VALIDATION: 1,
        A_CORRIGER: 2,
        VALIDE: 1,
        ENVOYE: 2,
        ANNULE: 1,
        ARCHIVE: 4,
      };
      database.courrier.groupBy.mockResolvedValue(
        Object.entries(counted).map(([status, n]) => ({
          status,
          _count: { _all: n },
        })),
      );
      // Its approver: its registrant's site's responsible.
      database.user.findUnique.mockResolvedValue({
        site: { responsibleId: 'u-chef' },
      });
      database.user.findMany.mockResolvedValue([
        { id: 'u-chef', name: 'Chef' },
      ]);
    });

    it('returns one tab of rows, with their approver, plus every tab count', async () => {
      const result = await service.findOutgoing(
        { group: 'pending', skip: 0, take: 20 },
        'u-1',
      );

      expect(result).toEqual({
        data: [
          {
            id: 's-1',
            dossierId: null,
            createdById: 'u-1',
            instructionsProgress: { done: 0, total: 0 },
            approver: { id: 'u-chef', name: 'Chef' },
          },
        ],
        total: 1,
        skip: 0,
        take: 20,
        metrics: {
          pending: 4,
          approved: 3,
          rejected: 3,
          total: 14,
          byTab: {
            all: 14,
            drafts: 3,
            submitted: 1,
            corrections: 2,
            authorized: 3,
            cancelled: 1,
            archived: 4,
          },
        },
      });
    });

    it('filters by person in charge, without touching the tab counts', async () => {
      await service.findOutgoing(
        { group: 'pending', ownerId: 'owner-1' },
        'u-1',
      );

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.ownerId).toBe('owner-1');
      expect(
        database.courrier.groupBy.mock.calls[0][0].where,
      ).not.toHaveProperty('ownerId');
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
            CourrierStatus.SIGNE,
            CourrierStatus.PRET_A_ENVOYER,
            CourrierStatus.ENVOYE,
            CourrierStatus.DECHARGE,
          ],
        },
      });
      // Tab counts ignore the selected tab and other filters.
      expect(database.courrier.groupBy.mock.calls[0][0].where).toEqual({
        direction: CourrierDirection.SORTANT,
        OR: where.OR,
      });
    });

    it('filters the registration date, including the whole "to" day', async () => {
      await service.findOutgoing({ createdTo: '2026-09-30' }, 'u-1');

      const { where } = database.courrier.findMany.mock.calls[0][0];
      expect(where.createdAt).toEqual({ lt: new Date('2026-10-01') });
      expect(where.AND).toEqual([]);
    });
  });

  describe('default deadlines (PA·8)', () => {
    beforeEach(() => {
      database.courrier.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'c-1', ...data }),
      );
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
    });

    it("gives an entrant its site's treatment delay from its reception", async () => {
      settings.defaultTreatmentDays = 10;
      settings.businessDaysOnly = true;

      await service.create(
        {
          direction: CourrierDirection.ENTRANT,
          subject: 'Demande',
          // A Friday: 10 business days later is the Friday two weeks on.
          receivedAt: '2026-11-06T10:00:00.000Z',
        },
        'u-agent',
      );

      expect(database.courrier.create.mock.calls[0][0].data.dueDate).toEqual(
        new Date('2026-11-20'),
      );
    });

    it('keeps a deadline given at registration', async () => {
      await service.create(
        {
          direction: CourrierDirection.ENTRANT,
          subject: 'Demande',
          dueDate: '2026-12-01',
        },
        'u-agent',
      );

      expect(database.courrier.create.mock.calls[0][0].data.dueDate).toEqual(
        new Date('2026-12-01'),
      );
    });

    it("gives a sortant draft its site's reply delay", async () => {
      settings.outgoingReplyDays = 15;
      settings.businessDaysOnly = false;

      await service.createOutgoingDraft({ subject: 'Réponse' }, 'u-author');

      const { dueDate } = database.courrier.create.mock.calls[0][0].data;
      expect(dueDate).toBeInstanceOf(Date);
      const days = Math.round(
        ((dueDate as Date).getTime() - Date.now()) / (24 * 3600 * 1000),
      );
      expect(days).toBeGreaterThanOrEqual(14);
      expect(days).toBeLessThanOrEqual(15);
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

    it('is received the day it is registered when no date is given', async () => {
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });

      await service.create(ENTRANT, 'u-agent');

      expect(
        database.courrier.create.mock.calls[0][0].data.receivedAt,
      ).toBeInstanceOf(Date);
    });

    it("takes its dossier's project and contract", async () => {
      // Open, on an active site, in project p-1 under contract ct-1.
      database.dossier.findUnique.mockResolvedValue({
        number: 'D-1',
        status: 'IN_PROGRESS',
        siteId: 's-1',
        projectId: 'p-1',
        contractId: 'ct-1',
      });
      database.site.findUnique.mockResolvedValue({
        name: 'Site',
        status: 'ACTIVE',
      });

      await service.create({ ...ENTRANT, dossierId: 'd-1' }, 'u-agent');

      expect(database.courrier.create.mock.calls[0][0].data).toMatchObject({
        dossierId: 'd-1',
        projectId: 'p-1',
        contractId: 'ct-1',
      });
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
    // An entrant registered without its dossier yet; d-1's responsible is
    // u-chef.
    const entrant = (overrides: Record<string, unknown> = {}) => ({
      id: 'c-1',
      subject: 'Demande du maître d’ouvrage',
      direction: CourrierDirection.ENTRANT,
      status: CourrierStatus.RECU,
      dossierId: 'd-1',
      createdById: 'u-agent',
      ...overrides,
    });

    beforeEach(() => {
      // One fixture for both lookups: the open-dossier check and the
      // responsible to notify.
      database.dossier.findUnique.mockResolvedValue({
        number: 'D-1',
        status: 'OPEN',
        siteId: 's-1',
        responsibleId: 'u-chef',
        site: { responsibleId: 'u-site' },
      });
      database.site.findUnique.mockResolvedValue({
        name: 'Cristal',
        status: 'ACTIVE',
      });
    });

    it('refuses an entrant not yet attached to its dossier', async () => {
      database.courrier.findUnique.mockResolvedValue(
        entrant({ dossierId: null }),
      );

      await expect(service.transmit('c-1', 'u-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.courrier.update).not.toHaveBeenCalled();
    });

    it("transmits it and tells the dossier's responsible", async () => {
      database.courrier.findUnique.mockResolvedValue(entrant());

      await service.transmit('c-1', 'u-agent');

      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: CourrierStatus.TRANSMIS,
            transmittedAt: expect.any(Date) as Date,
            transmittedById: 'u-agent',
          },
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientIds: ['u-chef'],
          type: 'COURRIER_TRANSMITTED',
          courrierId: 'c-1',
        }),
      );
    });

    it("tells the site's responsible when the dossier has none", async () => {
      database.courrier.findUnique.mockResolvedValue(entrant());
      database.dossier.findUnique.mockResolvedValue({
        responsibleId: null,
        site: { responsibleId: 'u-site' },
      });

      await service.transmit('c-1', 'u-agent');

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ recipientIds: ['u-site'] }),
      );
    });

    it('refuses a sortant', async () => {
      database.courrier.findUnique.mockResolvedValue(
        entrant({ direction: CourrierDirection.SORTANT }),
      );

      await expect(service.transmit('c-1', 'u-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('transmits an effet affected to a contract to its designated responsible', async () => {
      database.courrier.findUnique.mockResolvedValue(
        entrant({
          status: CourrierStatus.AFFECTE,
          dossierId: null,
          contractId: 'ct-1',
          ownerId: 'u-ct-resp',
        }),
      );

      await service.transmit('c-1', 'u-agent');

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientIds: ['u-ct-resp'],
          type: 'COURRIER_TRANSMITTED',
        }),
      );
    });

    it('refuses an effet already transmitted', async () => {
      database.courrier.findUnique.mockResolvedValue(
        entrant({ status: CourrierStatus.TRANSMIS }),
      );

      await expect(service.transmit('c-1', 'u-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    describe('in the same request ("Voulez-vous transmettre ?")', () => {
      beforeEach(() => {
        database.courrier.create.mockImplementation(({ data }) =>
          Promise.resolve({ id: 'c-1', ...data }),
        );
      });

      it('registers and transmits an entrant with its dossier', async () => {
        database.courrier.findUnique.mockResolvedValue(entrant());

        await service.create(
          {
            direction: CourrierDirection.ENTRANT,
            subject: 'Demande du maître d’ouvrage',
            dossierId: 'd-1',
            transmit: true,
          },
          'u-agent',
        );

        // `transmit` is a request flag, not a column.
        expect(
          database.courrier.create.mock.calls[0][0].data,
        ).not.toHaveProperty('transmit');
        expect(database.courrier.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: CourrierStatus.TRANSMIS,
            }) as unknown,
          }),
        );
        expect(notifications.create).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'COURRIER_TRANSMITTED' }),
        );
      });

      it('refuses before registering anything when there is no dossier', async () => {
        await expect(
          service.create(
            {
              direction: CourrierDirection.ENTRANT,
              subject: 'Demande',
              transmit: true,
            },
            'u-agent',
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(database.courrier.create).not.toHaveBeenCalled();
      });

      it('just registers when transmit is false', async () => {
        database.user.findUnique.mockResolvedValue({ siteId: 's-1' });

        await service.create(
          {
            direction: CourrierDirection.ENTRANT,
            subject: 'Demande',
            transmit: false,
          },
          'u-agent',
        );

        expect(database.courrier.update).not.toHaveBeenCalled();
        expect(notifications.create).not.toHaveBeenCalled();
      });

      it('attaches the dossier and transmits in one update', async () => {
        // Read before the update, then once attached.
        database.courrier.findUnique
          .mockResolvedValueOnce(entrant({ dossierId: null }))
          .mockResolvedValue(entrant());
        database.courrier.update.mockResolvedValue(entrant());

        await service.update(
          'c-1',
          { dossierId: 'd-1', transmit: true },
          'u-dispatch',
        );

        const calls = database.courrier.update.mock.calls.map(
          ([arg]) => (arg as { data: Record<string, unknown> }).data,
        );
        expect(calls[0]).toMatchObject({ dossierId: 'd-1' });
        expect(calls[0]).not.toHaveProperty('transmit');
        expect(calls).toContainEqual({
          status: CourrierStatus.TRANSMIS,
          transmittedAt: expect.any(Date) as Date,
          transmittedById: 'u-dispatch',
        });
      });

      it('refuses before writing when it was already transmitted', async () => {
        database.courrier.findUnique.mockResolvedValue(
          entrant({ status: CourrierStatus.TRANSMIS }),
        );

        await expect(
          service.update('c-1', { transmit: true }, 'u-dispatch'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(database.courrier.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('effet types', () => {
    // An entrant registered on site s-1, without its dossier.
    const ENTRANT = {
      direction: CourrierDirection.ENTRANT,
      subject: 'Échantillons du chantier',
    };
    const created = () =>
      database.courrier.create.mock.calls[0][0].data as Record<string, unknown>;

    beforeEach(() => {
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
      database.courrier.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'c-new', ...data }),
      );
    });

    it('gives the "Courrier" type when none is chosen', async () => {
      await service.create(ENTRANT, 'u-agent');

      expect(created().typeId).toBe('t-courrier');
    });

    it('records the physical fields of a physical effet', async () => {
      await service.create(
        {
          ...ENTRANT,
          typeId: 't-specimen',
          quantity: 3,
          physicalDescription: '3 carottes de béton',
          storageLocation: 'Armoire B2',
          returnExpected: true,
        },
        'u-agent',
      );

      expect(created()).toMatchObject({
        typeId: 't-specimen',
        quantity: 3,
        storageLocation: 'Armoire B2',
        returnExpected: true,
      });
    });

    it('refuses physical fields on an effet that is not physical', async () => {
      await expect(
        service.create({ ...ENTRANT, quantity: 3 }, 'u-agent'),
      ).rejects.toThrow(/quantity can only be recorded on a physical effet/);
      expect(database.courrier.create).not.toHaveBeenCalled();
    });

    it('refuses an inactive type for a new effet', async () => {
      await expect(
        service.create({ ...ENTRANT, typeId: 't-old' }, 'u-agent'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses another site's type", async () => {
      await expect(
        service.create({ ...ENTRANT, typeId: 't-site2' }, 'u-agent'),
      ).rejects.toThrow(/belongs to another site/);
    });

    describe('bordereau', () => {
      const bordereau = (overrides: Record<string, unknown> = {}) => ({
        direction: CourrierDirection.ENTRANT,
        parentId: null,
        type: { canListEffets: true },
        ...overrides,
      });

      it('lists an effet that came with it', async () => {
        database.courrier.findUnique.mockResolvedValue(bordereau());

        await service.create({ ...ENTRANT, parentId: 'c-bord' }, 'u-agent');

        expect(created().parentId).toBe('c-bord');
      });

      it.each([
        [
          'an effet that is not a bordereau',
          { type: { canListEffets: false } },
        ],
        [
          'an effet going the other way',
          { direction: CourrierDirection.SORTANT },
        ],
      ])('refuses %s as parent', async (_label, overrides) => {
        database.courrier.findUnique.mockResolvedValue(bordereau(overrides));

        await expect(
          service.create({ ...ENTRANT, parentId: 'c-bord' }, 'u-agent'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(database.courrier.create).not.toHaveBeenCalled();
      });

      it('refuses a bordereau inside a bordereau', async () => {
        database.courrier.findUnique.mockResolvedValue(bordereau());

        await expect(
          service.create(
            { ...ENTRANT, typeId: 't-bordereau', parentId: 'c-bord' },
            'u-agent',
          ),
        ).rejects.toThrow(/cannot be listed in another bordereau/);
      });
    });

    describe('return', () => {
      it('records the return of an effet expected back', async () => {
        database.courrier.findUnique.mockResolvedValue({
          id: 'c-1',
          returnExpected: true,
          returnedAt: null,
        });

        await service.markReturned('c-1');

        expect(database.courrier.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { returnedAt: expect.any(Date) as unknown },
          }),
        );
      });

      it.each([
        ['not expected back', { returnExpected: false, returnedAt: null }],
        ['already returned', { returnExpected: true, returnedAt: new Date() }],
      ])('refuses an effet %s', async (_label, state) => {
        database.courrier.findUnique.mockResolvedValue({ id: 'c-1', ...state });

        await expect(service.markReturned('c-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(database.courrier.update).not.toHaveBeenCalled();
      });
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

      await service.update('c-1', { dossierId: 'd-1' }, 'u-1');

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
        service.update('c-1', { dossierId: 'd-1' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.courrier.update).not.toHaveBeenCalled();
    });

    it('leaves the dossier alone when it is not changed', async () => {
      database.courrier.findUnique.mockResolvedValue(draft);
      database.courrier.update.mockResolvedValue(draft);

      await service.update('c-1', { subject: 'Nouveau sujet' }, 'u-1');

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

    describe('cancel / archive / unarchive', () => {
      it('refuses to cancel a sortant without its reason', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.BROUILLON),
        );

        await expect(service.cancel('c-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(database.courrier.update).not.toHaveBeenCalled();
      });

      it('cancels a sortant with its reason', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.A_CORRIGER),
        );

        await service.cancel('c-1', 'Le client a retiré sa demande');

        expect(database.courrier.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              status: CourrierStatus.ANNULE,
              cancelledAt: expect.any(Date) as Date,
              cancellationReason: 'Le client a retiré sa demande',
            },
          }),
        );
      });

      it('archives a discharged sortant, keeping the status it leaves', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.DECHARGE),
        );

        await service.archive('c-1', 'Dossier soldé');

        expect(database.courrier.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              status: CourrierStatus.ARCHIVE,
              archivedAt: expect.any(Date) as Date,
              archiveReason: 'Dossier soldé',
              archivedFromStatus: CourrierStatus.DECHARGE,
            },
          }),
        );
      });

      it('refuses to archive a sortant sent but not yet discharged', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.ENVOYE),
        );

        await expect(service.archive('c-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });

      it('refuses to archive a sortant still in its draft', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.BROUILLON),
        );

        await expect(service.archive('c-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });

      it('gives an unarchived effet back its earlier status', async () => {
        database.courrier.findUnique.mockResolvedValue({
          ...courrier(CourrierStatus.ARCHIVE),
          archivedFromStatus: CourrierStatus.ANNULE,
        });

        await service.unarchive('c-1');

        expect(database.courrier.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              status: CourrierStatus.ANNULE,
              archivedAt: null,
              archiveReason: null,
              archivedFromStatus: null,
            },
          }),
        );
      });
    });

    describe('sign / send / discharge', () => {
      const scan = {
        originalname: 'signe.pdf',
        mimetype: 'application/pdf',
        size: 12,
        buffer: Buffer.from('%PDF-1.4'),
      } as Express.Multer.File;

      beforeEach(() => {
        database.document.create.mockResolvedValue({ id: 'doc-1' });
        database.courrier.findUniqueOrThrow.mockResolvedValue({
          id: 'c-1',
          bordereauNumber: `BT-${new Date().getFullYear()}-000007`,
        });
      });

      it('signs an approved sortant with its scan, its signatory and its date', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.VALIDE),
        );
        database.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });

        await service.sign(
          'c-1',
          { signatoryId: 'u-dg', signedAt: '2026-11-02' },
          scan,
          'u-secretary',
        );

        expect(database.document.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            courrierId: 'c-1',
            storageKey: 'test-key',
          }) as unknown,
        });
        expect(database.courrier.updateMany).toHaveBeenCalledWith({
          where: { id: 'c-1', status: CourrierStatus.VALIDE },
          data: {
            status: CourrierStatus.SIGNE,
            signedAt: new Date('2026-11-02'),
            signedById: 'u-dg',
            signedDocumentId: 'doc-1',
          },
        });
      });

      it('refuses to sign without the scan', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.VALIDE),
        );

        await expect(
          service.sign(
            'c-1',
            { signatoryId: 'u-dg', signedAt: '2026-11-02' },
            undefined,
            'u-secretary',
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('removes the stored scan when the effet changed meanwhile', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.VALIDE),
        );
        database.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
        database.courrier.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.sign(
            'c-1',
            { signatoryId: 'u-dg', signedAt: '2026-11-02' },
            scan,
            'u-secretary',
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(storage.delete).toHaveBeenCalledWith('test-key');
      });

      it('sends a signed sortant under the next bordereau number', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.SIGNE),
        );
        database.canal.findUnique.mockResolvedValue({
          name: 'Porteur',
          active: true,
        });

        await service.send(
          'c-1',
          {
            canalId: 'canal-1',
            recipient: 'M. Diallo',
            transmittedAt: '2026-11-03',
          },
          'u-secretary',
        );

        expect(database.courrier.updateMany).toHaveBeenCalledWith({
          where: { id: 'c-1', status: { in: expect.any(Array) as unknown } },
          data: {
            status: CourrierStatus.ENVOYE,
            bordereauNumber: `BT-${new Date().getFullYear()}-000007`,
            canalId: 'canal-1',
            transmissionMode: 'Porteur',
            transmissionRecipient: 'M. Diallo',
            transmittedAt: new Date('2026-11-03'),
            transmittedById: 'u-secretary',
            sentAt: new Date('2026-11-03'),
            // Tue 3 + 8 business days (PA·8).
            dischargeDueDate: new Date('2026-11-13'),
          },
        });
      });

      it('refuses to send a sortant not yet signed', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.VALIDE),
        );

        await expect(
          service.send(
            'c-1',
            {
              canalId: 'canal-1',
              recipient: 'M. Diallo',
              transmittedAt: '2026-11-03',
            },
            'u-secretary',
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('discharges a sent sortant with the discharged bordereau', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.ENVOYE),
        );

        await service.discharge(
          'c-1',
          'u-secretary',
          { receivedBy: 'Mme Ndiaye', dischargedAt: '2026-11-04' },
          scan,
        );

        expect(database.courrier.updateMany).toHaveBeenCalledWith({
          where: { id: 'c-1', status: CourrierStatus.ENVOYE },
          data: {
            status: CourrierStatus.DECHARGE,
            dischargedAt: new Date('2026-11-04'),
            dischargedById: 'u-secretary',
            dischargedStamp: true,
            dischargeReceivedBy: 'Mme Ndiaye',
            dischargeDocumentId: 'doc-1',
          },
        });
      });

      it('refuses to discharge a sortant without its bordereau', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.ENVOYE),
        );

        await expect(
          service.discharge('c-1', 'u-secretary', {
            receivedBy: 'Mme Ndiaye',
            dischargedAt: '2026-11-04',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('close', () => {
      it('closes an entrant with its note, cancelling its open instructions', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(CourrierStatus.EN_TRAITEMENT, CourrierDirection.ENTRANT),
        );
        database.instruction.updateMany.mockResolvedValue({ count: 2 });

        await service.close('c-1', { note: 'Réponse envoyée' });

        expect(database.instruction.updateMany).toHaveBeenCalledWith({
          where: {
            courrierId: 'c-1',
            status: { notIn: ['TERMINEE', 'ANNULEE'] },
          },
          data: { status: 'ANNULEE', cancellationReason: 'Effet clôturé' },
        });
        expect(database.courrier.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              status: CourrierStatus.CLOTURE,
              closedAt: expect.any(Date) as Date,
              closingNote: 'Réponse envoyée',
            },
          }),
        );
      });

      describe('who may close it', () => {
        const open = (over: Record<string, unknown> = {}) => ({
          ...courrier(CourrierStatus.EN_TRAITEMENT, CourrierDirection.ENTRANT),
          dossierId: null,
          createdById: 'u-agent',
          ownerId: 'u-owner',
          supervisorId: 'u-sup',
          ...over,
        });

        beforeEach(() => {
          database.instruction.updateMany.mockResolvedValue({ count: 0 });
          // The registrant's site, then its responsible.
          database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
          database.site.findUnique.mockResolvedValue({
            responsibleId: 'u-site',
          });
        });

        it('refuses an executant who merely sees it', async () => {
          database.courrier.findUnique.mockResolvedValue(open());

          await expect(
            service.close('c-1', {}, 'u-executant'),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(database.courrier.update).not.toHaveBeenCalled();
        });

        it.each([
          ['its designated responsible', 'u-owner'],
          ['its supervisor', 'u-sup'],
          ["its site's responsible", 'u-site'],
        ])('lets %s close it', async (_label, userId) => {
          database.courrier.findUnique.mockResolvedValue(open());

          await service.close('c-1', {}, userId);

          expect(database.courrier.update).toHaveBeenCalled();
        });

        it('lets a holder of COURRIER_CLOSE at its site close it', async () => {
          database.courrier.findUnique.mockResolvedValue(open());
          rbac.sitesWithPermission.mockResolvedValue(['s-1']);

          await service.close('c-1', {}, 'u-chef-courrier');

          expect(rbac.sitesWithPermission).toHaveBeenCalledWith(
            'u-chef-courrier',
            'COURRIER_CLOSE',
          );
          expect(database.courrier.update).toHaveBeenCalled();
        });

        it('refuses COURRIER_CLOSE held at another site', async () => {
          database.courrier.findUnique.mockResolvedValue(open());
          rbac.sitesWithPermission.mockResolvedValue(['s-2']);

          await expect(
            service.close('c-1', {}, 'u-other-site'),
          ).rejects.toBeInstanceOf(ForbiddenException);
        });
      });
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
            data: {
              status: CourrierStatus.EN_ATTENTE_VALIDATION,
              submittedAt: expect.any(Date) as Date,
            },
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
          data: {
            status: CourrierStatus.VALIDE,
            approvedAt: expect.any(Date) as Date,
            approvedById: 'u-chef',
          },
        });
        // An approved sortant gets the year's next outgoing reference.
        expect(database.courrier.update).toHaveBeenCalledWith({
          where: { id: 'c-1' },
          data: { reference: `SOR-${new Date().getFullYear()}-000007` },
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
        expect(database.$queryRaw).not.toHaveBeenCalled();
      });

      it('gives an approved entrant no outgoing reference', async () => {
        database.courrier.findUnique.mockResolvedValue(
          courrier(
            CourrierStatus.EN_ATTENTE_VALIDATION,
            CourrierDirection.ENTRANT,
          ),
        );

        await service.validate('c-1', 'u-chef');

        expect(database.$queryRaw).not.toHaveBeenCalled();
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

  describe('dispatch', () => {
    const mockCourrier = (
      status: CourrierStatus = CourrierStatus.RECU,
      instructions: unknown[] = [],
    ) => ({
      id: 'c-1',
      subject: 'Courrier entrant',
      direction: CourrierDirection.ENTRANT,
      status,
      instructions,
      dossier: null,
      createdById: 'u-creator',
    });

    it('rejects if neither or both contractId and dossierId are provided', async () => {
      await expect(
        service.dispatch('c-1', { projectId: 'p-1' } as any, 'u-user'),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.dispatch(
          'c-1',
          { projectId: 'p-1', contractId: 'ct-1', dossierId: 'd-1' },
          'u-user',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects if contract does not belong to project', async () => {
      database.project.findUnique.mockResolvedValue({
        siteId: 's-1',
        id: 'p-1',
        responsibleId: 'u-p-resp',
      });
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-1',
        projectId: 'p-other',
        responsibleId: 'u-ct-resp',
      });

      await expect(
        service.dispatch(
          'c-1',
          { projectId: 'p-1', contractId: 'ct-1' },
          'u-user',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('dispatches with permission straight to TRANSMIS and tells the contract responsible', async () => {
      database.project.findUnique.mockResolvedValue({
        siteId: 's-1',
        id: 'p-1',
        responsibleId: 'u-p-resp',
      });
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-1',
        projectId: 'p-1',
        responsibleId: 'u-ct-resp',
      });
      database.courrier.findUnique.mockResolvedValue(
        mockCourrier(CourrierStatus.RECU),
      );
      database.courrier.update.mockResolvedValue({
        id: 'c-1',
        subject: 'Effet',
        status: CourrierStatus.TRANSMIS,
        ownerId: 'u-ct-resp',
        dossierId: null,
        contractId: 'ct-1',
        createdById: 'u-creator',
      });
      // Dispatcher at the effet's site (its registrant's, s-1).
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
      rbac.hasPermissionAtSite.mockResolvedValue(true);

      const res = await service.dispatch(
        'c-1',
        { projectId: 'p-1', contractId: 'ct-1' },
        'u-dispatcher',
      );

      expect(res.status).toBe(CourrierStatus.TRANSMIS);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COURRIER_TRANSMITTED',
          recipientIds: ['u-ct-resp'],
        }),
      );
      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CourrierStatus.TRANSMIS,
            transmittedAt: expect.any(Date),
            transmittedById: 'u-dispatcher',
            ownerId: 'u-ct-resp',
            projectId: 'p-1',
            contractId: 'ct-1',
          }),
        }),
      );
    });

    it('stores proposal in EN_ATTENTE_TRANSMISSION when user lacks dispatch permission', async () => {
      database.project.findUnique.mockResolvedValue({
        siteId: 's-1',
        id: 'p-1',
        responsibleId: 'u-p-resp',
      });
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        projectId: 'p-1',
        responsibleId: 'u-d-resp',
        site: { responsibleId: 'u-s-resp' },
      });
      database.courrier.findUnique.mockResolvedValue(
        mockCourrier(CourrierStatus.ENREGISTRE),
      );
      database.courrier.update.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
        proposedProjectId: 'p-1',
        proposedDossierId: 'd-1',
      });
      rbac.hasPermission.mockResolvedValue(false);
      rbac.hasGlobalPermission.mockResolvedValue(false);

      const res = await service.dispatch(
        'c-1',
        { projectId: 'p-1', dossierId: 'd-1' },
        'u-agent',
      );

      expect(res.status).toBe(CourrierStatus.EN_ATTENTE_TRANSMISSION);
      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
            proposedProjectId: 'p-1',
            proposedDossierId: 'd-1',
            proposedById: 'u-agent',
          }),
        }),
      );
    });

    it('allows changing assignment on TRANSMIS when caller has permission and no instructions exist', async () => {
      database.project.findUnique.mockResolvedValue({
        siteId: 's-1',
        id: 'p-1',
        responsibleId: 'u-p-resp',
      });
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-2',
        projectId: 'p-1',
        responsibleId: 'u-new-owner',
      });
      database.courrier.findUnique.mockResolvedValue(
        mockCourrier(CourrierStatus.TRANSMIS, []),
      );
      database.courrier.update.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.TRANSMIS,
        ownerId: 'u-new-owner',
      });
      // Dispatcher at the effet's site (its registrant's, s-1).
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
      rbac.hasPermissionAtSite.mockResolvedValue(true);

      const res = await service.dispatch(
        'c-1',
        { projectId: 'p-1', contractId: 'ct-2' },
        'u-supervisor',
      );

      expect(res.ownerId).toBe('u-new-owner');
    });

    it('rejects changing assignment on TRANSMIS with 409 if instructions exist', async () => {
      database.project.findUnique.mockResolvedValue({
        siteId: 's-1',
        id: 'p-1',
        responsibleId: 'u-p-resp',
      });
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-2',
        projectId: 'p-1',
        responsibleId: 'u-new-owner',
      });
      database.courrier.findUnique.mockResolvedValue(
        mockCourrier(CourrierStatus.TRANSMIS, [{ id: 'ins-1' }]),
      );
      // Dispatcher at the effet's site (its registrant's, s-1).
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
      rbac.hasPermissionAtSite.mockResolvedValue(true);

      await expect(
        service.dispatch(
          'c-1',
          { projectId: 'p-1', contractId: 'ct-2' },
          'u-supervisor',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects changing assignment on TRANSMIS with 409 if caller lacks permission', async () => {
      database.project.findUnique.mockResolvedValue({
        siteId: 's-1',
        id: 'p-1',
        responsibleId: 'u-p-resp',
      });
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-2',
        projectId: 'p-1',
        responsibleId: 'u-new-owner',
      });
      database.courrier.findUnique.mockResolvedValue(
        mockCourrier(CourrierStatus.TRANSMIS, []),
      );
      rbac.hasPermission.mockResolvedValue(false);
      rbac.hasGlobalPermission.mockResolvedValue(false);

      await expect(
        service.dispatch(
          'c-1',
          { projectId: 'p-1', contractId: 'ct-2' },
          'u-agent',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('assignSupervisor', () => {
    it('assigns the supervisor and leaves the status alone', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        subject: 'Courrier',
        status: CourrierStatus.TRANSMIS,
        ownerId: 'u-owner',
        dossier: null,
      });
      database.user.findUnique.mockResolvedValue({
        id: 'u-sup',
        name: 'Superviseur',
        status: 'ACTIVE',
      });
      database.courrier.update.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.EN_TRAITEMENT,
        supervisorId: 'u-sup',
      });

      const res = await service.assignSupervisor(
        'c-1',
        { supervisorId: 'u-sup' },
        'u-owner',
      );

      expect(res.status).toBe(CourrierStatus.EN_TRAITEMENT);
      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            supervisorId: 'u-sup',
            supervisorDueDate: null,
            supervisorNote: null,
            dueReminderSentAt: null,
            overdueRemindedAt: null,
          },
        }),
      );
    });

    it('forbids non-owner, non-admin from assigning supervisor', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        ownerId: 'u-owner',
        dossier: null,
      });

      await expect(
        service.assignSupervisor(
          'c-1',
          { supervisorId: 'u-sup' },
          'u-intruder',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('persists dueDate and note when provided', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        subject: 'Courrier avec consigne',
        status: CourrierStatus.TRANSMIS,
        ownerId: 'u-owner',
        dossier: null,
      });
      database.user.findUnique.mockResolvedValue({
        id: 'u-sup',
        name: 'Superviseur',
        status: 'ACTIVE',
      });
      database.courrier.update.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.EN_TRAITEMENT,
        supervisorId: 'u-sup',
        supervisorDueDate: new Date('2026-11-20'),
        supervisorNote: 'Consigne urgente',
      });

      const res = await service.assignSupervisor(
        'c-1',
        {
          supervisorId: 'u-sup',
          dueDate: '2026-11-20',
          note: 'Consigne urgente',
        },
        'u-owner',
      );

      expect(res.status).toBe(CourrierStatus.EN_TRAITEMENT);
      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            supervisorId: 'u-sup',
            supervisorDueDate: new Date('2026-11-20'),
            supervisorNote: 'Consigne urgente',
            dueReminderSentAt: null,
            overdueRemindedAt: null,
          },
        }),
      );
      expect(res.supervisorDueDate).toEqual(new Date('2026-11-20'));
      expect(res.supervisorNote).toBe('Consigne urgente');
    });
  });

  describe('rights at the effet site', () => {
    it('refuses an inactive supervisor', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.TRANSMIS,
        ownerId: 'u-owner',
        dossier: null,
      });
      database.user.findUnique.mockResolvedValue({ status: 'SUSPENDED' });

      await expect(
        service.assignSupervisor('c-1', { supervisorId: 'u-sup' }, 'u-owner'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.courrier.update).not.toHaveBeenCalled();
    });

    it('a dispatcher of another site only proposes', async () => {
      database.project.findUnique.mockResolvedValue({
        id: 'p-1',
        siteId: 's-1',
      });
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-1',
        projectId: 'p-1',
        responsibleId: 'u-ct-resp',
      });
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.RECU,
        instructions: [],
        dossier: null,
        createdById: 'u-creator',
      });
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
      // COURRIER_DISPATCH somewhere, but not at s-1.
      rbac.hasPermission.mockResolvedValue(true);
      database.courrier.update.mockResolvedValue({ id: 'c-1' });

      await service.dispatch(
        'c-1',
        { projectId: 'p-1', contractId: 'ct-1' },
        'u-elsewhere',
      );

      expect(rbac.hasPermissionAtSite).toHaveBeenCalledWith(
        'u-elsewhere',
        'COURRIER_DISPATCH',
        's-1',
      );
      expect(database.courrier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
          }),
        }),
      );
    });

    it('hides the history of an effet the user may not see', async () => {
      database.courrier.findUnique.mockResolvedValue({
        direction: CourrierDirection.ENTRANT,
      });
      database.courrier.count.mockResolvedValue(0);

      await expect(service.historique('c-1', 'u-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('validateDispatch', () => {
    it('rejects if status is not EN_ATTENTE_TRANSMISSION', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.RECU,
      });

      await expect(
        service.validateDispatch('c-1', 'u-validator'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects if no proposedProjectId', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
        proposedProjectId: null,
      });

      await expect(
        service.validateDispatch('c-1', 'u-validator'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects if user is not authorized to validate dispatch', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
        proposedProjectId: 'p-1',
        proposedContractId: 'ct-1',
        dossierId: null,
        createdById: 'u-creator',
      });
      rbac.hasGlobalPermission.mockResolvedValue(false);
      rbac.hasPermission.mockResolvedValue(false);
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-1',
        responsibleId: 'u-other-resp',
        project: { responsibleId: 'u-proj-resp' },
      });

      await expect(
        service.validateDispatch('c-1', 'u-unauthorized'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('validates dispatch and sets owner to contract responsible', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        subject: 'Effet à valider',
        status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
        proposedProjectId: 'p-1',
        proposedContractId: 'ct-1',
        dossierId: null,
        createdById: 'u-creator',
      });
      // Dispatcher at the effet's site (its registrant's, s-1).
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
      rbac.hasPermissionAtSite.mockResolvedValue(true);
      database.contract.findUnique.mockResolvedValue({
        id: 'ct-1',
        responsibleId: 'u-ct-resp',
        project: { responsibleId: 'u-proj-resp' },
      });
      database.courrier.findUniqueOrThrow.mockResolvedValue({
        id: 'c-1',
        subject: 'Effet à valider',
        status: CourrierStatus.TRANSMIS,
        ownerId: 'u-ct-resp',
        dossierId: null,
        createdById: 'u-creator',
        projectId: 'p-1',
        contractId: 'ct-1',
        proposedProjectId: null,
        dispatchValidatedById: 'u-validator',
        dispatchValidatedAt: new Date(),
      });

      const res = await service.validateDispatch('c-1', 'u-validator');

      expect(res.status).toBe(CourrierStatus.TRANSMIS);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COURRIER_TRANSMITTED',
          recipientIds: ['u-ct-resp'],
        }),
      );
      expect(database.courrier.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c-1', status: CourrierStatus.EN_ATTENTE_TRANSMISSION },
          data: expect.objectContaining({
            status: CourrierStatus.TRANSMIS,
            transmittedAt: expect.any(Date),
            transmittedById: 'u-validator',
            ownerId: 'u-ct-resp',
            projectId: 'p-1',
            contractId: 'ct-1',
            proposedProjectId: null,
            dispatchValidatedById: 'u-validator',
          }),
        }),
      );
      expect(database.validation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            courrierId: 'c-1',
            validatorId: 'u-validator',
            decision: ValidationDecision.VALIDE,
          }),
        }),
      );
    });

    it('validates dispatch and marks dossier in progress when target is a dossier', async () => {
      database.courrier.findUnique.mockResolvedValue({
        id: 'c-1',
        subject: 'Effet avec dossier',
        status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
        proposedProjectId: 'p-1',
        proposedContractId: null,
        proposedDossierId: 'd-1',
        dossierId: null,
        createdById: 'u-creator',
      });
      // Dispatcher at the effet's site (its registrant's, s-1).
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
      rbac.hasPermissionAtSite.mockResolvedValue(true);
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        responsibleId: 'u-d-resp',
        contractId: 'ct-1',
        site: { responsibleId: 'u-s-resp' },
      });
      database.courrier.findUniqueOrThrow.mockResolvedValue({
        id: 'c-1',
        status: CourrierStatus.TRANSMIS,
        ownerId: 'u-d-resp',
        projectId: 'p-1',
        contractId: 'ct-1',
        dossierId: 'd-1',
      });

      const res = await service.validateDispatch('c-1', 'u-validator');

      expect(res.status).toBe(CourrierStatus.TRANSMIS);
      expect(database.dossier.updateMany).toHaveBeenCalled();
    });
  });

  describe('formatCourrier', () => {
    it('shapes dispatch and supervisor nested objects', () => {
      const raw = {
        id: 'c-1',
        subject: 'Test',
        proposedBy: { id: 'u-prop', name: 'Proposer', email: 'prop@test.com' },
        proposedAt: new Date('2026-10-30T10:00:00Z'),
        dispatchValidatedBy: {
          id: 'u-val',
          name: 'Validator',
          email: 'val@test.com',
        },
        dispatchValidatedAt: new Date('2026-10-30T11:00:00Z'),
        supervisor: { id: 'u-sup', name: 'Supervisor', email: 'sup@test.com' },
        supervisorDueDate: new Date('2026-11-01'),
        supervisorNote: 'A traiter en priorite',
      };

      const formatted = formatCourrier(raw);

      expect(formatted.dispatch).toEqual({
        proposedBy: { id: 'u-prop', name: 'Proposer' },
        proposedAt: new Date('2026-10-30T10:00:00Z'),
        validatedBy: { id: 'u-val', name: 'Validator' },
        validatedAt: new Date('2026-10-30T11:00:00Z'),
      });
      expect(formatted.supervisor).toEqual({
        id: 'u-sup',
        name: 'Supervisor',
        email: 'sup@test.com',
      });
      expect(formatted.dueDate).toEqual(new Date('2026-11-01'));
      expect(formatted.supervisorDueDate).toEqual(new Date('2026-11-01'));
      expect(formatted.supervisorNote).toBe('A traiter en priorite');
    });

    it('handles courrier with null dispatch validation and null supervisor', () => {
      const raw = {
        id: 'c-2',
        subject: 'Pending',
        proposedBy: { id: 'u-prop', name: 'Proposer' },
        proposedAt: new Date('2026-10-30T10:00:00Z'),
        dispatchValidatedBy: null,
        dispatchValidatedAt: null,
        supervisor: null,
        supervisorDueDate: null,
        supervisorNote: null,
      };

      const formatted = formatCourrier(raw);

      expect(formatted.dispatch).toEqual({
        proposedBy: { id: 'u-prop', name: 'Proposer' },
        proposedAt: new Date('2026-10-30T10:00:00Z'),
        validatedBy: null,
        validatedAt: null,
      });
      expect(formatted.supervisor).toBeNull();
      expect(formatted.dueDate).toBeNull();
      expect(formatted.supervisorDueDate).toBeNull();
      expect(formatted.supervisorNote).toBeNull();
    });
  });
});
