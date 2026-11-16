import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DossierStatus,
  InstructionStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { DOSSIER_STATES } from '../../domain/dossier/dossier.states';
import { WorkflowService } from '../../workflow/workflow.service';
import { assertCompanyActive } from './referential-guards';

// Stateless: the helpers below run outside Nest's injection.
const workflow = new WorkflowService();

type Db = Prisma.TransactionClient;

// Statuses in which a dossier is still being worked on — the only ones that
// can turn LATE, and the ones new content (courrier, instruction, livrable,
// document) may be attached in.
export const ACTIVE_DOSSIER_STATUSES: DossierStatus[] = [
  DossierStatus.OPEN,
  DossierStatus.IN_PROGRESS,
  DossierStatus.PENDING,
  DossierStatus.LATE,
];

/**
 * RG-DOS-007: a CLOSED or ARCHIVED dossier can only be consulted — nothing
 * new may be attached to it. Also enforces the owning company being active
 * (see assertCompanyActive).
 */
export async function assertDossierOpenForActivity(db: Db, dossierId: string) {
  const dossier = await db.dossier.findUnique({
    where: { id: dossierId },
    select: { number: true, status: true, companyId: true },
  });
  if (!dossier) {
    throw new NotFoundException(`Dossier ${dossierId} not found`);
  }
  if (!ACTIVE_DOSSIER_STATUSES.includes(dossier.status)) {
    throw new BadRequestException(
      `Dossier ${dossier.number} is ${dossier.status.toLowerCase()} and can only be consulted — nothing new can be attached to it`,
    );
  }
  await assertCompanyActive(db, dossier.companyId);
}

// Work has started on the dossier (first courrier or instruction attached):
// OPEN -> IN_PROGRESS (MARK_IN_PROGRESS, recorded in StatusHistory). No-op in
// any other status.
export async function markDossierInProgress(db: Db, dossierId: string) {
  const dossier = await db.dossier.findUnique({
    where: { id: dossierId },
    select: { status: true, companyId: true },
  });
  if (dossier?.status !== DossierStatus.OPEN) return;
  try {
    await workflow.transition(db, {
      table: DOSSIER_STATES,
      delegate: db.dossier,
      entityId: dossierId,
      event: 'MARK_IN_PROGRESS',
      from: dossier.status,
      companyId: dossier.companyId,
    });
  } catch (error) {
    // Another request moved it first: nothing left to do.
    if (!(error instanceof ConflictException)) throw error;
  }
}

// 10.1.8: share of the dossier's instructions that are terminated.
// Cancelled instructions are out of scope, so they count neither as done
// nor in the total.
export async function computeDossierProgress(db: Db, dossierId: string) {
  const [total, done] = await Promise.all([
    db.instruction.count({
      where: { dossierId, status: { not: InstructionStatus.ANNULEE } },
    }),
    db.instruction.count({
      where: { dossierId, status: InstructionStatus.TERMINEE },
    }),
  ]);
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, progress };
}

// Persists the progress on the dossier (kept for cheap listings) — called
// whenever an instruction is created, terminated or cancelled.
export async function refreshDossierProgress(db: Db, dossierId: string) {
  const { progress } = await computeDossierProgress(db, dossierId);
  await db.dossier.update({ where: { id: dossierId }, data: { progress } });
}
