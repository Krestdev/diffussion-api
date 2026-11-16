import { Prisma } from '../generated/prisma/client';

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

/**
 * The journal's tabs (as EXPENZO's « Journal d'audit »): « Documents » (effets,
 * instructions, dossiers, fiches), « Décisions » (approvals, dispatching),
 * « Paramètres » (settings, referentials and anything else) and « Accès et
 * sécurité » (roles, delegations, who may open what). Unlike the categories,
 * every entry falls in exactly one tab.
 */
export const AUDIT_TABS = [
  'DOCUMENT',
  'DECISION',
  'SETTINGS',
  'ACCESS',
] as const;
export type AuditTab = (typeof AUDIT_TABS)[number];

/** What a category matches: exact actions, action prefixes, kinds of object (any case). */
type CategorySpec = {
  actions?: string[];
  prefixes?: string[];
  types?: string[];
};

const SPECS: Record<AuditCategory, CategorySpec> = {
  // Decisions: an effet or a livrable validated / sent back, a dispatching
  // validated, a fiche's opinion pronounced.
  approval: {
    actions: [
      'COURRIER_VALIDE',
      'COURRIER_CORRECTIONS_DEMANDEES',
      'COURRIER_DISPATCH_VALIDE',
      'INSTRUCTION_LIVRABLE_VALIDE',
      'INSTRUCTION_CORRECTION_DEMANDEE',
      'INSTRUCTION_AVIS_DONNE',
      'analysis-sheet.decided',
    ],
  },
  dispatching: {
    actions: [
      'COURRIER_DISPATCHE',
      'COURRIER_DISPATCH_PROPOSE',
      'COURRIER_DISPATCH_VALIDE',
      'COURRIER_SUPERVISEUR_AFFECTE',
      'COURRIER_TRANSMIS',
    ],
    // A dispatching proposed, validated or sent back.
    prefixes: ['COURRIER_DISPATCH'],
  },
  instruction: { types: ['Instruction', 'livrable'] },
  courrier: { types: ['Courrier'] },
  // Dossiers, and the projects and contracts they sit in.
  file: { types: ['dossier', 'project', 'contract', 'document'] },
  analysis: {
    types: ['analysis-sheet', 'analysis-criterion-template'],
    prefixes: ['analysis-'],
  },
  // Who may do what: roles, their grants, profiles, delegations, and the
  // lists of who may open a dossier / project / contract.
  permissions: {
    types: ['role', 'delegation', 'permission'],
    prefixes: ['role.', 'delegation.', 'permission.', 'user.roles.'],
    actions: [
      'user.access-profile.updated',
      'project.access.updated',
      'contract.access.updated',
      'dossier.access-updated',
    ],
  },
  // Settings and referentials.
  settings: {
    actions: ['settings.updated', 'analysis-settings.updated'],
    types: [
      'settings',
      'company',
      'category',
      'canal',
      'correspondent',
      'correspondent-type',
      'courrier-nature',
      'effet-type',
    ],
  },
};

const merged = (categories: readonly AuditCategory[]) => ({
  actions: categories.flatMap((c) => SPECS[c].actions ?? []),
  prefixes: categories.flatMap((c) => SPECS[c].prefixes ?? []),
  types: categories.flatMap((c) => SPECS[c].types ?? []),
});

const typeIs = (type: string): Prisma.ActivityLogWhereInput => ({
  entityType: { equals: type, mode: 'insensitive' as const },
});

/** The entries of any of `categories`. */
export function categoriesWhere(
  categories: readonly AuditCategory[],
): Prisma.ActivityLogWhereInput {
  const { actions, prefixes, types } = merged(categories);
  return {
    OR: [
      ...(actions.length ? [{ action: { in: actions } }] : []),
      ...prefixes.map((prefix) => ({ action: { startsWith: prefix } })),
      ...types.map(typeIs),
    ],
  };
}

/**
 * The entries of none of `categories`. Written out rather than NOT(OR …):
 * a comparison with an empty entityType is NULL in SQL, and NOT NULL would
 * leave out every entry without an object.
 */
function outsideWhere(
  categories: readonly AuditCategory[],
): Prisma.ActivityLogWhereInput {
  const { actions, prefixes, types } = merged(categories);
  return {
    AND: [
      ...(actions.length ? [{ action: { notIn: actions } }] : []),
      ...prefixes.map((prefix) => ({
        NOT: { action: { startsWith: prefix } },
      })),
      ...(types.length
        ? [
            {
              OR: [
                { entityType: null },
                { AND: types.map((type) => ({ NOT: typeIs(type) })) },
              ],
            },
          ]
        : []),
    ],
  };
}

const DECISION: AuditCategory[] = ['approval', 'dispatching'];
const DOCUMENT: AuditCategory[] = [
  'instruction',
  'courrier',
  'file',
  'analysis',
];

/** The entries of a tab (see AUDIT_TABS): the same split as tabOf. */
export function tabWhere(tab: AuditTab): Prisma.ActivityLogWhereInput {
  switch (tab) {
    case 'DECISION':
      return categoriesWhere(DECISION);
    case 'ACCESS':
      return {
        AND: [categoriesWhere(['permissions']), outsideWhere(DECISION)],
      };
    case 'DOCUMENT':
      return {
        AND: [
          categoriesWhere(DOCUMENT),
          outsideWhere([...DECISION, 'permissions']),
        ],
      };
    case 'SETTINGS':
      return outsideWhere([...DECISION, 'permissions', ...DOCUMENT]);
  }
}

/** The first category an entry falls in, for the journal's column. */
export function categoryOf(log: {
  action: string;
  entityType: string | null;
}): AuditCategory | null {
  const type = log.entityType?.toLowerCase() ?? '';
  const a = log.action;
  const matches = (category: AuditCategory) => {
    const spec = SPECS[category];
    return (
      (spec.actions ?? []).includes(a) ||
      (spec.prefixes ?? []).some((prefix) => a.startsWith(prefix)) ||
      (spec.types ?? []).some((t) => t.toLowerCase() === type)
    );
  };
  return (
    (
      [
        'approval',
        'dispatching',
        'permissions',
        'instruction',
        'courrier',
        'file',
        'analysis',
        'settings',
      ] as const
    ).find(matches) ?? null
  );
}

/** The tab an entry is shown in (every entry has one). */
export function tabOf(log: {
  action: string;
  entityType: string | null;
}): AuditTab {
  switch (categoryOf(log)) {
    case 'approval':
    case 'dispatching':
      return 'DECISION';
    case 'permissions':
      return 'ACCESS';
    case 'instruction':
    case 'courrier':
    case 'file':
    case 'analysis':
      return 'DOCUMENT';
    default:
      return 'SETTINGS';
  }
}
