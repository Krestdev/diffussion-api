import { UserStatus } from '../generated/prisma/client';
import { deletedAtOf, upsertPerson } from '../core/directory-sync.service';
import {
  NAMED_KINDS,
  type ResponsibilityFacts,
  responsibilityItems,
} from './user-responsibilities';
import { UserResponsibilitiesService } from './user-responsibilities.service';

const NOW = new Date('2026-11-17T10:00:00.000Z');

const none = (): ResponsibilityFacts => ({
  dossiers: 0,
  contracts: 0,
  projects: 0,
  companyResponsible: false,
  instructions: { supervisor: 0, validator: 0, executant: 0 },
  incoming: 0,
  analysisSheets: 0,
  pending: [],
  delegations: [],
  now: NOW,
});

describe('responsibilityItems (C9)', () => {
  it('lists nothing when nothing blocks the deletion', () => {
    expect(responsibilityItems(none())).toEqual([]);
  });

  it('VALIDATOR: responsible of dossiers, contracts and the company', () => {
    expect(
      responsibilityItems({
        ...none(),
        dossiers: 2,
        contracts: 1,
        companyResponsible: true,
      }),
    ).toEqual([
      {
        kind: 'VALIDATOR',
        label:
          'Responsable de 2 dossiers ouverts (valide leurs effets sortants)',
        count: 2,
        href: '/dashboard/dossiers',
      },
      {
        kind: 'VALIDATOR',
        label: 'Responsable de 1 contrat actif (valide leurs effets sortants)',
        count: 1,
        href: '/dashboard/contracts',
      },
      {
        kind: 'VALIDATOR',
        label:
          'Responsable de la société (valide les effets sortants sans autre responsable)',
        count: 1,
      },
    ]);
  });

  it('VALIDATOR: supervisor and validator of open tasks, analysis sheets', () => {
    const items = responsibilityItems({
      ...none(),
      instructions: { supervisor: 3, validator: 1, executant: 0 },
      analysisSheets: 2,
    });
    expect(items.map((i) => [i.kind, i.label, i.count])).toEqual([
      [
        'VALIDATOR',
        'Superviseur de 3 tâches en cours (décide de leurs livrables)',
        3,
      ],
      [
        'VALIDATOR',
        'Validateur de 1 tâche en cours (donne son avis sur leurs livrables)',
        1,
      ],
      [
        'VALIDATOR',
        "Validateur nommé sur 2 fiches d'analyse en attente de décision",
        2,
      ],
    ]);
  });

  it('PENDING_ITEMS: the total of what waits for them by name, and its kinds', () => {
    const [item] = responsibilityItems({
      ...none(),
      pending: [
        { key: 'incomingToHandle', count: 2 },
        { key: 'outgoingToValidate', count: 1 },
        { key: 'tasksToDeliver', count: 0 },
      ],
    });
    expect(item).toEqual({
      kind: 'PENDING_ITEMS',
      label:
        '3 éléments à son nom en attente dans À traiter (2 effets entrants à traiter, 1 effet sortant à valider)',
      count: 3,
      href: '/dashboard/tasks',
    });
  });

  it('NAMED_KINDS: shared queues (dispatch, dispatch validation) never block (owner 2026-11-18)', () => {
    expect(NAMED_KINDS).not.toContain('incomingToDispatch');
    expect(NAMED_KINDS).not.toContain('dispatchToValidate');
    expect([...NAMED_KINDS].sort()).toEqual(
      [
        'incomingToHandle',
        'livrablesToReview',
        'outgoingToCorrect',
        'outgoingToDischarge',
        'outgoingToSend',
        'outgoingToValidate',
        'tasksToDeliver',
        'tasksToReassign',
        'tasksToSubscribe',
      ].sort(),
    );
  });

  it('DELEGATION: active as substitute, upcoming as holder', () => {
    const items = responsibilityItems({
      ...none(),
      delegations: [
        {
          side: 'HOLDER',
          other: 'Paul Eto',
          role: 'Dispatcheur',
          startsAt: new Date('2026-12-01T08:00:00.000Z'),
          endsAt: new Date('2026-12-15T08:00:00.000Z'),
        },
        {
          side: 'SUBSTITUTE',
          other: 'Marie Ngo',
          role: 'Responsable',
          startsAt: new Date('2026-11-10T08:00:00.000Z'),
          endsAt: new Date('2026-11-30T20:00:00.000Z'),
        },
      ],
    });
    expect(items.map((i) => [i.kind, i.label, i.count])).toEqual([
      [
        'DELEGATION',
        "Suppléant d'une délégation active jusqu'au 30/11/2026 (rôle Responsable, titulaire : Marie Ngo)",
        1,
      ],
      [
        'DELEGATION',
        "Titulaire d'une délégation à venir du 01/12/2026 au 15/12/2026 (rôle Dispatcheur, suppléant : Paul Eto)",
        1,
      ],
    ]);
  });

  it("OTHER: Diffusion's projects, executant, entrant effets in progress", () => {
    const items = responsibilityItems({
      ...none(),
      projects: 1,
      instructions: { supervisor: 0, validator: 0, executant: 2 },
      incoming: 4,
    });
    expect(items).toEqual([
      {
        kind: 'OTHER',
        label: 'Responsable de 1 projet ouvert de Diffusion',
        count: 1,
        href: '/dashboard/projects',
      },
      {
        kind: 'OTHER',
        label: 'Exécutant de 2 tâches en cours',
        count: 2,
        href: '/dashboard/tasks?tab=instructions',
      },
      {
        kind: 'OTHER',
        label: 'Superviseur ou responsable de 4 effets entrants en cours',
        count: 4,
        href: '/dashboard/incoming',
      },
    ]);
  });
});

