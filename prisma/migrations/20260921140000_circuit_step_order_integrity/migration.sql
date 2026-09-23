-- A circuit's steps must have distinct, ordered positions: the engine picks
-- "the next step" as the lowest order greater than the current one, so
-- duplicates make a run's path arbitrary.

-- 1. Renumber every circuit's steps to 1..n, preserving their relative order.
--    Only rows whose position actually changes are touched.
WITH renumbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "circuitId" ORDER BY "order", id) AS pos
  FROM "circuit_step"
)
UPDATE "circuit_step" s
SET "order" = r.pos
FROM renumbered r
WHERE s.id = r.id AND s."order" <> r.pos;

-- 2. Drop rejection targets that are not an earlier step of the same circuit
--    (a forward or cross-circuit target loops for ever). Those steps now
--    cancel the circuit on rejection instead.
UPDATE "circuit_step" child
SET "parentStepId" = NULL
WHERE child."parentStepId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "circuit_step" parent
    WHERE parent.id = child."parentStepId"
      AND parent."circuitId" = child."circuitId"
      AND parent."order" < child."order"
  );

CREATE UNIQUE INDEX "circuit_step_circuitId_order_key" ON "circuit_step"("circuitId", "order");
