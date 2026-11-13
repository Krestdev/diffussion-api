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
import { statusForDueDate } from '../../domain/dossier/dossier.service';

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

// One update per status, since each row keeps the status it leaves.
async function byStatus<S>(
  rows: { id: string; status: S }[],
  update: (ids: string[], status: S) => Promise<unknown>,
) {
  const groups = new Map<S, string[]>();
  for (const { id, status } of rows) {
    groups.set(status, [...(groups.get(status) ?? []), id]);
  }
  for (const [status, ids] of groups) await update(ids, status);
}

const idAndStatus = { id: true, status: true } as const;

/** Open work ends: tasks and unsent sortants are cancelled, entrants closed. */
async function closeContents(tx: Tx, projectId: string, now: Date) {
  await byStatus(
    await tx.instruction.findMany({
      where: {
        AND: [tasksOf(projectId)],
        status: {
          notIn: [InstructionStatus.TERMINEE, InstructionStatus.ANNULEE],
        },
      },
      select: idAndStatus,
    }),
    (ids, status) =>
      tx.instruction.updateMany({
        where: { id: { in: ids } },
        data: {
          status: InstructionStatus.ANNULEE,
          cancellationReason: CLOSING_REASON,
          statusBeforeProjectClosure: status,
        },
      }),
  );
  const openEffets = (direction: CourrierDirection) =>
    tx.courrier.findMany({
      where: {
        AND: [effetsOf(projectId)],
        direction,
        status: { notIn: COURRIER_DONE },
      },
      select: idAndStatus,
    });
  await byStatus(await openEffets(CourrierDirection.ENTRANT), (ids, status) =>
    tx.courrier.updateMany({
      where: { id: { in: ids } },
      data: {
        status: CourrierStatus.CLOTURE,
        closedAt: now,
        closingNote: CLOSING_REASON,
        statusBeforeProjectClosure: status,
      },
    }),
  );
  await byStatus(await openEffets(CourrierDirection.SORTANT), (ids, status) =>
    tx.courrier.updateMany({
      where: { id: { in: ids } },
      data: {
        status: CourrierStatus.ANNULE,
        cancelledAt: now,
        cancellationReason: CLOSING_REASON,
        statusBeforeProjectClosure: status,
      },
    }),
  );
  await tx.dossier.updateMany({
    where: {
      AND: [dossiersOf(projectId)],
      status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
    },
    data: { status: DossierStatus.CLOSED, closedAt: now },
  });
}

/** Undoes closeContents, for what the closing did and nothing else. */
async function reopenContents(
  tx: Tx,
  projectId: string,
  closedAt: Date | null,
) {
  const tasks = await tx.instruction.findMany({
    where: {
      AND: [tasksOf(projectId)],
      statusBeforeProjectClosure: { not: null },
    },
    select: { id: true, status: true, statusBeforeProjectClosure: true },
  });
  await byStatus(
    tasks.map((task) => ({
      id: task.id,
      status: task.statusBeforeProjectClosure!,
    })),
    (ids, status) =>
      tx.instruction.updateMany({
        where: { id: { in: ids } },
        data: {
          status,
          cancellationReason: null,
          statusBeforeProjectClosure: null,
        },
      }),
  );
  const effets = await tx.courrier.findMany({
    where: {
      AND: [effetsOf(projectId)],
      statusBeforeProjectClosure: { not: null },
    },
    select: { id: true, statusBeforeProjectClosure: true },
  });
  await byStatus(
    effets.map((effet) => ({
      id: effet.id,
      status: effet.statusBeforeProjectClosure!,
    })),
    (ids, status) =>
      tx.courrier.updateMany({
        where: { id: { in: ids } },
        data: {
          status,
          closedAt: null,
          closingNote: null,
          cancelledAt: null,
          cancellationReason: null,
          statusBeforeProjectClosure: null,
        },
      }),
  );
  if (!closedAt) return;
  const dossiers = await tx.dossier.findMany({
    where: {
      AND: [dossiersOf(projectId)],
      status: DossierStatus.CLOSED,
      closedAt,
    },
    select: { id: true, dueDate: true },
  });
  for (const dossier of dossiers) {
    await tx.dossier.update({
      where: { id: dossier.id },
      data: {
        status: statusForDueDate(DossierStatus.IN_PROGRESS, dossier.dueDate),
        closedAt: null,
      },
    });
  }
}

