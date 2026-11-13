import { Prisma } from '../../generated/prisma/client';

/**
 * The categories of the audit journal's filter (AU·1). Each matches entries
 * by their action and/or the kind of object they are about; a category may
 * overlap another (an approval of an effet is also about a courrier).
 */
export const AUDIT_CATEGORIES = [
  'approval',
  'dispatching',
  'instruction',
  'courrier',
  'file',
  'analysis',
  'permissions',
  'settings',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

const actions = (...names: string[]): Prisma.ActivityLogWhereInput => ({
  action: { in: names },
});
const startsWith = (...prefixes: string[]): Prisma.ActivityLogWhereInput[] =>
  prefixes.map((prefix) => ({ action: { startsWith: prefix } }));
const about = (...types: string[]): Prisma.ActivityLogWhereInput[] =>
  types.map((type) => ({
    entityType: { equals: type, mode: 'insensitive' as const },
  }));

const CATEGORY_WHERE: Record<AuditCategory, Prisma.ActivityLogWhereInput> = {
  // Decisions: an effet or a livrable validated / sent back, a dispatching
  // validated, a fiche's opinion pronounced.
  approval: {
    OR: [
      actions(
        'COURRIER_VALIDE',
        'COURRIER_CORRECTIONS_DEMANDEES',
        'COURRIER_DISPATCH_VALIDE',
        'INSTRUCTION_LIVRABLE_VALIDE',
        'INSTRUCTION_CORRECTION_DEMANDEE',
        'INSTRUCTION_AVIS_DONNE',
        'analysis-sheet.decided',
      ),
    ],
  },
  dispatching: {
    OR: [
      actions(
        'COURRIER_DISPATCHE',
        'COURRIER_DISPATCH_PROPOSE',
        'COURRIER_DISPATCH_VALIDE',
        'COURRIER_SUPERVISEUR_AFFECTE',
        'COURRIER_TRANSMIS',
      ),
    ],
  },
  instruction: { OR: [...about('Instruction', 'livrable')] },
  courrier: { OR: [...about('Courrier')] },
  // Dossiers, and the projects and contracts they sit in.
  file: { OR: [...about('dossier', 'project', 'contract', 'document')] },
  analysis: {
    OR: [
      ...about('analysis-sheet', 'analysis-criterion-template'),
      ...startsWith('analysis-'),
    ],
  },
  // Who may do what: roles, their grants, profiles, delegations, and the
  // lists of who may open a dossier / project / contract.
  permissions: {
    OR: [
      ...about('role', 'delegation', 'permission'),
      ...startsWith('role.', 'delegation.', 'permission.', 'user.roles.'),
      actions(
        'user.access-profile.updated',
        'project.access.updated',
        'contract.access.updated',
        'dossier.access-updated',
      ),
    ],
  },
  // Settings and referentials.
  settings: {
    OR: [
      actions('settings.updated', 'analysis-settings.updated'),
      ...about(
        'settings',
        'site',
        'category',
        'canal',
        'correspondent',
        'correspondent-type',
        'courrier-nature',
        'effet-type',
      ),
    ],
  },
};

/** The entries of any of `categories`. */
export function categoriesWhere(
  categories: AuditCategory[],
): Prisma.ActivityLogWhereInput {
  return { OR: categories.map((category) => CATEGORY_WHERE[category]) };
}

/** The first category an entry falls in, for the journal's column. */
export function categoryOf(log: {
  action: string;
  entityType: string | null;
}): AuditCategory | null {
  const type = log.entityType?.toLowerCase() ?? '';
  const a = log.action;
  if (
    [
      'COURRIER_VALIDE',
      'COURRIER_CORRECTIONS_DEMANDEES',
      'COURRIER_DISPATCH_VALIDE',
      'INSTRUCTION_LIVRABLE_VALIDE',
      'INSTRUCTION_CORRECTION_DEMANDEE',
      'INSTRUCTION_AVIS_DONNE',
      'analysis-sheet.decided',
    ].includes(a)
  ) {
    return 'approval';
  }
  if (
    a.startsWith('COURRIER_DISPATCH') ||
    a === 'COURRIER_SUPERVISEUR_AFFECTE' ||
    a === 'COURRIER_TRANSMIS'
  ) {
    return 'dispatching';
  }
  if (
    ['role', 'delegation', 'permission'].includes(type) ||
    a.startsWith('user.roles.') ||
    a === 'user.access-profile.updated' ||
    a.endsWith('access.updated') ||
    a === 'dossier.access-updated'
  ) {
    return 'permissions';
  }
  if (type === 'instruction' || type === 'livrable') return 'instruction';
  if (type === 'courrier') return 'courrier';
  if (['dossier', 'project', 'contract', 'document'].includes(type)) {
    return 'file';
  }
  if (type.startsWith('analysis-') || a.startsWith('analysis-')) {
    return 'analysis';
  }
  if (
    a === 'settings.updated' ||
    [
      'settings',
      'site',
      'category',
      'canal',
      'correspondent',
      'correspondent-type',
      'courrier-nature',
      'effet-type',
    ].includes(type)
  ) {
    return 'settings';
  }
  return null;
}