describe('UserResponsibilitiesService (C9)', () => {
  const count = () => jest.fn().mockResolvedValue(0);
  const database = {
    user: { findUnique: jest.fn() },
    dossier: { count: count() },
    contract: { count: count() },
    project: { count: count() },
    company: { findUnique: jest.fn() },
    userInstructions: { count: count() },
    courrier: { count: count() },
    analysisSheet: { count: count() },
    delegation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const access = { computePermissions: jest.fn().mockResolvedValue([]) };
  const portal = { pendingItems: jest.fn().mockResolvedValue([]) };
  const service = new UserResponsibilitiesService(
    database as never,
    access as never,
    portal as never,
  );

  beforeEach(() => {
    database.company.findUnique.mockResolvedValue({ responsibleId: 'boss' });
  });

  it('an unknown person: nothing', async () => {
    database.user.findUnique.mockResolvedValue(null);
    await expect(service.of('c-1', 'missing')).resolves.toEqual({
      items: [],
    });
  });

  it('someone of another company: nothing', async () => {
    database.user.findUnique.mockResolvedValue({ id: 'u', companyId: 'c-2' });
    await expect(service.of('c-1', 'u')).resolves.toEqual({ items: [] });
  });

  it('nothing held: empty; their named work read strictly with their rights', async () => {
    database.user.findUnique.mockResolvedValue({ id: 'u', companyId: 'c-1' });
    access.computePermissions.mockResolvedValue(['incoming.dispatch']);
    await expect(service.of('c-1', 'u')).resolves.toEqual({ items: [] });
    expect(access.computePermissions).toHaveBeenCalledWith('u', 'c-1');
    const [person, strict, only] = portal.pendingItems.mock.calls[0] as [
      { sub: string; permissions: Set<string> },
      boolean,
      readonly string[],
    ];
    expect(person.sub).toBe('u');
    expect([...person.permissions]).toEqual(['incoming.dispatch']);
    expect(strict).toBe(true);
    // A dispatcher's queue is shared: not read for the deletion check.
    expect(only).toBe(NAMED_KINDS);
  });

  it('gathers what they hold', async () => {
    database.user.findUnique.mockResolvedValue({ id: 'u', companyId: 'c-1' });
    database.company.findUnique.mockResolvedValue({ responsibleId: 'u' });
    database.dossier.count.mockResolvedValue(2);
    portal.pendingItems.mockResolvedValue([
      { key: 'outgoingToValidate', count: 1 },
    ]);
    const { items } = await service.of('c-1', 'u');
    expect(items.map((i) => [i.kind, i.count])).toEqual([
      ['VALIDATOR', 2],
      ['VALIDATOR', 1],
      ['PENDING_ITEMS', 1],
    ]);
  });
});

describe('directory: deleted users (C9)', () => {
  it('reads deletedAt, tolerating an older core', () => {
    expect(deletedAtOf(undefined)).toBeNull();
    expect(deletedAtOf(null)).toBeNull();
    expect(deletedAtOf('nope')).toBeNull();
    expect(deletedAtOf('2026-11-17T09:00:00.000Z')).toEqual(
      new Date('2026-11-17T09:00:00.000Z'),
    );
  });

  const person = {
    id: 'u',
    email: 'u@example.com',
    firstName: 'Awa',
    lastName: 'Ndiaye',
    tenantAdmin: false,
  };
  const txWith = (status: UserStatus) => ({
    user: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(
            where.id === 'u' || !where.id
              ? { id: 'u', status, accessProfile: 'USER', lastLogin: null }
              : null,
          ),
        ),
      update: jest.fn(),
      create: jest.fn(),
    },
  });
  const updated = (tx: ReturnType<typeof txWith>) =>
    (tx.user.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0]
      .data;

  it('a deleted person is kept, suspended, with the date', async () => {
    const tx = txWith(UserStatus.ACTIVE);
    await upsertPerson(
      tx as never,
      'c-1',
      {
        ...person,
        status: 'DEACTIVATED',
        deletedAt: '2026-11-17T09:00:00.000Z',
      },
      NOW,
    );
    const data = updated(tx);
    expect(data.status).toBe(UserStatus.SUSPENDED);
    expect(data.deletedAt).toEqual(new Date('2026-11-17T09:00:00.000Z'));
    expect(data.name).toBe('Awa Ndiaye');
  });

  it('even listed ACTIVE, a deleted person is not active', async () => {
    const tx = txWith(UserStatus.SUSPENDED);
    await upsertPerson(
      tx as never,
      'c-1',
      { ...person, status: 'ACTIVE', deletedAt: '2026-11-17T09:00:00.000Z' },
      NOW,
    );
    expect(updated(tx).status).toBe(UserStatus.SUSPENDED);
  });

  it('restored (or an older core without the field): back to normal', async () => {
    const tx = txWith(UserStatus.SUSPENDED);
    await upsertPerson(
      tx as never,
      'c-1',
      { ...person, status: 'ACTIVE' },
      NOW,
    );
    const data = updated(tx);
    expect(data.status).toBe(UserStatus.ACTIVE);
    expect(data.deletedAt).toBeNull();
    expect(data.deactivatedAt).toBeNull();
  });
});
