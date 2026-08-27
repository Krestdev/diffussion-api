-- Add human-readable reference codes to Site, Role, Correspondent, backfilling
-- existing rows deterministically before enforcing NOT NULL + UNIQUE
-- (written by hand: `prisma migrate dev` refuses to run non-interactively
-- when a required column has to be backfilled).

-- Site
ALTER TABLE "site" ADD COLUMN "code" VARCHAR(30);
WITH numbered AS (
  SELECT id, 'ST-' || lpad(row_number() OVER (ORDER BY "createdAt")::text, 3, '0') AS new_code
  FROM "site"
)
UPDATE "site" s SET "code" = n.new_code FROM numbered n WHERE s.id = n.id;
ALTER TABLE "site" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "site_code_key" ON "site"("code");

-- Role
ALTER TABLE "role" ADD COLUMN "code" VARCHAR(30);
WITH numbered AS (
  SELECT id, 'RO-' || lpad(row_number() OVER (ORDER BY "createdAt")::text, 3, '0') AS new_code
  FROM "role"
)
UPDATE "role" r SET "code" = n.new_code FROM numbered n WHERE r.id = n.id;
ALTER TABLE "role" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- Correspondent (no existing rows at time of writing)
ALTER TABLE "correspondent" ADD COLUMN "code" VARCHAR(30) NOT NULL;
CREATE UNIQUE INDEX "correspondent_code_key" ON "correspondent"("code");
