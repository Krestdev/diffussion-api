/**
 * Catalogue of Diffusion's permission codes (2.0.0, 2026-11-14), the way EXPENZO does it: one
 * code per kind of record to read it, and one per controlled change (each create, edit, archive
 * and workflow step). Roles belong to one company and grant a subset; routes and services check
 * them server-side (PermissionsGuard, can/assertCan).
 *
 * Diffusion owns its roles: they are managed from Diffusion's administration or from the core's
 * console through Diffusion's app-admin API, which serves this catalogue. People and companies stay
 * the core's: Diffusion only copies them (DirectorySyncService).
 *
 * 1.x were the UPPER_SNAKE codes (COURRIER_READ, ADMIN_MANAGE_ROLES…): REPLACES_2_0_0 maps each
 * of them to the codes that now cover it.
 */
export const Permission = {
  // Effets (entrants and sortants together)
  EFFECT_READ_ALL: 'effect.read.all',
  // Effets entrants
  INCOMING_READ: 'incoming.read',
  INCOMING_CREATE: 'incoming.create',
  INCOMING_UPDATE: 'incoming.update',
  INCOMING_UPDATE_DRAFT: 'incoming.update.draft',
  INCOMING_DISPATCH: 'incoming.dispatch',
  INCOMING_DISPATCH_VALIDATE: 'incoming.dispatch.validate',
  INCOMING_CLOSE: 'incoming.close',
  INCOMING_ARCHIVE: 'incoming.archive',
  // Effets sortants
  OUTGOING_READ: 'outgoing.read',
  OUTGOING_CREATE: 'outgoing.create',
  OUTGOING_UPDATE: 'outgoing.update',
  OUTGOING_APPROVE: 'outgoing.approve',
  OUTGOING_SEND: 'outgoing.send',
  OUTGOING_ARCHIVE: 'outgoing.archive',
  // Dossiers
  DOSSIER_READ: 'dossier.read',
  DOSSIER_CREATE: 'dossier.create',
  DOSSIER_UPDATE: 'dossier.update',
  DOSSIER_CLOSE: 'dossier.close',
  DOSSIER_REOPEN: 'dossier.reopen',
  DOSSIER_ARCHIVE: 'dossier.archive',
  // Contracts
  CONTRACT_READ: 'contract.read',
  CONTRACT_CREATE: 'contract.create',
  CONTRACT_UPDATE: 'contract.update',
  CONTRACT_ARCHIVE: 'contract.archive',
  // Correspondents
  CORRESPONDENT_READ: 'correspondent.read',
  CORRESPONDENT_CREATE: 'correspondent.create',
  CORRESPONDENT_UPDATE: 'correspondent.update',
  CORRESPONDENT_ARCHIVE: 'correspondent.archive',
  // Projects (read-only copies of the core's, plus Diffusion's own fields)
  PROJECT_READ: 'project.read',
  // Diffusion's own settings of a project (contents, mode, maître d'ouvrage); since 2.1.0 the
  // core's console creates, edits, suspends, closes and deletes projects.
  PROJECT_UPDATE: 'project.update',
  // Analysis sheets
  ANALYSIS_READ: 'analysis.read',
  ANALYSIS_CREATE: 'analysis.create',
  ANALYSIS_UPDATE: 'analysis.update',
  ANALYSIS_APPROVE: 'analysis.approve',
  ANALYSIS_ARCHIVE: 'analysis.archive',
  // Instructions (tasks)
  INSTRUCTION_READ: 'instruction.read',
  INSTRUCTION_CREATE: 'instruction.create',
  INSTRUCTION_ASSIGN: 'instruction.assign',
  INSTRUCTION_REASSIGN: 'instruction.reassign',
  INSTRUCTION_UPDATE: 'instruction.update',
  INSTRUCTION_ACCEPT: 'instruction.accept',
  INSTRUCTION_REFUSE: 'instruction.refuse',
  INSTRUCTION_CANCEL: 'instruction.cancel',
  INSTRUCTION_CLOSE: 'instruction.close',
  // Deliverables
  DELIVERABLE_READ: 'deliverable.read',
  DELIVERABLE_CREATE: 'deliverable.create',
  DELIVERABLE_UPDATE: 'deliverable.update',
  DELIVERABLE_SUBMIT: 'deliverable.submit',
  DELIVERABLE_DOWNLOAD: 'deliverable.download',
  // Validation of deliverables
  VALIDATION_VERIFY: 'validation.verify',
  VALIDATION_APPROVE: 'validation.approve',
  VALIDATION_REJECT: 'validation.reject',
  VALIDATION_RETURN: 'validation.return',
  // Organisation
  USER_READ: 'user.read',
  ROLE_READ: 'role.read',
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_ARCHIVE: 'role.archive',
  ROLE_ASSIGN: 'role.assign',
  SETTINGS_READ: 'settings.read',
  SETTINGS_UPDATE: 'settings.update',
  COMPANY_READ: 'company.read',
  COMPANY_UPDATE: 'company.update',
  AUDIT_READ: 'audit.read',
  DASHBOARD_READ_ALL: 'dashboard.read.all',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const P = Permission;

const DESCRIPTIONS: Record<Permission, string> = {
  [P.EFFECT_READ_ALL]:
    'View every effet of the company, not only those one is authorised on (CDC « Consultation globale »)',
  [P.INCOMING_READ]: 'View incoming effets',
  [P.INCOMING_CREATE]: 'Register incoming effets',
  [P.INCOMING_UPDATE]: 'Edit incoming effets',
  [P.INCOMING_UPDATE_DRAFT]: 'Edit incoming effets still in draft',
  [P.INCOMING_DISPATCH]: 'Dispatch incoming effets directly',
  [P.INCOMING_DISPATCH_VALIDATE]: 'Validate proposed dispatchings',
  [P.INCOMING_CLOSE]: 'Close any incoming effet',
  [P.INCOMING_ARCHIVE]: 'Archive and restore incoming effets',
  [P.OUTGOING_READ]: 'View outgoing effets',
  [P.OUTGOING_CREATE]: 'Draft outgoing effets',
  [P.OUTGOING_UPDATE]: 'Edit outgoing effets in draft',
  [P.OUTGOING_APPROVE]: 'Approve outgoing effets',
  [P.OUTGOING_SEND]:
    'Sign outgoing effets, send them under a bordereau and record their discharge',
  [P.OUTGOING_ARCHIVE]: 'Archive and restore outgoing effets',
  [P.DOSSIER_READ]: 'View dossiers',
  [P.DOSSIER_CREATE]: 'Create dossiers',
  [P.DOSSIER_UPDATE]: 'Edit dossiers',
  [P.DOSSIER_CLOSE]: 'Close dossiers',
  [P.DOSSIER_REOPEN]: 'Reopen closed dossiers',
  [P.DOSSIER_ARCHIVE]: 'Archive and restore dossiers',
  [P.CONTRACT_READ]: 'View contracts',
  [P.CONTRACT_CREATE]: 'Create contracts',
  [P.CONTRACT_UPDATE]: 'Edit contracts',
  [P.CONTRACT_ARCHIVE]: 'Archive and restore contracts',
  [P.CORRESPONDENT_READ]: 'View correspondents',
  [P.CORRESPONDENT_CREATE]: 'Create correspondents',
  [P.CORRESPONDENT_UPDATE]: 'Edit correspondents',
  [P.CORRESPONDENT_ARCHIVE]: 'Archive and restore correspondents',
  [P.PROJECT_READ]: 'View projects',
  [P.PROJECT_UPDATE]:
    "Set Diffusion's settings of a project (what it holds, mode, maître d'ouvrage)",
  [P.ANALYSIS_READ]: 'View analysis sheets',
  [P.ANALYSIS_CREATE]: 'Create analysis sheets',
  [P.ANALYSIS_UPDATE]: 'Edit analysis sheets',
  [P.ANALYSIS_APPROVE]:
    'Pronounce the decision of an analysis sheet and sign it',
  [P.ANALYSIS_ARCHIVE]: 'Archive and restore analysis sheets',
  [P.INSTRUCTION_READ]: 'View instructions',
  [P.INSTRUCTION_CREATE]: 'Create instructions',
  [P.INSTRUCTION_ASSIGN]: 'Assign instructions',
  [P.INSTRUCTION_REASSIGN]: 'Reassign instructions',
  [P.INSTRUCTION_UPDATE]: 'Edit instructions',
  [P.INSTRUCTION_ACCEPT]: 'Accept an instruction',
  [P.INSTRUCTION_REFUSE]: 'Refuse an instruction',
  [P.INSTRUCTION_CANCEL]: 'Cancel instructions',
  [P.INSTRUCTION_CLOSE]: 'Close instructions',
  [P.DELIVERABLE_READ]: 'View deliverables',
  [P.DELIVERABLE_CREATE]: 'Deposit deliverables',
  [P.DELIVERABLE_UPDATE]: 'Deposit a new version of a deliverable',
  [P.DELIVERABLE_SUBMIT]: 'Submit deliverables for validation',
  [P.DELIVERABLE_DOWNLOAD]: 'Download deliverables',
  [P.VALIDATION_VERIFY]: 'Verify deliverables',
  [P.VALIDATION_APPROVE]: 'Approve deliverables',
  [P.VALIDATION_REJECT]: 'Reject deliverables',
  [P.VALIDATION_RETURN]: 'Return deliverables for corrections',
  [P.USER_READ]: "View the company's users",
  [P.ROLE_READ]: 'View roles and their permissions',
  [P.ROLE_CREATE]: 'Create roles',
  [P.ROLE_UPDATE]:
    "Rename roles, change their permissions or restore a default role's",
  [P.ROLE_ARCHIVE]: 'Archive and restore roles',
  [P.ROLE_ASSIGN]: 'Give roles to people',
  [P.SETTINGS_READ]: 'View the settings and referentials',
  [P.SETTINGS_UPDATE]:
    'Change the settings and referentials (canals, types, categories, analysis criteria)',
  [P.COMPANY_READ]: 'View the company',
  [P.COMPANY_UPDATE]: "Change the company's city and responsible",
  [P.AUDIT_READ]: "View the company's audit journal",
  [P.DASHBOARD_READ_ALL]:
    "View the company's dashboards, not only one's own figures",
};

export const PERMISSION_CATALOG: readonly {
  code: Permission;
  description: string;
}[] = (Object.values(Permission) as Permission[]).map((code) => ({
  code,
  description: DESCRIPTIONS[code],
}));

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_CATALOG.map(
  (p) => p.code,
);

/**
 * The reads each action needs: a role always holds them with the action (one way: a read can be
 * held alone).
 */
export const IMPLIES: Partial<Record<Permission, readonly Permission[]>> = {
  [P.EFFECT_READ_ALL]: [P.INCOMING_READ, P.OUTGOING_READ],
  [P.INCOMING_CREATE]: [P.INCOMING_READ, P.CORRESPONDENT_READ],
  [P.INCOMING_UPDATE]: [P.INCOMING_READ],
  [P.INCOMING_UPDATE_DRAFT]: [P.INCOMING_READ],
  [P.INCOMING_DISPATCH]: [P.INCOMING_READ, P.CONTRACT_READ, P.DOSSIER_READ],
  [P.INCOMING_DISPATCH_VALIDATE]: [P.INCOMING_READ],
  [P.INCOMING_CLOSE]: [P.INCOMING_READ],
  [P.INCOMING_ARCHIVE]: [P.INCOMING_READ],
  [P.OUTGOING_CREATE]: [P.OUTGOING_READ],
  [P.OUTGOING_UPDATE]: [P.OUTGOING_READ],
  [P.OUTGOING_APPROVE]: [P.OUTGOING_READ],
  [P.OUTGOING_SEND]: [P.OUTGOING_READ],
  [P.OUTGOING_ARCHIVE]: [P.OUTGOING_READ],
  [P.DOSSIER_CREATE]: [P.DOSSIER_READ],
  [P.DOSSIER_UPDATE]: [P.DOSSIER_READ],
  [P.DOSSIER_CLOSE]: [P.DOSSIER_READ],
  [P.DOSSIER_REOPEN]: [P.DOSSIER_READ],
  [P.DOSSIER_ARCHIVE]: [P.DOSSIER_READ],
  [P.CONTRACT_CREATE]: [P.CONTRACT_READ],
  [P.CONTRACT_UPDATE]: [P.CONTRACT_READ],
  [P.CONTRACT_ARCHIVE]: [P.CONTRACT_READ],
  [P.CORRESPONDENT_CREATE]: [P.CORRESPONDENT_READ],
  [P.CORRESPONDENT_UPDATE]: [P.CORRESPONDENT_READ],
  [P.CORRESPONDENT_ARCHIVE]: [P.CORRESPONDENT_READ],
  [P.PROJECT_UPDATE]: [P.PROJECT_READ],
  [P.ANALYSIS_CREATE]: [P.ANALYSIS_READ],
  [P.ANALYSIS_UPDATE]: [P.ANALYSIS_READ],
  [P.ANALYSIS_APPROVE]: [P.ANALYSIS_READ],
  [P.ANALYSIS_ARCHIVE]: [P.ANALYSIS_READ],
  [P.INSTRUCTION_CREATE]: [P.INSTRUCTION_READ],
  [P.INSTRUCTION_ASSIGN]: [P.INSTRUCTION_READ],
  [P.INSTRUCTION_REASSIGN]: [P.INSTRUCTION_READ],
  [P.INSTRUCTION_UPDATE]: [P.INSTRUCTION_READ],
  [P.INSTRUCTION_ACCEPT]: [P.INSTRUCTION_READ],
  [P.INSTRUCTION_REFUSE]: [P.INSTRUCTION_READ],
  [P.INSTRUCTION_CANCEL]: [P.INSTRUCTION_READ],
  [P.INSTRUCTION_CLOSE]: [P.INSTRUCTION_READ],
  [P.DELIVERABLE_CREATE]: [P.DELIVERABLE_READ],
  [P.DELIVERABLE_UPDATE]: [P.DELIVERABLE_READ],
  [P.DELIVERABLE_SUBMIT]: [P.DELIVERABLE_READ],
  [P.DELIVERABLE_DOWNLOAD]: [P.DELIVERABLE_READ],
  [P.VALIDATION_VERIFY]: [P.DELIVERABLE_READ],
  [P.VALIDATION_APPROVE]: [P.DELIVERABLE_READ],
  [P.VALIDATION_REJECT]: [P.DELIVERABLE_READ],
  [P.VALIDATION_RETURN]: [P.DELIVERABLE_READ],
  [P.ROLE_CREATE]: [P.ROLE_READ],
  [P.ROLE_UPDATE]: [P.ROLE_READ],
  [P.ROLE_ARCHIVE]: [P.ROLE_READ],
  [P.ROLE_ASSIGN]: [P.ROLE_READ, P.USER_READ],
  [P.SETTINGS_UPDATE]: [P.SETTINGS_READ],
  [P.COMPANY_UPDATE]: [P.COMPANY_READ],
};

/** Actions with no read of their own (none in Diffusion). */
export const ACTIONS_WITHOUT_READ: readonly Permission[] = [];

/** This catalogue's version (stored on each company's roles, sent to the core's console). */
export const CATALOG_VERSION = '2.1.0';

/** The catalogue a company's roles follow before any upgrade (the UPPER_SNAKE codes). */
export const FIRST_CATALOG_VERSION = '1.0.0';

/**
 * How each version changes the codes of the one before, applied once to every company's roles
 * when it moves to that version (Company.permissionsVersion): a withdrawn code becomes the codes
 * that now cover it. The migration 20261121090000_permissions_v2 applied 2.0.0 to the tables,
 * 20261123110000_core_projects removed the codes 2.1.0 withdraws.
 */
const REPLACES_2_0_0: Readonly<Record<string, readonly Permission[]>> = {
  COURRIER_READ: [P.INCOMING_READ, P.OUTGOING_READ],
  COURRIER_READ_ALL: [P.EFFECT_READ_ALL],
  COURRIER_REGISTER_ENTRANT: [P.INCOMING_CREATE],
  COURRIER_UPDATE_DRAFT: [P.INCOMING_UPDATE_DRAFT],
  COURRIER_UPDATE: [P.INCOMING_UPDATE],
  COURRIER_DISPATCH: [P.INCOMING_DISPATCH],
  COURRIER_DISPATCH_VALIDATE: [P.INCOMING_DISPATCH_VALIDATE],
  COURRIER_CLOSE: [P.INCOMING_CLOSE],
  COURRIER_ARCHIVE: [P.INCOMING_ARCHIVE, P.OUTGOING_ARCHIVE],
  // Writing a sortant included editing one's drafts.
  COURRIER_WRITE_SORTANT: [P.OUTGOING_CREATE, P.OUTGOING_UPDATE],
  COURRIER_APPROVE: [P.OUTGOING_APPROVE],
  COURRIER_SEND: [P.OUTGOING_SEND],
  DOSSIER_READ: [P.DOSSIER_READ],
  DOSSIER_CREATE: [P.DOSSIER_CREATE],
  DOSSIER_UPDATE: [P.DOSSIER_UPDATE],
  DOSSIER_CLOSE: [P.DOSSIER_CLOSE],
  DOSSIER_REOPEN: [P.DOSSIER_REOPEN],
  DOSSIER_ARCHIVE: [P.DOSSIER_ARCHIVE],
  CONTRACT_READ: [P.CONTRACT_READ],
  CONTRACT_CREATE: [P.CONTRACT_CREATE],
  CONTRACT_UPDATE: [P.CONTRACT_UPDATE],
  CONTRACT_ARCHIVE: [P.CONTRACT_ARCHIVE],
  CORRESPONDENT_READ: [P.CORRESPONDENT_READ],
  CORRESPONDENT_CREATE: [P.CORRESPONDENT_CREATE],
  CORRESPONDENT_UPDATE: [P.CORRESPONDENT_UPDATE],
  CORRESPONDENT_ARCHIVE: [P.CORRESPONDENT_ARCHIVE],
  PROJECT_READ: [P.PROJECT_READ],
  // Became project.create and project.archive, withdrawn in 2.1.0.
  PROJECT_CREATE: [],
  PROJECT_UPDATE: [P.PROJECT_UPDATE],
  PROJECT_ARCHIVE: [],
  ANALYSIS_READ: [P.ANALYSIS_READ],
  ANALYSIS_CREATE: [P.ANALYSIS_CREATE],
  ANALYSIS_UPDATE: [P.ANALYSIS_UPDATE],
  ANALYSIS_DECIDE: [P.ANALYSIS_APPROVE],
  ANALYSIS_ARCHIVE: [P.ANALYSIS_ARCHIVE],
  INSTRUCTION_CREATE: [P.INSTRUCTION_CREATE],
  INSTRUCTION_ASSIGN: [P.INSTRUCTION_ASSIGN],
  INSTRUCTION_REASSIGN: [P.INSTRUCTION_REASSIGN],
  INSTRUCTION_UPDATE: [P.INSTRUCTION_UPDATE],
  INSTRUCTION_ACCEPT: [P.INSTRUCTION_ACCEPT],
  INSTRUCTION_REFUSE: [P.INSTRUCTION_REFUSE],
  INSTRUCTION_CANCEL: [P.INSTRUCTION_CANCEL],
  INSTRUCTION_CLOSE: [P.INSTRUCTION_CLOSE],
  LIVRABLE_READ: [P.DELIVERABLE_READ],
  LIVRABLE_DEPOSIT: [P.DELIVERABLE_CREATE],
  LIVRABLE_NEW_VERSION: [P.DELIVERABLE_UPDATE],
  LIVRABLE_SUBMIT: [P.DELIVERABLE_SUBMIT],
  LIVRABLE_DOWNLOAD: [P.DELIVERABLE_DOWNLOAD],
  VALIDATION_VERIFY: [P.VALIDATION_VERIFY],
  VALIDATION_APPROVE: [P.VALIDATION_APPROVE],
  VALIDATION_REJECT: [P.VALIDATION_REJECT],
  VALIDATION_REQUEST_CORRECTIONS: [P.VALIDATION_RETURN],
  USERS_READ: [P.USER_READ],
  ADMIN_MANAGE_USERS: [P.ROLE_ASSIGN],
  ROLES_READ: [P.ROLE_READ],
  ROLES_CREATE: [P.ROLE_CREATE],
  ROLES_ARCHIVE: [P.ROLE_ARCHIVE],
  ADMIN_MANAGE_ROLES: [P.ROLE_CREATE, P.ROLE_UPDATE, P.ROLE_ARCHIVE],
  SETTINGS_READ: [P.SETTINGS_READ],
  ADMIN_MANAGE_SETTINGS: [P.SETTINGS_UPDATE],
  ADMIN_MANAGE_REFERENTIALS: [P.SETTINGS_UPDATE],
  ADMIN_MANAGE_CATEGORIES: [P.SETTINGS_UPDATE],
  ADMIN_MANAGE_ANALYSIS_CRITERIA: [P.SETTINGS_UPDATE],
  ADMIN_MANAGE_COMPANIES: [P.COMPANY_UPDATE],
  AUDIT_READ: [P.AUDIT_READ],
  DASHBOARD_GLOBAL_READ: [P.DASHBOARD_READ_ALL],
};

/**
 * 2.1.0 (2026-11-23): projects come from the CREAPP core, as EXPENZO's since its 3.2.0: they are
 * created, suspended, closed and deleted in the core's console, Diffusion keeps read-only copies.
 * project.create and project.archive are withdrawn with nothing in their place; project.read stays
 * and project.update now only sets Diffusion's own settings of a project.
 */
const REPLACES_2_1_0: Readonly<Record<string, readonly Permission[]>> = {
  'project.create': [],
  'project.archive': [],
};

/** Every version's changes, oldest first. */
export const UPGRADES: readonly {
  version: string;
  replaces: Readonly<Record<string, readonly Permission[]>>;
}[] = [
  { version: '2.0.0', replaces: REPLACES_2_0_0 },
  { version: CATALOG_VERSION, replaces: REPLACES_2_1_0 },
];

/** -1, 0 or 1 as version `a` is before, equal to or after `b` (major.minor.patch). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const [m, n] = [x[i] ?? 0, y[i] ?? 0];
    if (m !== n) return m < n ? -1 : 1;
  }
  return 0;
}

const KNOWN = new Set<string>(ALL_PERMISSIONS);

/** Whether a code is in this catalogue. */
export const isPermission = (code: string): code is Permission =>
  KNOWN.has(code);

/**
 * A role's codes as this version understands them: every action with the reads it implies,
 * unknown codes dropped. `from`: the catalogue version the codes were written for; each later
 * version's changes apply first, in order (absent: the codes are current).
 */
export function normalizePermissions(
  codes: Iterable<string>,
  options: { from?: string | null } = {},
): Permission[] {
  const held = new Set<string>(codes);
  if (options.from) {
    for (const upgrade of UPGRADES) {
      if (compareVersions(upgrade.version, options.from) <= 0) continue;
      for (const code of [...held]) {
        upgrade.replaces[code]?.forEach((next) => held.add(next));
      }
    }
  }
  const wanted = new Set<string>();
  const add = (code: string) => {
    if (wanted.has(code)) return;
    wanted.add(code);
    (IMPLIES[code as Permission] ?? []).forEach(add);
  };
  for (const code of held) if (KNOWN.has(code)) add(code);
  return ALL_PERMISSIONS.filter((code) => wanted.has(code));
}

/**
 * The protected system role of each company: every permission, future ones too (CDC G1), never
 * edited nor archived. The company's administrators (the core's tenantAdmin) hold it.
 */
export const ADMIN_ROLE_CODE = 'ADMIN';

/** A default role: created for every company, restorable to these codes. */
export interface DefaultRole {
  /** Stable key; the role's code is its upper-case form (roleCodeOf). */
  key: string;
  /** Names in the company's language. */
  names: Readonly<Record<'en' | 'fr' | 'it', string>>;
  description: string;
  permissions: readonly Permission[];
}

/** A default role's code, e.g. admin-dispatcher → ADMIN_DISPATCHER. */
export const roleCodeOf = (key: string) =>
  key.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

/** The name of a default role in a language (French when the language has none). */
export const defaultRoleName = (role: DefaultRole, language: string) =>
  role.names[language as keyof DefaultRole['names']] ?? role.names.fr;

const defaultRole = (
  key: string,
  names: DefaultRole['names'],
  description: string,
  codes: readonly string[],
): DefaultRole => ({
  key,
  names,
  description,
  permissions: normalizePermissions(codes),
});

/** What every reception desk needs to read. */
const RECEPTION_READS: readonly Permission[] = [
  P.INCOMING_READ,
  P.OUTGOING_READ,
  P.CONTRACT_READ,
  P.CORRESPONDENT_READ,
  P.PROJECT_READ,
  P.DOSSIER_READ,
];

/**
 * The roles every company starts with (Diffusion's default company roles of 1.x, same reach).
 * The admin role always holds every permission. Its French name stays « Admin », the name the
 * company roles had before 2.0.0.
 */
export const DEFAULT_ROLES: readonly DefaultRole[] = [
  defaultRole(
    'admin',
    { en: 'Administrator', fr: 'Admin', it: 'Amministratore' },
    'Toutes les permissions de Diffusion',
    ALL_PERMISSIONS,
  ),
  defaultRole(
    'receptionist',
    { en: 'Receptionist', fr: 'Réceptionniste', it: 'Receptionist' },
    'Enregistre et corrige les effets entrants ; peut proposer un dispatching',
    [...RECEPTION_READS, P.INCOMING_CREATE, P.INCOMING_UPDATE_DRAFT],
  ),
  defaultRole(
    'dispatcher',
    { en: 'Dispatcher', fr: 'Dispatcher', it: 'Smistatore' },
    'Dispatche les effets entrants (transmis directement)',
    [...RECEPTION_READS, P.INCOMING_DISPATCH],
  ),
  defaultRole(
    'admin-dispatcher',
    {
      en: 'Dispatch administrator',
      fr: 'Admin dispatcher',
      it: 'Amministratore smistamento',
    },
    'Dispatche, valide les dispatchings proposés et corrige les effets entrants',
    [
      ...RECEPTION_READS,
      P.INCOMING_DISPATCH,
      P.INCOMING_DISPATCH_VALIDATE,
      P.INCOMING_UPDATE,
    ],
  ),
];

/** A default role's permissions by its code; undefined for a role of the company's own. */
export const defaultPermissionsOf = (
  code: string,
): readonly Permission[] | undefined =>
  code === ADMIN_ROLE_CODE
    ? ALL_PERMISSIONS
    : DEFAULT_ROLES.find((r) => roleCodeOf(r.key) === code)?.permissions;
