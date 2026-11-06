-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "accentColor" VARCHAR(9),
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "logoMime" VARCHAR(50),
ADD COLUMN     "notifications" JSONB,
ADD COLUMN     "useModuleColor" BOOLEAN,
ADD COLUMN     "values" JSONB;

-- CreateTable
CREATE TABLE "site_settings" (
    "siteId" TEXT NOT NULL,
    "values" JSONB,
    "notifications" JSONB,
    "accentColor" VARCHAR(9),
    "useModuleColor" BOOLEAN,
    "logoKey" TEXT,
    "logoMime" VARCHAR(50),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("siteId")
);

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

