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
  [PermissionCode.CourrierRegisterEntrant]: 'Enregistrer un courrier entrant',
  [PermissionCode.CourrierWriteSortant]: 'Rédiger un courrier sortant',
  [PermissionCode.CourrierUpdateDraft]: 'Modifier un brouillon de courrier',
  [PermissionCode.CourrierSend]: 'Envoyer un courrier sortant',
  [PermissionCode.CourrierRead]: 'Consulter les courriers',
  [PermissionCode.InstructionCreate]: 'Créer une tâche',
  [PermissionCode.InstructionAssign]: 'Affecter une tâche',
  [PermissionCode.InstructionReassign]: 'Réaffecter une tâche',
  [PermissionCode.InstructionUpdate]: 'Modifier une tâche',
  [PermissionCode.InstructionAccept]: 'Accepter une tâche',
  [PermissionCode.InstructionRefuse]: 'Refuser une tâche',
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
};

export const PERMISSION_METADATA_KEY = 'rbac:permission';

/**
 * Organisation-wide administration: roles and referentials are shared by
 * every site, so these only count when held through a global grant — a
 * site administrator holding them at their site can't use them.
 */
export const PLATFORM_PERMISSIONS: ReadonlySet<PermissionCode> = new Set([
  PermissionCode.AdminManageRoles,
  PermissionCode.AdminManageCategories,
  PermissionCode.AdminManageReferentials,
  PermissionCode.AdminManageAnalysisCriteria,
]);
