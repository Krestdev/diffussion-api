-- DropIndex
DROP INDEX "analysis_criterion_template_label_key";

-- AlterTable
ALTER TABLE "analysis_criterion_template" ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "analysis_site_settings" (
    "siteId" TEXT NOT NULL,
    "allowCustomCriteria" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_site_settings_pkey" PRIMARY KEY ("siteId")
);

-- CreateIndex
-- NULLS NOT DISTINCT: a label is unique among the common criteria too
-- (Prisma cannot express it, as for roles and effet types).
CREATE UNIQUE INDEX "analysis_criterion_template_siteId_label_key" ON "analysis_criterion_template"("siteId", "label") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "analysis_criterion_template" ADD CONSTRAINT "analysis_criterion_template_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_site_settings" ADD CONSTRAINT "analysis_site_settings_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

