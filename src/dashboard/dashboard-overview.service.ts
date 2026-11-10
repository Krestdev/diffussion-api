import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  DossierPriority,
  InstructionPriority,
  InstructionStatus,
  Prisma,
  SubscriptionDecision,
} from '../../generated/prisma/client';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RbacService } from '../auth/rbac/rbac.service';
import { assertSiteExists } from '../common/utils/site-referentials';
import { courrierOfSite, taskOfSite } from '../common/utils/site-where';
import { DatabaseService } from '../database/database.service';
import { overdueWhere } from '../instructions/instruction-overdue';
import { localToday, zonedMidnight } from './dashboard.service';
import {
  DashboardOverviewQueryDto,
  OverviewPriority,
} from './dto/dashboard-overview.query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = 'Africa/Douala';
const REPARTITION_ROWS = 20;

// No longer in progress — an entrant never reaches ENVOYE or DECHARGE, so
// one list serves both directions.
const TERMINAL: CourrierStatus[] = [
  CourrierStatus.CLOTURE,
  CourrierStatus.ARCHIVE,
  CourrierStatus.ANNULE,
  CourrierStatus.ENVOYE,
  CourrierStatus.DECHARGE,
];

const AWAITING_DISPATCH: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
  CourrierStatus.EN_ATTENTE_TRANSMISSION,
];

const AGING_BUCKETS = [
  { bucket: '0–2 j', max: 2 },
  { bucket: '3–5 j', max: 5 },
  { bucket: '6–10 j', max: 10 },
  { bucket: '+10 j', max: Infinity },
];

const projectName = { select: { id: true, name: true } };

const rowSelect = {
  id: true,
  direction: true,
  status: true,
  typeId: true,
  createdAt: true,
  updatedAt: true,
  receivedAt: true,
  sentAt: true,
  transmittedAt: true,
  proposedAt: true,
  dispatchValidatedAt: true,
  statusBeforeProjectClosure: true,
  submittedAt: true,
  approvedAt: true,
  signedAt: true,
  closedAt: true,
  archivedAt: true,
  cancelledAt: true,
  dueDate: true,
  type: { select: { id: true, name: true } },
  instructions: {
    where: { status: { not: InstructionStatus.ANNULEE } },
    select: {
      status: true,
      assignedAt: true,
      closedAt: true,
      subscriptions: {
        where: { decision: SubscriptionDecision.SOUSCRITE },
        select: { decidedAt: true },
      },
    },
  },
  project: { select: { id: true, name: true, responsibleId: true } },
  contract: {
    select: {
      id: true,
      title: true,
      responsibleId: true,
      project: { select: { id: true, name: true, responsibleId: true } },
    },
  },
  dossier: {
    select: {
      id: true,
      title: true,
      responsibleId: true,
      project: projectName,
      contract: { select: { responsibleId: true, project: projectName } },
      site: { select: { responsibleId: true } },
    },
  },
  createdBy: { select: { site: { select: { responsibleId: true } } } },
} satisfies Prisma.CourrierSelect;

export type OverviewRow = Prisma.CourrierGetPayload<{
  select: typeof rowSelect;
}>;

export type Window = { from: Date; to: Date };
type Correction = { entityId: string | null; createdAt: Date };

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function inWindow(date: Date | null | undefined, window: Window) {
  return !!date && date >= window.from && date < window.to;
}

function daysBetween(from: Date, to: Date) {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);
}

const isEntrant = (row: OverviewRow) =>
  row.direction === CourrierDirection.ENTRANT;

/** When its treatment starts: reception for an entrant, drafting for a sortant. */
function startOf(row: OverviewRow) {
  return isEntrant(row) ? (row.receivedAt ?? row.createdAt) : row.createdAt;
}

function sentOf(row: OverviewRow) {
  return isEntrant(row) ? null : (row.sentAt ?? row.transmittedAt);
}

/** Treated: an entrant closed, a sortant sent. */
function concludedAt(row: OverviewRow) {
  return isEntrant(row) ? row.closedAt : sentOf(row);
}

