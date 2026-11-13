-- "Effet" replaces "courrier" in what people read: a courrier is only one
-- kind of effet (bordereau, spécimen, support numérique, dossier complet...).
-- Only labels still at their former default change, so a label an
-- administrator reworded is kept.

UPDATE "permission" p
SET "description" = v.label
FROM (VALUES
  ('COURRIER_REGISTER_ENTRANT', 'Enregistrer un courrier entrant', 'Enregistrer un effet entrant'),
  ('COURRIER_WRITE_SORTANT', 'Rédiger un courrier sortant', 'Rédiger un effet sortant'),
  ('COURRIER_UPDATE_DRAFT', 'Modifier un brouillon de courrier', 'Modifier un brouillon d''effet'),
  ('COURRIER_SEND', 'Envoyer un courrier sortant', 'Envoyer un effet sortant'),
  ('COURRIER_READ', 'Consulter les courriers', 'Consulter les effets')
) AS v(code, previous, label)
WHERE p."code" = v.code
  AND p."description" = v.previous;
