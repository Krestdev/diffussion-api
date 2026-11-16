import {
  AnalysisSheetStatus,
  ContractStatus,
  CourrierDirection,
  CourrierStatus,
  DossierStatus,
  InstructionStatus,
  Prisma,
  ProjectStatus,
} from '../../../generated/prisma/client';
import { ANALYSIS_SHEET_STATES } from '../../analysis/analysis-sheet.states';
import { statusForDueDate } from '../../domain/dossier/dossier.service';
import { DOSSIER_STATES } from '../../domain/dossier/dossier.states';
import { courrierStates } from '../../domain/mail/courrier.states';
import { INSTRUCTION_STATES } from '../../instructions/instruction.states';
import { TransitionTable } from '../../workflow/transition-table';
import {
  StatusDelegate,
  WorkflowService,
} from '../../workflow/workflow.service';
import { CONTRACT_STATES } from '../contract/contract.states';

// A courrier in one of these is done with: neither in progress nor waiting.
export const COURRIER_DONE: CourrierStatus[] = [
  CourrierStatus.CLOTURE,
  CourrierStatus.ARCHIVE,
  CourrierStatus.ANNULE,
  CourrierStatus.ENVOYE,
  CourrierStatus.DECHARGE,
];

const CLOSING_REASON = 'Projet clôturé';

type Tx = Prisma.TransactionClient;

/**
 * Where the cascade runs: the project's transaction, the workflow engine and the project's
 * company. Every row moves through the engine as a system change (StatusHistory, no permission:
 * the project's own change carries the person's authority).
 */
type Cascade = { tx: Tx; workflow: WorkflowService; companyId: string };

/** One transition per row, from the status it was read in, with its own fields. */
async function moveEach<S extends string, E extends string>(
  cascade: Cascade,
  table: (row: { id: string }) => TransitionTable<S, E>,
  delegate: StatusDelegate,
  event: E,
  rows: {
    id: string;
    from: S;
    to?: S;
    data: Record<string, unknown>;
  }[],
  reason?: string | null,
) {
  for (const row of rows) {
    await cascade.workflow.transition(cascade.tx, {
      table: table(row),
      delegate,
      entityId: row.id,
      event,
      from: row.from,
      to: row.to,
      data: row.data,
      reason,
      companyId: cascade.companyId,
      system: true,
    });
  }
}

function dossiersOf(projectId: string): Prisma.DossierWhereInput {
  return { OR: [{ projectId }, { contract: { projectId } }] };
}

function effetsOf(projectId: string): Prisma.CourrierWhereInput {
  return {
    OR: [
      { projectId },
      { contract: { projectId } },
      { dossier: dossiersOf(projectId) },
    ],
  };
}

function tasksOf(projectId: string): Prisma.InstructionWhereInput {
  return {
    OR: [
      { dossier: dossiersOf(projectId) },
      { contract: { projectId } },
      { courrier: effetsOf(projectId) },
    ],
  };
}

function sheetsOf(projectId: string): Prisma.AnalysisSheetWhereInput {
  return {
    OR: [
      { projectId },
      { contract: { projectId } },
      { dossier: dossiersOf(projectId) },
      { courrier: effetsOf(projectId) },
    ],
  };
}

const instructions = () => INSTRUCTION_STATES;
const dossiers = () => DOSSIER_STATES;
const contracts = () => CONTRACT_STATES;
const sheets = () => ANALYSIS_SHEET_STATES;

/** Open work ends: tasks and unsent sortants are cancelled, entrants closed. */
async function closeContents(cascade: Cascade, projectId: string, now: Date) {
  const { tx } = cascade;
  const tasks = await tx.instruction.findMany({
    where: {
      AND: [tasksOf(projectId)],
      status: {
        notIn: [InstructionStatus.TERMINEE, InstructionStatus.ANNULEE],
      },
    },
    select: { id: true, status: true },
  });
  await moveEach(
    cascade,
    instructions,
    tx.instruction,
    'CANCEL_BY_PROJECT',
    tasks.map((task) => ({
      id: task.id,
      from: task.status,
      data: {
        cancellationReason: CLOSING_REASON,
        statusBeforeProjectClosure: task.status,
      },
    })),
    CLOSING_REASON,
  );
  const openEffets = (direction: CourrierDirection) =>
    tx.courrier.findMany({
      where: {
        AND: [effetsOf(projectId)],
        direction,
        status: { notIn: COURRIER_DONE },
      },
      select: { id: true, status: true },
    });
  await moveEach(
    cascade,
    () => courrierStates(CourrierDirection.ENTRANT),
    tx.courrier,
    'CLOSE_BY_PROJECT',
    (await openEffets(CourrierDirection.ENTRANT)).map((effet) => ({
      id: effet.id,
      from: effet.status,
      data: {
        closedAt: now,
        closingNote: CLOSING_REASON,
        statusBeforeProjectClosure: effet.status,
      },
    })),
    CLOSING_REASON,
  );
  await moveEach(
    cascade,
    () => courrierStates(CourrierDirection.SORTANT),
    tx.courrier,
    'CANCEL_BY_PROJECT',
    (await openEffets(CourrierDirection.SORTANT)).map((effet) => ({
      id: effet.id,
      from: effet.status,
      data: {
        cancelledAt: now,
        cancellationReason: CLOSING_REASON,
        statusBeforeProjectClosure: effet.status,
      },
    })),
    CLOSING_REASON,
  );
  await closeDossiers(cascade, projectId, now);
}

