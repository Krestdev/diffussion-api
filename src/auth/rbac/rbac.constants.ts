// Habilitations catalogue (BAD 7.6.4) — the exhaustive set of actions that
// can be gated behind a permission. Every code must fit Permission.code
// (VarChar(50)).
export enum PermissionCode {
  // Dossiers (7.6.4.1)
  DossierCreate = 'DOSSIER_CREATE',
  DossierRead = 'DOSSIER_READ',
  DossierUpdate = 'DOSSIER_UPDATE',
  DossierClose = 'DOSSIER_CLOSE',
  DossierReopen = 'DOSSIER_REOPEN',
  DossierArchive = 'DOSSIER_ARCHIVE',

  // Courriers (7.6.4.2)
  CourrierRegisterEntrant = 'COURRIER_REGISTER_ENTRANT',
  CourrierDispatch = 'COURRIER_DISPATCH',
  CourrierDispatchValidate = 'COURRIER_DISPATCH_VALIDATE',
  CourrierWriteSortant = 'COURRIER_WRITE_SORTANT',
  CourrierUpdateDraft = 'COURRIER_UPDATE_DRAFT',
  CourrierSend = 'COURRIER_SEND',
  CourrierRead = 'COURRIER_READ',

  // Instructions (7.6.4.3)
  InstructionCreate = 'INSTRUCTION_CREATE',
  InstructionAssign = 'INSTRUCTION_ASSIGN',
  InstructionReassign = 'INSTRUCTION_REASSIGN',
  InstructionUpdate = 'INSTRUCTION_UPDATE',
  InstructionAccept = 'INSTRUCTION_ACCEPT',
  InstructionRefuse = 'INSTRUCTION_REFUSE',
  InstructionCancel = 'INSTRUCTION_CANCEL',
  InstructionClose = 'INSTRUCTION_CLOSE',

  // Livrables (7.6.4.4)
  LivrableDeposit = 'LIVRABLE_DEPOSIT',
  LivrableRead = 'LIVRABLE_READ',
  LivrableNewVersion = 'LIVRABLE_NEW_VERSION',
  LivrableSubmit = 'LIVRABLE_SUBMIT',
  LivrableDownload = 'LIVRABLE_DOWNLOAD',

  // Validation (7.6.4.5)
  ValidationVerify = 'VALIDATION_VERIFY',
  ValidationApprove = 'VALIDATION_APPROVE',
  ValidationReject = 'VALIDATION_REJECT',
  ValidationRequestCorrections = 'VALIDATION_REQUEST_CORRECTIONS',

  // Administration (7.6.4.6)
  AdminManageUsers = 'ADMIN_MANAGE_USERS',
  AdminManageSites = 'ADMIN_MANAGE_SITES',
  AdminManageCategories = 'ADMIN_MANAGE_CATEGORIES',
  AdminManageReferentials = 'ADMIN_MANAGE_REFERENTIALS',
  AdminManageRoles = 'ADMIN_MANAGE_ROLES',
  AdminManageSettings = 'ADMIN_MANAGE_SETTINGS',

  // Fiches d'analyse / Avis (module spec 10/09/2026)
  AnalysisRead = 'ANALYSIS_READ',
  AnalysisCreate = 'ANALYSIS_CREATE',
  AnalysisUpdate = 'ANALYSIS_UPDATE',
  /// Pronounce the final avis on a fiche (chef de projet).
  AnalysisDecide = 'ANALYSIS_DECIDE',
  AdminManageAnalysisCriteria = 'ADMIN_MANAGE_ANALYSIS_CRITERIA',

  // Audit (RG-AUD-*)
  AuditRead = 'AUDIT_READ',

  // Direction: the dashboard across every site (Supervision générale).
  DashboardGlobalRead = 'DASHBOARD_GLOBAL_READ',

