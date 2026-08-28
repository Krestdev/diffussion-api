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
  InstructionAccept = 'INSTRUCTION_ACCEPT',
  InstructionRefuse = 'INSTRUCTION_REFUSE',
  InstructionClose = 'INSTRUCTION_CLOSE',

  // Livrables (7.6.4.4)
  LivrableDeposit = 'LIVRABLE_DEPOSIT',
  LivrableRead = 'LIVRABLE_READ',
  LivrableNewVersion = 'LIVRABLE_NEW_VERSION',
  LivrableDownload = 'LIVRABLE_DOWNLOAD',

  // Validation (7.6.4.5)
  ValidationVerify = 'VALIDATION_VERIFY',
  ValidationApprove = 'VALIDATION_APPROVE',
  ValidationReject = 'VALIDATION_REJECT',
  ValidationRequestCorrections = 'VALIDATION_REQUEST_CORRECTIONS',

  // Administration (7.6.4.6)
  AdminManageUsers = 'ADMIN_MANAGE_USERS',
  AdminManageSites = 'ADMIN_MANAGE_SITES',
  AdminManageServices = 'ADMIN_MANAGE_SERVICES',
  AdminManageCategories = 'ADMIN_MANAGE_CATEGORIES',
  AdminManageReferentials = 'ADMIN_MANAGE_REFERENTIALS',
  AdminManageRoles = 'ADMIN_MANAGE_ROLES',
  AdminManageCircuits = 'ADMIN_MANAGE_CIRCUITS',
  AdminManageSettings = 'ADMIN_MANAGE_SETTINGS',

  // Audit (RG-AUD-*)
  AuditRead = 'AUDIT_READ',
}

export const PERMISSION_METADATA_KEY = 'rbac:permission';