/** The project's dossiers still active are closed with it. */
async function closeDossiers(cascade: Cascade, projectId: string, now: Date) {
  const { tx } = cascade;
  const open = await tx.dossier.findMany({
    where: {
      AND: [dossiersOf(projectId)],
      status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
    },
    select: { id: true, status: true },
  });
  await moveEach(
    cascade,
    dossiers,
    tx.dossier,
    'CLOSE_BY_PROJECT',
    open.map((dossier) => ({
      id: dossier.id,
      from: dossier.status,
      data: { closedAt: now },
    })),
  );
}

/** Undoes closeContents, for what the closing did and nothing else. */
async function reopenContents(
  cascade: Cascade,
  projectId: string,
  closedAt: Date | null,
) {
  const { tx } = cascade;
  const tasks = await tx.instruction.findMany({
    where: {
      AND: [tasksOf(projectId)],
      statusBeforeProjectClosure: { not: null },
    },
    select: { id: true, status: true, statusBeforeProjectClosure: true },
  });
  await moveEach(
    cascade,
    instructions,
    tx.instruction,
    'REOPEN_BY_PROJECT',
    tasks.map((task) => ({
      id: task.id,
      from: task.status,
      to: task.statusBeforeProjectClosure!,
      data: { cancellationReason: null, statusBeforeProjectClosure: null },
    })),
  );
  const effets = await tx.courrier.findMany({
    where: {
      AND: [effetsOf(projectId)],
      statusBeforeProjectClosure: { not: null },
    },
    select: {
      id: true,
      direction: true,
      status: true,
      statusBeforeProjectClosure: true,
    },
  });
  for (const direction of [
    CourrierDirection.ENTRANT,
    CourrierDirection.SORTANT,
  ]) {
    await moveEach(
      cascade,
      () => courrierStates(direction),
      tx.courrier,
      'REOPEN_BY_PROJECT',
      effets
        .filter((effet) => effet.direction === direction)
        .map((effet) => ({
          id: effet.id,
          from: effet.status,
          to: effet.statusBeforeProjectClosure!,
          data: {
            closedAt: null,
            closingNote: null,
            cancelledAt: null,
            cancellationReason: null,
            statusBeforeProjectClosure: null,
          },
        })),
    );
  }
  if (!closedAt) return;
  const closed = await tx.dossier.findMany({
    where: {
      AND: [dossiersOf(projectId)],
      status: DossierStatus.CLOSED,
      closedAt,
    },
    select: { id: true, status: true, dueDate: true },
  });
  await moveEach(
    cascade,
    dossiers,
    tx.dossier,
    'REOPEN_BY_PROJECT',
    closed.map((dossier) => ({
      id: dossier.id,
      from: dossier.status,
      to: statusForDueDate(DossierStatus.IN_PROGRESS, dossier.dueDate),
      data: { closedAt: null },
    })),
  );
}

async function archiveContents(
  cascade: Cascade,
  projectId: string,
  now: Date,
  reason: string | null,
) {
  const { tx } = cascade;
  await closeDossiers(cascade, projectId, now);
  const closed = await tx.dossier.findMany({
    where: { AND: [dossiersOf(projectId)], status: DossierStatus.CLOSED },
    select: { id: true, status: true },
  });
  await moveEach(
    cascade,
    dossiers,
    tx.dossier,
    'ARCHIVE_BY_PROJECT',
    closed.map((dossier) => ({
      id: dossier.id,
      from: dossier.status,
      data: { archivedAt: now, archiveReason: reason },
    })),
    reason,
  );
  const active = await tx.contract.findMany({
    where: { projectId, status: ContractStatus.ACTIVE },
    select: { id: true, status: true },
  });
  await moveEach(
    cascade,
    contracts,
    tx.contract,
    'ARCHIVE_BY_PROJECT',
    active.map((contract) => ({
      id: contract.id,
      from: contract.status,
      data: { archivedAt: now, archiveReason: reason },
    })),
    reason,
  );
  const effets = await tx.courrier.findMany({
    where: {
      AND: [effetsOf(projectId)],
      status: { not: CourrierStatus.ARCHIVE },
    },
    select: { id: true, direction: true, status: true },
  });
  await moveEach(
    cascade,
    (row) =>
      courrierStates(effets.find((effet) => effet.id === row.id)!.direction),
    tx.courrier,
    'ARCHIVE_BY_PROJECT',
    effets.map((effet) => ({
      id: effet.id,
      from: effet.status,
      data: {
        archivedAt: now,
        archiveReason: reason,
        archivedFromStatus: effet.status,
      },
    })),
    reason,
  );
  const live = await tx.analysisSheet.findMany({
    where: {
      AND: [sheetsOf(projectId)],
      status: { not: AnalysisSheetStatus.ARCHIVEE },
    },
    select: { id: true, status: true },
  });
  await moveEach(
    cascade,
    sheets,
    tx.analysisSheet,
    'ARCHIVE_BY_PROJECT',
    live.map((sheet) => ({
      id: sheet.id,
      from: sheet.status,
      data: {
        archivedAt: now,
        archiveReason: reason,
        archivedFromStatus: sheet.status,
      },
    })),
    reason,
  );
}

