-- RG-ARC-001: retention deadline inherited from the dossier's category.
ALTER TABLE "dossier" ADD COLUMN "retentionUntil" TIMESTAMP(3);

UPDATE "dossier" AS d
SET "retentionUntil" = d."openedAt" + make_interval(months => c."retentionMonths")
FROM "category" AS c
WHERE d."categoryId" = c."id" AND c."retentionMonths" IS NOT NULL;

-- Category label/code must be unique. Fails if duplicates already exist:
-- rename or merge them first.
CREATE UNIQUE INDEX "category_label_key" ON "category"("label");
CREATE UNIQUE INDEX "category_code_key" ON "category"("code");
