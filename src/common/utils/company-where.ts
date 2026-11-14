import { Prisma } from '../../../generated/prisma/client';

type SiteFilter = string | { in: string[] };

// Prisma filters for "belongs to this site", following the rule of
// RbacService.resolveSiteId. Each one is an OR: put it inside an AND.

/** An effet's site: its dossier's, else its registrant's. */
export function courrierOfSite(siteId: SiteFilter): Prisma.CourrierWhereInput {
  return {
    OR: [{ dossier: { siteId } }, { dossierId: null, createdBy: { siteId } }],
  };
}

/** A task's site: its dossier's, else its effet's, else its contract's project's. */
export function taskOfSite(siteId: SiteFilter): Prisma.InstructionWhereInput {
  return {
    OR: [
      { dossier: { siteId } },
      { dossierId: null, courrier: courrierOfSite(siteId) },
      {
        dossierId: null,
        courrierId: null,
        contract: { project: { siteId } },
      },
    ],
  };
}