/**
 * Undoes archiveContents. What was archived on its own, before the project,
 * has another archiving date and stays archived.
 */
async function restoreContents(
  cascade: Cascade,
  projectId: string,
  archivedAt: Date | null,
) {
  if (!archivedAt) return;
  const { tx } = cascade;
  const cleared = { archivedAt: null, archiveReason: null };
  const archived = await tx.dossier.findMany({
    where: {
      AND: [dossiersOf(projectId)],
      status: DossierStatus.ARCHIVED,
      archivedAt,
    },
    select: { id: true, status: true },
  });
  await moveEach(
    cascade,
    dossiers,
    tx.dossier,
    'RESTORE_BY_PROJECT',
    archived.map((dossier) => ({
      id: dossier.id,
      from: dossier.status,
      data: cleared,
    })),
  );
  const archivedContracts = await tx.contract.findMany({
    where: { projectId, status: ContractStatus.ARCHIVED, archivedAt },
    select: { id: true, status: true },
  });
  await moveEach(
    cascade,
    contracts,
    tx.contract,
    'RESTORE_BY_PROJECT',
    archivedContracts.map((contract) => ({
      id: contract.id,
      from: contract.status,
      data: cleared,
    })),
  );
  const effets = await tx.courrier.findMany({
    where: {
      AND: [effetsOf(projectId)],
      status: CourrierStatus.ARCHIVE,
      archivedAt,
      archivedFromStatus: { not: null },
    },
    select: {
      id: true,
      direction: true,
      status: true,
      archivedFromStatus: true,
    },
  });
  await moveEach(
    cascade,
    (row) =>
      courrierStates(effets.find((effet) => effet.id === row.id)!.direction),
    tx.courrier,
    'RESTORE_BY_PROJECT',
    effets.map((effet) => ({
      id: effet.id,
      from: effet.status,
      to: effet.archivedFromStatus!,
      data: { ...cleared, archivedFromStatus: null },
    })),
  );
  const archivedSheets = await tx.analysisSheet.findMany({
    where: {
      AND: [sheetsOf(projectId)],
      status: AnalysisSheetStatus.ARCHIVEE,
      archivedAt,
      archivedFromStatus: { not: null },
    },
    select: { id: true, status: true, archivedFromStatus: true },
  });
  await moveEach(
    cascade,
    sheets,
    tx.analysisSheet,
    'RESTORE_BY_PROJECT',
    archivedSheets.map((sheet) => ({
      id: sheet.id,
      from: sheet.status,
      to: sheet.archivedFromStatus!,
      data: { ...cleared, archivedFromStatus: null },
    })),
  );
}

/** What a project's change of status does to everything in it. */
export async function cascadeProjectStatus(
  tx: Tx,
  workflow: WorkflowService,
  project: {
    id: string;
    companyId: string;
    status: ProjectStatus;
    closedAt: Date | null;
    archivedAt: Date | null;
  },
  to: ProjectStatus,
  change: {
    closedAt?: Date | null;
    archivedAt?: Date | null;
    archiveReason?: string | null;
  },
) {
  const cascade: Cascade = { tx, workflow, companyId: project.companyId };
  if (to === ProjectStatus.ACTIVE) {
    await reopenContents(cascade, project.id, project.closedAt);
  } else if (to === ProjectStatus.ARCHIVED) {
    await archiveContents(
      cascade,
      project.id,
      change.archivedAt!,
      change.archiveReason ?? null,
    );
  } else if (project.status === ProjectStatus.ARCHIVED) {
    await restoreContents(cascade, project.id, project.archivedAt);
  } else {
    await closeContents(cascade, project.id, change.closedAt!);
  }
}