/** When it stopped being in progress, however that happened. */
function endedAt(row: OverviewRow) {
  return (
    concludedAt(row) ??
    row.archivedAt ??
    row.cancelledAt ??
    (TERMINAL.includes(row.status) ? row.updatedAt : null)
  );
}

function isOpen(row: OverviewRow) {
  return !TERMINAL.includes(row.status);
}

function isLateAt(row: OverviewRow, at: Date) {
  if (!row.dueDate || row.dueDate >= at || startOf(row) > at) return false;
  const ended = endedAt(row);
  return !ended || ended > at;
}

function concludedOnTime(row: OverviewRow) {
  const concluded = concludedAt(row);
  // Due on a day: any time that day is on time.
  return (
    !!concluded &&
    !!row.dueDate &&
    concluded.getTime() < row.dueDate.getTime() + DAY_MS
  );
}

function onTimeRate(rows: OverviewRow[], window: Window): number | null {
  const measured = rows.filter(
    (row) => row.dueDate && inWindow(concludedAt(row), window),
  );
  if (!measured.length) return null;
  return round1(
    (measured.filter(concludedOnTime).length / measured.length) * 100,
  );
}

function averageDelay(rows: OverviewRow[], window: Window): number | null {
  const delays = rows.flatMap((row) => {
    const concluded = concludedAt(row);
    return inWindow(concluded, window)
      ? [daysBetween(startOf(row), concluded!)]
      : [];
  });
  const average = mean(delays);
  return average === null ? null : round1(average);
}

// Sortants sent back for correction, among those submitted or sent back in
// the window.
function returnRate(
  rows: OverviewRow[],
  corrections: Correction[],
  window: Window,
): number | null {
  const sortants = new Set(
    rows.filter((row) => !isEntrant(row)).map((row) => row.id),
  );
  const returned = new Set(
    corrections
      .filter(
        (correction) =>
          inWindow(correction.createdAt, window) &&
          correction.entityId !== null &&
          sortants.has(correction.entityId),
      )
      .map((correction) => correction.entityId as string),
  );
  const submitted = new Set([
    ...returned,
    ...rows
      .filter((row) => !isEntrant(row) && inWindow(row.submittedAt, window))
      .map((row) => row.id),
  ]);
  return submitted.size ? round1((returned.size / submitted.size) * 100) : null;
}

const countReceived = (rows: OverviewRow[], window: Window) =>
  rows.filter((row) => isEntrant(row) && inWindow(startOf(row), window)).length;

const countSent = (rows: OverviewRow[], window: Window) =>
  rows.filter((row) => inWindow(sentOf(row), window)).length;

const countLate = (rows: OverviewRow[], at: Date) =>
  rows.filter((row) => isLateAt(row, at)).length;

// Daily up to a month, weekly up to a year, monthly (30 days) beyond.
export function bucketsOf(window: Window): Window[] {
  const span = window.to.getTime() - window.from.getTime();
  const size =
    span <= 32 * DAY_MS
      ? DAY_MS
      : span <= 370 * DAY_MS
        ? 7 * DAY_MS
        : 30 * DAY_MS;
  const buckets: Window[] = [];
  for (let at = window.from.getTime(); at < window.to.getTime(); at += size) {
    buckets.push({
      from: new Date(at),
      to: new Date(Math.min(at + size, window.to.getTime())),
    });
  }
  return buckets;
}

function kpi(
  value: number | null,
  previous: number | null,
  series: (number | null)[],
) {
  const known = series.filter((point) => point !== null);
  const average = mean(known);
  return {
    value,
    previous,
    series: series.map((point) => point ?? 0),
    ...(average !== null ? { average: round1(average) } : {}),
  };
}

