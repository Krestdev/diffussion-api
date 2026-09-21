import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DossierStatus,
  InstructionStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { assertSiteActive } from './referential-guards';

type Db = Prisma.TransactionClient;

// Statuses in which a dossier is still being worked on — the only ones that
// can turn LATE, and the ones new content (courrier, instruction, livrable,
// document, circuit) may be attached in.
export const ACTIVE_DOSSIER_STATUSES: DossierStatus[] = [
  DossierStatus.OPEN,
  DossierStatus.IN_PROGRESS,
  DossierStatus.PENDING,
  DossierStatus.LATE,
];

/**
 * RG-DOS-007: a CLOSED or ARCHIVED dossier can only be consulted — nothing
 * new may be attached to it. Also enforces the owning site being active
 * (see assertSiteActive).
 */
export async function assertDossierOpenForActivity(db: Db, dossierId: string) {
  const dossier = await db.dossier.findUnique({
    where: { id: dossierId },
    select: { number: true, status: true, siteId: true },
  });
  if (!dossier) {
    throw new NotFoundException(`Dossier ${dossierId} not found`);
  }
  if (!ACTIVE_DOSSIER_STATUSES.includes(dossier.status)) {
    throw new BadRequestException(
      `Dossier ${dossier.number} is ${dossier.status.toLowerCase()} and can only be consulted — nothing new can be attached to it`,
    );
  }
  await assertSiteActive(db, dossier.siteId);
}

// Work has started on the dossier (first courrier or instruction attached):
// OPEN -> IN_PROGRESS. No-op in any other status.
export async function markDossierInProgress(db: Db, dossierId: string) {
  await db.dossier.updateMany({
    where: { id: dossierId, status: DossierStatus.OPEN },
    data: { status: DossierStatus.IN_PROGRESS },
  });
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
