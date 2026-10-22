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
  AdminManageCircuits = 'ADMIN_MANAGE_CIRCUITS',
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
  PermissionCode.AdminManageCircuits,
  PermissionCode.AdminManageSettings,
  PermissionCode.AdminManageAnalysisCriteria,
]);
