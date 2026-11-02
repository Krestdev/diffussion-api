import { Prisma } from '../../../generated/prisma/client';

type Db = Prisma.TransactionClient;

type Version = {
  id: string;
  parentVersionId: string | null;
  isLatest: boolean;
};

// A livrable's decisions and opinions, latest first: the validateur's AVIS
// (with its comment) and the superviseur's decisions (with their motif
// when rejected).
export const livrableValidations = {
  orderBy: { decidedAt: 'desc' },
  select: {
    decision: true,
    motif: true,
    comment: true,
    decidedAt: true,
    validator: { select: { id: true, name: true } },
  },
} satisfies Prisma.Livrable$validationsArgs;

// A task's livrables in the order they were entered (position), the
// identifier settling livrables of the same position for a stable order.
export const livrableOrder = [
  { position: 'asc' },
  { version: 'asc' },
  { id: 'asc' },
] satisfies Prisma.LivrableOrderByWithRelationInput[];

// The position of a livrable added to a task now: after all the others.
export async function nextLivrablePosition(db: Db, instructionId: string) {
  const { _max } = await db.livrable.aggregate({
    where: { instructionId },
    _max: { position: true },
  });
  return _max.position === null ? 0 : _max.position + 1;
}

// Earlier versions of `livrable`, most recent first, found in `byId`.
function historyOf<H extends Version>(
  livrable: Version,
  byId: Map<string, H>,
): H[] {
  const history: H[] = [];
  let older = livrable.parentVersionId
    ? byId.get(livrable.parentVersionId)
    : undefined;
  while (older) {
    history.push(older);
    older = older.parentVersionId ? byId.get(older.parentVersionId) : undefined;
  }
  return history;
}

/**
 * Livrables as the frontend shows them: only the current version of each
 * (isLatest), carrying its earlier versions — most recent first, each with
 * its own decision and motif — in `history`. For a flat list already
 * holding every version (an instruction's livrables).
 */
export function groupLivrableVersions<L extends Version>(livrables: L[]) {
  const byId = new Map(livrables.map((livrable) => [livrable.id, livrable]));
  return livrables
    .filter((livrable) => livrable.isLatest)
    .map((livrable) => ({ ...livrable, history: historyOf(livrable, byId) }));
}

/**
 * Same `history`, for livrables loaded on their own (a page of current
 * versions, or one version): their earlier versions are loaded with
 * `include`.
 */
export async function withLivrableHistory<
  L extends Version & { instructionId: string },
  I extends Prisma.LivrableInclude,
>(db: Db, livrables: L[], include: I) {
  if (livrables.length === 0) return [];
  const versions = (await db.livrable.findMany({
    where: {
      instructionId: {
        in: [...new Set(livrables.map((l) => l.instructionId))],
      },
    },
    include,
    orderBy: { version: 'desc' },
  })) as Prisma.LivrableGetPayload<{ include: I }>[];
  const byId = new Map(versions.map((version) => [version.id, version]));
  return livrables.map((livrable) => ({
    ...livrable,
    history: historyOf(livrable, byId),
  }));
}