async function archiveContents(
  tx: Tx,
  projectId: string,
  now: Date,
  reason: string | null,
) {
  await tx.dossier.updateMany({
    where: {
      AND: [dossiersOf(projectId)],
      status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
    },
    data: { status: DossierStatus.CLOSED, closedAt: now },
  });
  await tx.dossier.updateMany({
    where: { AND: [dossiersOf(projectId)], status: DossierStatus.CLOSED },
    data: {
      status: DossierStatus.ARCHIVED,
      archivedAt: now,
      archiveReason: reason,
    },
  });
  await tx.contract.updateMany({
    where: { projectId, status: ContractStatus.ACTIVE },
    data: {
      status: ContractStatus.ARCHIVED,
      archivedAt: now,
      archiveReason: reason,
    },
  });
  await byStatus(
    await tx.courrier.findMany({
      where: {
        AND: [effetsOf(projectId)],
        status: { not: CourrierStatus.ARCHIVE },
      },
      select: idAndStatus,
    }),
    (ids, status) =>
      tx.courrier.updateMany({
        where: { id: { in: ids } },
        data: {
          status: CourrierStatus.ARCHIVE,
          archivedAt: now,
          archiveReason: reason,
          archivedFromStatus: status,
        },
      }),
  );
  await byStatus(
    await tx.analysisSheet.findMany({
      where: {
        AND: [sheetsOf(projectId)],
        status: { not: AnalysisSheetStatus.ARCHIVEE },
      },
      select: idAndStatus,
    }),
    (ids, status) =>
      tx.analysisSheet.updateMany({
        where: { id: { in: ids } },
        data: {
          status: AnalysisSheetStatus.ARCHIVEE,
          archivedAt: now,
          archiveReason: reason,
          archivedFromStatus: status,
        },
      }),
  );
}

/**
 * Undoes archiveContents. What was archived on its own, before the project,
 * has another archiving date and stays archived.
 */
async function restoreContents(
  tx: Tx,
  projectId: string,
  archivedAt: Date | null,
) {
  if (!archivedAt) return;
  const cleared = { archivedAt: null, archiveReason: null };
  await tx.dossier.updateMany({
    where: {
      AND: [dossiersOf(projectId)],
      status: DossierStatus.ARCHIVED,
      archivedAt,
    },
    data: { status: DossierStatus.CLOSED, ...cleared },
  });
  await tx.contract.updateMany({
    where: { projectId, status: ContractStatus.ARCHIVED, archivedAt },
    data: { status: ContractStatus.ACTIVE, ...cleared },
  });
  const effets = await tx.courrier.findMany({
    where: {
      AND: [effetsOf(projectId)],
      status: CourrierStatus.ARCHIVE,
      archivedAt,
      archivedFromStatus: { not: null },
    },
    select: { id: true, archivedFromStatus: true },
  });
  await byStatus(
    effets.map((effet) => ({
      id: effet.id,
      status: effet.archivedFromStatus!,
    })),
    (ids, status) =>
      tx.courrier.updateMany({
        where: { id: { in: ids } },
        data: { status, ...cleared, archivedFromStatus: null },
      }),
  );
  const sheets = await tx.analysisSheet.findMany({
    where: {
      AND: [sheetsOf(projectId)],
      status: AnalysisSheetStatus.ARCHIVEE,
      archivedAt,
      archivedFromStatus: { not: null },
    },
    select: { id: true, archivedFromStatus: true },
  });
  await byStatus(
    sheets.map((sheet) => ({
      id: sheet.id,
      status: sheet.archivedFromStatus!,
    })),
    (ids, status) =>
      tx.analysisSheet.updateMany({
        where: { id: { in: ids } },
        data: { status, ...cleared, archivedFromStatus: null },
      }),
  );
}

/** What a project's change of status does to everything in it. */
export async function cascadeProjectStatus(
  tx: Tx,
  project: {
    id: string;
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
  if (to === ProjectStatus.ACTIVE) {
    await reopenContents(tx, project.id, project.closedAt);
  } else if (to === ProjectStatus.ARCHIVED) {
    await archiveContents(
      tx,
      project.id,
      change.archivedAt!,
      change.archiveReason ?? null,
    );
  } else if (project.status === ProjectStatus.ARCHIVED) {
    await restoreContents(tx, project.id, project.archivedAt);
  } else {
    await closeContents(tx, project.id, change.closedAt!);
  }
}
