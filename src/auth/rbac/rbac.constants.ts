export enum PermissionCode {
  // Courrier
  CourrierRead = 'COURRIER_READ',
  CourrierWrite = 'COURRIER_WRITE',
  CourrierDigitize = 'COURRIER_DIGITIZE',
  CourrierTransmettre = 'COURRIER_TRANSMIT',

  // Dossier
  DossierRead = 'DOSSIER_READ',
  DossierWrite = 'DOSSIER_WRITE',
  DossierTransmettre = 'DOSSIER_TRANSMIT',
  DossierCloturer = 'DOSSIER_CLOSE',

  // Audit
  AuditRead = 'AUDIT_READ',
}

export const PERMISSION_METADATA_KEY = 'rbac:permission';