export function computeKpis(
  rows: OverviewRow[],
  corrections: Correction[],
  current: Window,
  previous: Window,
) {
  const buckets = bucketsOf(current);
  const build = (measure: (window: Window) => number | null) =>
    kpi(measure(current), measure(previous), buckets.map(measure));
  return {
    received: build((window) => countReceived(rows, window)),
    sent: build((window) => countSent(rows, window)),
    onTimeRate: build((window) => onTimeRate(rows, window)),
    averageDelayDays: build((window) => averageDelay(rows, window)),
    late: build((window) => countLate(rows, window.to)),
    returnRate: build((window) => returnRate(rows, corrections, window)),
  };
}

// The site responsible is the last resort: same order as
// MailService.validatorOf.
function validatorOf(row: OverviewRow) {
  if (row.dossier) {
    return (
      row.dossier.responsibleId ??
      row.dossier.contract?.responsibleId ??
      row.dossier.site.responsibleId
    );
  }
  return (
    row.contract?.responsibleId ??
    row.contract?.project?.responsibleId ??
    row.project?.responsibleId ??
    row.createdBy?.site?.responsibleId ??
    null
  );
}

export function computeArbitration(rows: OverviewRow[], now: Date) {
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);
  const fiveDaysAgo = new Date(now.getTime() - 5 * DAY_MS);
  const validators = new Set(
    rows
      .filter((row) => row.status === CourrierStatus.EN_ATTENTE_VALIDATION)
      .map(validatorOf)
      .filter((id) => id !== null),
  );
  return {
    dispatchOver2Days: rows.filter(
      (row) =>
        isEntrant(row) &&
        AWAITING_DISPATCH.includes(row.status) &&
        startOf(row) < twoDaysAgo,
    ).length,
    overdueOver5Days: rows.filter(
      (row) => isOpen(row) && !!row.dueDate && row.dueDate < fiveDaysAgo,
    ).length,
    validators: validators.size,
  };
}

export function computeAging(rows: OverviewRow[], now: Date) {
  const counts = AGING_BUCKETS.map(() => 0);
  for (const row of rows.filter(isOpen)) {
    const age = Math.floor(daysBetween(startOf(row), now));
    counts[AGING_BUCKETS.findIndex((bucket) => age <= bucket.max)]++;
  }
  return AGING_BUCKETS.map(({ bucket }, index) => ({
    bucket,
    count: counts[index],
  }));
}

function earliest(dates: (Date | null)[]) {
  const times = dates.flatMap((date) => (date ? [date.getTime()] : []));
  return times.length ? new Date(Math.min(...times)) : null;
}

function firstAssignedAt(row: OverviewRow) {
  return earliest(row.instructions.map((task) => task.assignedAt));
}

function firstSubscribedAt(row: OverviewRow) {
  return earliest(
    row.instructions.flatMap((task) =>
      task.subscriptions.map((subscription) => subscription.decidedAt),
    ),
  );
}

/** When its last task was validated, once every one of them is. */
function validatedAt(row: OverviewRow) {
  const tasks = row.instructions;
  if (
    !tasks.length ||
    tasks.some((task) => task.status !== InstructionStatus.TERMINEE)
  ) {
    return null;
  }
  const times = tasks.flatMap((task) =>
    task.closedAt ? [task.closedAt.getTime()] : [],
  );
  return times.length ? new Date(Math.max(...times)) : null;
}