  // The role matrix of the mock-up (Diffusion V2.1). Listed for the role
  // screens; not every route checks them yet (see the mapping in the
  // administration notes).
  ContractRead = 'CONTRACT_READ',
  ContractCreate = 'CONTRACT_CREATE',
  ContractUpdate = 'CONTRACT_UPDATE',
  ContractArchive = 'CONTRACT_ARCHIVE',
  CorrespondentRead = 'CORRESPONDENT_READ',
  CorrespondentCreate = 'CORRESPONDENT_CREATE',
  CorrespondentUpdate = 'CORRESPONDENT_UPDATE',
  CorrespondentArchive = 'CORRESPONDENT_ARCHIVE',
  ProjectRead = 'PROJECT_READ',
  ProjectCreate = 'PROJECT_CREATE',
  ProjectUpdate = 'PROJECT_UPDATE',
  ProjectArchive = 'PROJECT_ARCHIVE',
  CourrierUpdate = 'COURRIER_UPDATE',
  CourrierArchive = 'COURRIER_ARCHIVE',
  CourrierApprove = 'COURRIER_APPROVE',
  CourrierClose = 'COURRIER_CLOSE',
  CourrierReadAll = 'COURRIER_READ_ALL',
  AnalysisArchive = 'ANALYSIS_ARCHIVE',
  UsersRead = 'USERS_READ',
  RolesRead = 'ROLES_READ',
  RolesCreate = 'ROLES_CREATE',
  RolesArchive = 'ROLES_ARCHIVE',
  SettingsRead = 'SETTINGS_READ',
}

/**
 * Default label of each permission (Permission.description), shown in the
 * role screens; the code itself is the value. Seeded once — an administrator
 * may reword it afterwards (PATCH /permissions/:id).
 */
export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  [PermissionCode.DossierCreate]: 'Créer un dossier',
  [PermissionCode.DossierRead]: 'Consulter les dossiers',
  [PermissionCode.DossierUpdate]: 'Modifier un dossier',
  [PermissionCode.DossierClose]: 'Clôturer un dossier',
  [PermissionCode.DossierReopen]: 'Rouvrir un dossier',
  [PermissionCode.DossierArchive]: 'Archiver un dossier',
  [PermissionCode.CourrierRegisterEntrant]: 'Enregistrer un effet entrant',
  [PermissionCode.CourrierDispatch]: 'Dispatcher un effet entrant',
  [PermissionCode.CourrierDispatchValidate]: 'Valider un dispatching',
  [PermissionCode.CourrierWriteSortant]: 'Rédiger un effet sortant',
  [PermissionCode.CourrierUpdateDraft]: "Modifier un brouillon d'effet",
  [PermissionCode.CourrierSend]: 'Envoyer un effet sortant',
  [PermissionCode.CourrierRead]: 'Consulter les effets',
  [PermissionCode.InstructionCreate]: 'Créer une tâche',
  [PermissionCode.InstructionAssign]: 'Affecter une tâche',
  [PermissionCode.InstructionReassign]: 'Réaffecter une tâche',
  [PermissionCode.InstructionUpdate]: 'Modifier une tâche',
  [PermissionCode.InstructionAccept]: 'Souscrire à une tâche',
  [PermissionCode.InstructionRefuse]: 'Ne pas souscrire à une tâche',
  [PermissionCode.InstructionCancel]: 'Annuler une tâche',
  [PermissionCode.InstructionClose]: 'Clôturer une tâche',
  [PermissionCode.LivrableDeposit]: 'Déposer un livrable',
  [PermissionCode.LivrableRead]: 'Consulter les livrables',
  [PermissionCode.LivrableNewVersion]:
    "Déposer une nouvelle version d'un livrable",
  [PermissionCode.LivrableSubmit]: 'Soumettre un livrable à validation',
  [PermissionCode.LivrableDownload]: 'Télécharger les livrables',
  [PermissionCode.ValidationApprove]: 'Approuver les livrables',
  [PermissionCode.ValidationVerify]: 'Vérifier les livrables',
  [PermissionCode.ValidationReject]: 'Rejeter un livrable',
  [PermissionCode.ValidationRequestCorrections]:
    'Demander des corrections sur une tâche',
  [PermissionCode.AdminManageUsers]: 'Gérer les utilisateurs',
  [PermissionCode.AdminManageSites]: 'Gérer les sites',
  [PermissionCode.AdminManageCategories]: 'Gérer les catégories',
  [PermissionCode.AdminManageReferentials]: 'Gérer les référentiels',
  [PermissionCode.AdminManageRoles]: 'Gérer les rôles',
  [PermissionCode.AdminManageSettings]: 'Gérer les paramètres',
  [PermissionCode.AnalysisRead]: "Consulter les fiches d'analyse",
  [PermissionCode.AnalysisCreate]: "Créer une fiche d'analyse",
  [PermissionCode.AnalysisUpdate]: "Modifier une fiche d'analyse",
  [PermissionCode.AnalysisDecide]: "Prononcer l'avis d'une fiche d'analyse",
  [PermissionCode.AdminManageAnalysisCriteria]: "Gérer les critères d'analyse",
  [PermissionCode.AuditRead]: "Consulter le journal d'audit",
  [PermissionCode.DashboardGlobalRead]:
    'Consulter le tableau de bord de tous les sites (Direction)',
  [PermissionCode.ContractRead]: 'Consulter les contrats',
  [PermissionCode.ContractCreate]: 'Créer un contrat',
  [PermissionCode.ContractUpdate]: 'Modifier un contrat',
  [PermissionCode.ContractArchive]: 'Archiver un contrat',
  [PermissionCode.CorrespondentRead]: 'Consulter les correspondants',
  [PermissionCode.CorrespondentCreate]: 'Créer un correspondant',
  [PermissionCode.CorrespondentUpdate]: 'Modifier un correspondant',
  [PermissionCode.CorrespondentArchive]: 'Archiver un correspondant',
  [PermissionCode.ProjectRead]: 'Consulter les projets',
  [PermissionCode.ProjectCreate]: 'Créer un projet',
  [PermissionCode.ProjectUpdate]: 'Modifier un projet',
  [PermissionCode.ProjectArchive]: 'Archiver un projet',
  [PermissionCode.CourrierUpdate]: 'Modifier un effet entrant',
  [PermissionCode.CourrierArchive]: 'Archiver un effet',
  [PermissionCode.CourrierApprove]: 'Approuver un effet sortant',
  [PermissionCode.CourrierClose]: 'Clôturer tout effet entrant',
  [PermissionCode.CourrierReadAll]:
    "Consulter tous les effets (hors liste d'autorisés)",
  [PermissionCode.AnalysisArchive]: "Archiver une fiche d'analyse",
  [PermissionCode.UsersRead]: 'Consulter les utilisateurs',
  [PermissionCode.RolesRead]: 'Consulter les rôles',
  [PermissionCode.RolesCreate]: 'Créer un rôle',
  [PermissionCode.RolesArchive]: 'Archiver un rôle',
  [PermissionCode.SettingsRead]: 'Consulter les paramètres',
};

