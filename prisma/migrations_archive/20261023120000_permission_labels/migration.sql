-- Default label of each permission (shown in the role screens; the code is
-- the value). Only fills empty labels, so a reworded one is kept.

UPDATE "permission" p
SET "description" = v.label
FROM (VALUES
  ('DOSSIER_CREATE', 'Créer un dossier'),
  ('DOSSIER_READ', 'Consulter les dossiers'),
  ('DOSSIER_UPDATE', 'Modifier un dossier'),
  ('DOSSIER_CLOSE', 'Clôturer un dossier'),
  ('DOSSIER_REOPEN', 'Rouvrir un dossier'),
  ('DOSSIER_ARCHIVE', 'Archiver un dossier'),
  ('COURRIER_REGISTER_ENTRANT', 'Enregistrer un courrier entrant'),
  ('COURRIER_WRITE_SORTANT', 'Rédiger un courrier sortant'),
  ('COURRIER_SEND', 'Envoyer un courrier sortant'),
  ('COURRIER_READ', 'Consulter les courriers'),
  ('INSTRUCTION_CREATE', 'Créer une tâche'),
  ('INSTRUCTION_ASSIGN', 'Affecter une tâche'),
  ('INSTRUCTION_UPDATE', 'Modifier une tâche'),
  ('INSTRUCTION_REFUSE', 'Refuser une tâche'),
  ('INSTRUCTION_CANCEL', 'Annuler une tâche'),
  ('INSTRUCTION_CLOSE', 'Clôturer une tâche'),
  ('LIVRABLE_DEPOSIT', 'Déposer un livrable'),
  ('LIVRABLE_READ', 'Consulter les livrables'),
  ('LIVRABLE_NEW_VERSION', 'Déposer une nouvelle version d''un livrable'),
  ('LIVRABLE_SUBMIT', 'Soumettre un livrable à validation'),
  ('VALIDATION_APPROVE', 'Approuver les livrables'),
  ('VALIDATION_REJECT', 'Rejeter un livrable'),
  ('VALIDATION_REQUEST_CORRECTIONS', 'Demander des corrections sur une tâche'),
  ('ADMIN_MANAGE_USERS', 'Gérer les utilisateurs'),
  ('ADMIN_MANAGE_SITES', 'Gérer les sites'),
  ('ADMIN_MANAGE_CATEGORIES', 'Gérer les catégories'),
  ('ADMIN_MANAGE_REFERENTIALS', 'Gérer les référentiels'),
  ('ADMIN_MANAGE_ROLES', 'Gérer les rôles'),
  ('ANALYSIS_READ', 'Consulter les fiches d''analyse'),
  ('ANALYSIS_CREATE', 'Créer une fiche d''analyse'),
  ('ANALYSIS_UPDATE', 'Modifier une fiche d''analyse'),
  ('ANALYSIS_DECIDE', 'Prononcer l''avis d''une fiche d''analyse'),
  ('ADMIN_MANAGE_ANALYSIS_CRITERIA', 'Gérer les critères d''analyse'),
  ('AUDIT_READ', 'Consulter le journal d''audit')
) AS v(code, label)
WHERE p."code" = v.code
  AND p."description" IS NULL;