const STEPS: {
  step: string;
  direction: CourrierDirection;
  from: (row: OverviewRow) => Date | null;
  to: (row: OverviewRow) => Date | null;
}[] = [
  {
    step: 'Réception → dispatching',
    direction: CourrierDirection.ENTRANT,
    from: startOf,
    to: (row) => row.proposedAt ?? row.dispatchValidatedAt,
  },
  {
    step: 'Dispatch → transmission',
    direction: CourrierDirection.ENTRANT,
    from: (row) => row.proposedAt ?? row.dispatchValidatedAt,
    to: (row) => row.transmittedAt,
  },
  {
    step: 'Transmission → affectation',
    direction: CourrierDirection.ENTRANT,
    from: (row) => row.transmittedAt,
    to: firstAssignedAt,
  },
  {
    step: 'Affectation → souscription',
    direction: CourrierDirection.ENTRANT,
    from: firstAssignedAt,
    to: firstSubscribedAt,
  },
  {
    step: 'Souscription → validation',
    direction: CourrierDirection.ENTRANT,
    from: firstSubscribedAt,
    to: validatedAt,
  },
  {
    step: 'Validation → clôture',
    direction: CourrierDirection.ENTRANT,
    from: validatedAt,
    // A project's closing ends its effets; nobody treated them then.
    to: (row) => (row.statusBeforeProjectClosure ? null : row.closedAt),
  },
  {
    step: 'Rédaction',
    direction: CourrierDirection.SORTANT,
    from: (row) => row.createdAt,
    to: (row) => row.submittedAt,
  },
  {
    step: 'Validation',
    direction: CourrierDirection.SORTANT,
    from: (row) => row.submittedAt,
    to: (row) => row.approvedAt,
  },
  {
    step: 'Signature',
    direction: CourrierDirection.SORTANT,
    from: (row) => row.approvedAt,
    to: (row) => row.signedAt,
  },
  {
    step: 'Envoi',
    direction: CourrierDirection.SORTANT,
    from: (row) => row.signedAt ?? row.approvedAt,
    to: sentOf,
  },
];

export function computeDelayBySteps(
  rows: OverviewRow[],
  window: Window,
  direction?: CourrierDirection,
) {
  const wanted = direction ?? CourrierDirection.ENTRANT;
  return STEPS.filter((step) => step.direction === wanted).map((step) => {
    const delays = rows
      .filter((row) => row.direction === step.direction)
      .flatMap((row) => {
        const from = step.from(row);
        const to = step.to(row);
        return from && to && inWindow(to, window)
          ? [daysBetween(from, to)]
          : [];
      });
    return { step: step.step, days: round1(mean(delays) ?? 0) };
  });
}

function projectOf(row: OverviewRow) {
  return (
    row.dossier?.project ??
    row.dossier?.contract?.project ??
    row.contract?.project ??
    row.project ??
    null
  );
}

type Group = {
  id: string;
  name: string;
  project: string | null;
  rows: OverviewRow[];
};

