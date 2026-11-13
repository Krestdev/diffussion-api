-- CreateTable
CREATE TABLE "audit_archive" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "entries" INTEGER NOT NULL,
    "retentionYears" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_archive_siteId_createdAt_idx" ON "audit_archive"("siteId", "createdAt");

