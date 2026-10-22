import { Prisma } from '../../../generated/prisma/client';

type Db = Prisma.TransactionClient;

type Version = {
  id: string;
  parentVersionId: string | null;
  isLatest: boolean;
};

// A livrable's latest supervisor decision, with its motif when rejected.
export const lastLivrableValidation = {
  orderBy: { decidedAt: 'desc' },
  take: 1,
  select: {
    decision: true,
    motif: true,
    decidedAt: true,
    validator: { select: { id: true, name: true } },
  },
} satisfies Prisma.Livrable$validationsArgs;

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
