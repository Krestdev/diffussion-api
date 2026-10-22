import {
  DossierConfidentiality,
  Prisma,
} from '../../../generated/prisma/client';

/**
 * Dossiers `userId` may see: every PUBLIC dossier, plus RESTRICTED ones they
 * created, are responsible for, or were granted view access to. Shared by
 * the dossier list and the dashboard counts so both apply the same rule.
 */
export function visibleDossierWhere(userId: string): Prisma.DossierWhereInput {
  return {
    OR: [
      { confidentiality: DossierConfidentiality.PUBLIC },
      { createdById: userId },
      { responsibleId: userId },
      { accesses: { some: { userId, canView: true } } },
    ],
  };
}
