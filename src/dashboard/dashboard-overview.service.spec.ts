import {
  CourrierDirection,
  CourrierStatus,
} from '../../generated/prisma/client';
import {
  bucketsOf,
  computeAging,
  computeArbitration,
  computeKpis,
  computeMonthly,
  overviewWhere,
  OverviewRow,
  resolveWindows,
} from './dashboard-overview.service';

const NOW = new Date('2026-11-09T12:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

function row(overrides: Partial<OverviewRow>): OverviewRow {
  return {
    id: 'c-1',
    direction: CourrierDirection.ENTRANT,
    status: CourrierStatus.TRANSMIS,
    typeId: null,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    receivedAt: daysAgo(1),
    sentAt: null,
    transmittedAt: null,
    dispatchValidatedAt: null,
    submittedAt: null,
    approvedAt: null,
    signedAt: null,
    closedAt: null,
    archivedAt: null,
    cancelledAt: null,
    dueDate: null,
    type: null,
    project: null,
    contract: null,
    dossier: null,
    createdBy: null,
    ...overrides,
  };
}

const current = { from: daysAgo(10), to: NOW };
const previous = { from: daysAgo(20), to: daysAgo(10) };

describe('dashboard overview', () => {
  it('counts what was received and sent, against the previous period', () => {
    const { received, sent } = computeKpis(
      [
        row({ id: 'a', receivedAt: daysAgo(2) }),
        row({ id: 'b', receivedAt: daysAgo(15) }),
        row({
          id: 'c',
          direction: CourrierDirection.SORTANT,
          status: CourrierStatus.ENVOYE,
          createdAt: daysAgo(4),
          sentAt: daysAgo(3),
        }),
      ],
      [],
      current,
      previous,
    );

    expect(received).toMatchObject({ value: 1, previous: 1 });
    expect(sent).toMatchObject({ value: 1, previous: 0 });
    expect(received.series).toHaveLength(10);
  });

  it('measures on-time closures, a closure on the due day being on time', () => {
    const { onTimeRate, averageDelayDays } = computeKpis(
      [
        row({
          id: 'a',
          status: CourrierStatus.CLOTURE,
          receivedAt: daysAgo(6),
          dueDate: new Date('2026-11-05T00:00:00Z'),
          closedAt: new Date('2026-11-05T18:00:00Z'),
        }),
        row({
          id: 'b',
          status: CourrierStatus.CLOTURE,
          receivedAt: daysAgo(6),
          dueDate: new Date('2026-11-05T00:00:00Z'),
          closedAt: new Date('2026-11-07T12:00:00Z'),
        }),
      ],
      [],
      current,
      previous,
    );

    expect(onTimeRate.value).toBe(50);
    expect(averageDelayDays.value).toBeGreaterThan(0);
  });

  it('has no rate rather than 0% when there is nothing to measure', () => {
    const { onTimeRate, returnRate } = computeKpis(
      [row({})],
      [],
      current,
      previous,
    );

    expect(onTimeRate.value).toBeNull();
    expect(returnRate.value).toBeNull();
  });

  it('computes the return rate on the sortants sent back', () => {
    const sortant = (id: string) =>
      row({
        id,
        direction: CourrierDirection.SORTANT,
        status: CourrierStatus.EN_ATTENTE_VALIDATION,
        submittedAt: daysAgo(2),
      });

    const { returnRate } = computeKpis(
      [sortant('a'), sortant('b')],
      [{ entityId: 'a', createdAt: daysAgo(1) }],
      current,
      previous,
    );

    expect(returnRate.value).toBe(50);
  });

  it('counts a late effet only while it is still in progress', () => {
    const { late } = computeKpis(
      [
        row({ id: 'a', dueDate: daysAgo(3), receivedAt: daysAgo(9) }),
        row({
          id: 'b',
          status: CourrierStatus.CLOTURE,
          dueDate: daysAgo(3),
          receivedAt: daysAgo(9),
          closedAt: daysAgo(1),
        }),
      ],
      [],
      current,
      previous,
    );

    expect(late.value).toBe(1);
  });

  it('lists what needs arbitration', () => {
    expect(
      computeArbitration(
        [
          row({ id: 'a', status: CourrierStatus.RECU, receivedAt: daysAgo(3) }),
          row({ id: 'b', status: CourrierStatus.RECU, receivedAt: daysAgo(1) }),
          row({ id: 'c', dueDate: daysAgo(6) }),
          row({
            id: 'd',
            direction: CourrierDirection.SORTANT,
            status: CourrierStatus.EN_ATTENTE_VALIDATION,
            contract: {
              id: 'k',
              title: 'K',
              responsibleId: 'u-1',
              project: null,
            },
          }),
          row({
            id: 'e',
            direction: CourrierDirection.SORTANT,
            status: CourrierStatus.EN_ATTENTE_VALIDATION,
            contract: {
              id: 'k',
              title: 'K',
              responsibleId: 'u-1',
              project: null,
            },
          }),
        ],
        NOW,
      ),
    ).toEqual({ dispatchOver2Days: 1, overdueOver5Days: 1, validators: 1 });
  });

  it('sorts what is still open by age', () => {
    expect(
      computeAging(
        [
          row({ id: 'a', receivedAt: daysAgo(1) }),
          row({ id: 'b', receivedAt: daysAgo(4) }),
          row({ id: 'c', receivedAt: daysAgo(30) }),
          row({
            id: 'd',
            status: CourrierStatus.CLOTURE,
            receivedAt: daysAgo(30),
          }),
        ],
        NOW,
      ).map((bucket) => bucket.count),
    ).toEqual([1, 1, 0, 1]);
  });

  it('gives the last six months, oldest first', () => {
    const monthly = computeMonthly([row({ receivedAt: daysAgo(1) })], NOW);

    expect(monthly.map((month) => month.month)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(monthly[5].incoming).toBe(1);
  });

  it('compares with the same dates a year earlier on request', () => {
    const { current: window, previous: compared } = resolveWindows(
      { siteId: 's-1', period: '7d', compare: 'lastYear' },
      NOW,
    );

    expect(compared.to.getUTCFullYear()).toBe(window.to.getUTCFullYear() - 1);
    expect(compared.to.getUTCMonth()).toBe(window.to.getUTCMonth());
  });

  it('includes the whole last day of a custom period', () => {
    const { current: window } = resolveWindows(
      {
        siteId: 's-1',
        period: 'custom',
        from: '2026-10-01',
        to: '2026-10-31',
      },
      NOW,
    );

    expect(window.to).toEqual(new Date('2026-11-01T00:00:00.000Z'));
  });

  it('cuts long periods into weeks', () => {
    expect(bucketsOf(current)).toHaveLength(10);
    expect(bucketsOf({ from: daysAgo(70), to: NOW })).toHaveLength(10);
  });

  it('always stays on the requested site, and HAUTE matches nothing', () => {
    const where = overviewWhere({ siteId: 's-1', priority: 'HAUTE' });

    expect(where.AND).toEqual([
      {
        OR: [
          { dossier: { siteId: 's-1' } },
          { dossierId: null, createdBy: { siteId: 's-1' } },
        ],
      },
      { id: { in: [] } },
    ]);
  });
});