function summarize(groups: Map<string, Group>, window: Window, now: Date) {
  return [...groups.values()]
    .map((group) => {
      const delay = averageDelay(group.rows, window);
      return {
        id: group.id,
        name: group.name,
        project: group.project,
        count: group.rows.length,
        late: group.rows.filter((row) => isOpen(row) && isLateAt(row, now))
          .length,
        delayDays: delay ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, REPARTITION_ROWS);
}

function addTo(
  groups: Map<string, Group>,
  key: { id: string; name: string; project: string | null },
  row: OverviewRow,
) {
  const group = groups.get(key.id) ?? { ...key, rows: [] };
  group.rows.push(row);
  groups.set(key.id, group);
}

// By dossier (else contract), and by project: the effets of the period and
// those still in progress.
export function computeRepartition(
  rows: OverviewRow[],
  window: Window,
  now: Date,
) {
  const records = new Map<string, Group>();
  const projects = new Map<string, Group>();
  for (const row of rows) {
    if (
      !isOpen(row) &&
      !inWindow(startOf(row), window) &&
      !inWindow(concludedAt(row), window)
    ) {
      continue;
    }
    const project = projectOf(row);
    const record = row.dossier
      ? { id: row.dossier.id, name: row.dossier.title }
      : row.contract
        ? { id: row.contract.id, name: row.contract.title }
        : null;
    if (record) {
      addTo(records, { ...record, project: project?.name ?? null }, row);
    }
    if (project) {
      addTo(
        projects,
        { id: project.id, name: project.name, project: project.name },
        row,
      );
    }
  }
  return {
    records: summarize(records, window, now),
    projects: summarize(projects, window, now),
  };
}

export function computeTypes(rows: OverviewRow[], window: Window) {
  const byType = new Map<string, { name: string; rows: OverviewRow[] }>();
  for (const row of rows) {
    if (!row.type) continue;
    const entry = byType.get(row.type.id) ?? { name: row.type.name, rows: [] };
    entry.rows.push(row);
    byType.set(row.type.id, entry);
  }
  return [...byType]
    .map(([id, entry]) => ({
      id,
      name: entry.name,
      received: countReceived(entry.rows, window),
      sent: countSent(entry.rows, window),
      onTimeRate: onTimeRate(entry.rows, window),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function monthKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  })
    .format(date)
    .slice(0, 7);
}

export function computeMonthly(rows: OverviewRow[], now: Date) {
  const today = localToday(now.getTime(), TIME_ZONE);
  const months = Array.from({ length: 6 }, (_, index) =>
    monthKey(
      zonedMidnight(today.year, today.month - (5 - index), 15, TIME_ZONE),
    ),
  );
  const totals = new Map(
    months.map((month) => [month, { month, incoming: 0, outgoing: 0 }]),
  );
  for (const row of rows) {
    if (isEntrant(row)) {
      const entry = totals.get(monthKey(startOf(row)));
      if (entry) entry.incoming++;
    }
    const sent = sentOf(row);
    if (sent) {
      const entry = totals.get(monthKey(sent));
      if (entry) entry.outgoing++;
    }
  }
  return [...totals.values()];
}

export function resolveWindows(
  query: DashboardOverviewQueryDto,
  now: Date,
): { current: Window; previous: Window; earliest: Date } {
  const today = localToday(now.getTime(), TIME_ZONE);
  const dayStart = (offset: number) =>
    zonedMidnight(today.year, today.month, today.day + offset, TIME_ZONE);
  let current: Window;
  switch (query.period ?? '30d') {
    case 'today':
      current = { from: dayStart(0), to: now };
      break;
    case '7d':
      current = { from: dayStart(-6), to: now };
      break;
    case 'month':
      current = {
        from: zonedMidnight(today.year, today.month, 1, TIME_ZONE),
        to: now,
      };
      break;
    case 'custom': {
      const from = new Date(query.from!);
      const to = new Date(new Date(query.to!).getTime() + DAY_MS);
      if (from >= to) {
        throw new BadRequestException('`from` must be before `to`');
      }
      current = { from, to };
      break;
    }
    default:
      current = { from: dayStart(-29), to: now };
  }
  const span = current.to.getTime() - current.from.getTime();
  const previous: Window =
    query.compare === 'lastYear'
      ? { from: minusOneYear(current.from), to: minusOneYear(current.to) }
      : { from: new Date(current.from.getTime() - span), to: current.from };
  const sixMonthsAgo = zonedMidnight(today.year, today.month - 5, 1, TIME_ZONE);
  const earliest = new Date(
    Math.min(previous.from.getTime(), sixMonthsAgo.getTime()),
  );
  return { current, previous, earliest };
}

function minusOneYear(date: Date) {
  const shifted = new Date(date);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - 1);
  return shifted;
}

// Effets have no priority of their own: their dossier's or their tasks'.
function priorityWhere(priority: OverviewPriority): Prisma.CourrierWhereInput {
  if (priority === 'HAUTE') return { id: { in: [] } };
  const dossier =
    priority === 'URGENTE' ? DossierPriority.URGENT : DossierPriority.NORMAL;
  const task =
    priority === 'URGENTE'
      ? InstructionPriority.URGENT
      : InstructionPriority.NORMAL;
  return {
    OR: [
      { dossier: { priority: dossier } },
      { instructions: { some: { priority: task } } },
    ],
  };
}

export function overviewWhere(
  query: DashboardOverviewQueryDto,
): Prisma.CourrierWhereInput {
  const filters: Prisma.CourrierWhereInput[] = [courrierOfSite(query.siteId)];
  if (query.direction) filters.push({ direction: query.direction });
  if (query.typeIds?.length) filters.push({ typeId: { in: query.typeIds } });
  if (query.supervisorId) filters.push({ supervisorId: query.supervisorId });
  if (query.projectIds?.length) {
    const projectId = { in: query.projectIds };
    filters.push({ OR: [{ projectId }, { dossier: { projectId } }] });
  }
  if (query.contractOrDossierId) {
    const id = query.contractOrDossierId;
    filters.push({
      OR: [
        { contractId: id },
        { dossierId: id },
        { dossier: { contractId: id } },
      ],
    });
  }
  if (query.team) {
    const holdsRole = { userRoles: { some: { roleId: query.team } } };
    filters.push({
      OR: [{ owner: holdsRole }, { supervisor: holdsRole }],
    });
  }
  if (query.priority) filters.push(priorityWhere(query.priority));
  return { AND: filters };
}

/**
 * The global dashboards (T·1, T·4, T·5), for one site: whoever holds
 * DASHBOARD_GLOBAL_READ globally or at that site, or that site's responsible.
 */
@Injectable()
export class DashboardOverviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  async overview(query: DashboardOverviewQueryDto, userId: string) {
    await this.assertAllowed(query.siteId, userId);
    const now = new Date();
    const { current, previous, earliest } = resolveWindows(query, now);
    const [rows, teams] = await Promise.all([
      this.database.courrier.findMany({
        where: {
          AND: [
            overviewWhere(query),
            {
              OR: [
                { status: { notIn: TERMINAL } },
                { createdAt: { gte: earliest } },
                { closedAt: { gte: earliest } },
                { sentAt: { gte: earliest } },
                { transmittedAt: { gte: earliest } },
              ],
            },
          ],
        },
        select: rowSelect,
      }),
      this.database.role.findMany({
        where: { siteId: query.siteId, archivedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const sortants = rows.filter((row) => !isEntrant(row));
    const corrections = sortants.length
      ? await this.database.activityLog.findMany({
          where: {
            entityType: 'Courrier',
            action: 'COURRIER_CORRECTIONS_DEMANDEES',
            entityId: { in: sortants.map((row) => row.id) },
            createdAt: { gte: earliest },
          },
          select: { entityId: true, createdAt: true },
        })
      : [];
    return {
      arbitration: computeArbitration(rows, now),
      kpis: computeKpis(rows, corrections, current, previous),
      monthly: computeMonthly(rows, now),
      delayBySteps: computeDelayBySteps(rows, current, query.direction),
      aging: computeAging(rows, now),
      repartition: computeRepartition(rows, current, now),
      types: computeTypes(rows, current),
      teams,
    };
  }

  /** Open tasks per agent of the site, and how many are overdue. */
  async workload(siteId: string) {
    const now = new Date();
    const open = {
      AND: [
        taskOfSite(siteId),
        {
          status: {
            notIn: [InstructionStatus.TERMINEE, InstructionStatus.ANNULEE],
          },
        },
      ],
    } satisfies Prisma.InstructionWhereInput;
    const select = {
      assignees: { select: { user: { select: { id: true, name: true } } } },
    } satisfies Prisma.InstructionSelect;
    const [tasks, overdue] = await Promise.all([
      this.database.instruction.findMany({ where: open, select }),
      this.database.instruction.findMany({
        where: { AND: [open, overdueWhere(now)] },
        select,
      }),
    ]);
    const agents = new Map<
      string,
      { name: string; open: number; late: number }
    >();
    const tally = (list: typeof tasks, field: 'open' | 'late') => {
      for (const task of list) {
        const users = new Map(
          task.assignees.map((assignee) => [assignee.user.id, assignee.user]),
        );
        for (const user of users.values()) {
          const agent = agents.get(user.id) ?? {
            name: user.name,
            open: 0,
            late: 0,
          };
          agent[field]++;
          agents.set(user.id, agent);
        }
      }
    };
    tally(tasks, 'open');
    tally(overdue, 'late');
    return [...agents.values()].sort((a, b) => b.open - a.open);
  }

  private async assertAllowed(siteId: string, userId: string) {
    await this.rbac.assertManagesSite(
      userId,
      PermissionCode.DashboardGlobalRead,
      siteId,
      'Ce tableau de bord',
    );
    await assertSiteExists(this.database, siteId);
  }
}