export const PERMISSION_METADATA_KEY = 'rbac:permission';

/**
 * Organisation-wide administration: roles and referentials are shared by
 * every site, so these only count when held through a global grant — a
 * site administrator holding them at their site can't use them.
 */
// ADMIN_MANAGE_REFERENTIALS and ADMIN_MANAGE_ROLES are no longer here: held
// at a site, they cover that site's referentials (canaux, correspondents,
// projects, contracts, effet types) and roles — see
// RbacService.managedSites. The shared catalogues they also guard (natures,
// correspondent types, the permission catalogue) are @PlatformOnly routes.
// ADMIN_MANAGE_ANALYSIS_CRITERIA neither: held at a site, it covers that
// site's own criteria and settings (the common catalogue needs it globally).
export const PLATFORM_PERMISSIONS: ReadonlySet<PermissionCode> = new Set([
  PermissionCode.AdminManageCategories,
  PermissionCode.DashboardGlobalRead,
]);

// Managing these includes reading them.
const INCLUDED_READ = new Map<PermissionCode, PermissionCode>([
  [PermissionCode.AdminManageRoles, PermissionCode.RolesRead],
  [PermissionCode.AdminManageSettings, PermissionCode.SettingsRead],
]);

/** Adds to `codes` the read permissions their management permissions include. */
export function addIncludedReads(codes: Set<string>) {
  for (const [manage, read] of INCLUDED_READ) {
    if (codes.has(manage)) codes.add(read);
  }
}

/** `permission` and the permissions that include it. */
export function permissionsGranting(
  permission: PermissionCode,
): PermissionCode[] {
  return [
    permission,
    ...[...INCLUDED_READ]
      .filter(([, read]) => read === permission)
      .map(([manage]) => manage),
  ];
}

/**
 * What a site's responsible holds at that site, and only there, without any
 * role: everything but the platform's own permissions and the creation of
 * sites. A site's responsible is its administrator.
 */
export const SITE_RESPONSIBLE_PERMISSIONS: readonly PermissionCode[] =
  Object.values(PermissionCode).filter(
    (code) =>
      !PLATFORM_PERMISSIONS.has(code) &&
      code !== PermissionCode.AdminManageSites,
  );
