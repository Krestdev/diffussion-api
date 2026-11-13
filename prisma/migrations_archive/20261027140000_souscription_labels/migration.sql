-- An executant now "souscrit" (or not) to a task instead of accepting or
-- refusing it. Only labels still at their former default change, so a
-- label an administrator reworded is kept.

UPDATE "permission" p
SET "description" = v.label
FROM (VALUES
  ('INSTRUCTION_ACCEPT', 'Accepter une tâche', 'Souscrire à une tâche'),
  ('INSTRUCTION_REFUSE', 'Refuser une tâche', 'Ne pas souscrire à une tâche')
) AS v(code, previous, label)
WHERE p."code" = v.code
  AND p."description" = v.previous;
