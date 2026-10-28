-- Baseline: the whole schema as of 28/10/2026, in one migration.
--
-- The 43 earlier migrations (prisma/migrations_archive/) never rebuilt an
-- empty database: 20260826093554_domain_model_refinement recreates types the
-- migrations before it had already created. Existing databases were built
-- with `db push`, so nobody noticed. This baseline replaces them; it was
-- checked to rebuild exactly the same columns, indexes, constraints and
-- enums as a database migrated the old way.
--
-- Prisma can't express NULLS NOT DISTINCT: the two unique indexes below that
-- need it (a global grant or global role, siteId null, can't be duplicated)
-- are edited by hand.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CorrespondentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DossierPriority" AS ENUM ('URGENT', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "DossierConfidentiality" AS ENUM ('PUBLIC', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "DossierStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING', 'LATE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourrierDirection" AS ENUM ('ENTRANT', 'SORTANT');

-- CreateEnum
CREATE TYPE "CourrierStatus" AS ENUM ('RECU', 'ENREGISTRE', 'TRANSMIS', 'EN_TRAITEMENT', 'EN_ATTENTE', 'BROUILLON', 'EN_ATTENTE_VALIDATION', 'A_CORRIGER', 'VALIDE', 'PRET_A_ENVOYER', 'ENVOYE', 'ANNULE', 'CLOTURE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "InstructionPriority" AS ENUM ('URGENT', 'NORMAL', 'MEDIUM');

-- CreateEnum
CREATE TYPE "InstructionStatus" AS ENUM ('A_AFFECTER', 'AFFECTEE', 'ACCEPTEE', 'REFUSEE', 'EN_COURS', 'EN_ATTENTE_VALIDATION', 'A_CORRIGER', 'TERMINEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "UserInstructionRole" AS ENUM ('EXECUTANT', 'SUPERVISEUR');

-- CreateEnum
CREATE TYPE "LivrableStatus" AS ENUM ('EN_PREPARATION', 'DEPOSE', 'SOUMIS', 'EN_VALIDATION', 'REJETE', 'VALIDE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "ValidationDecision" AS ENUM ('VALIDE', 'REJETE', 'CORRECTIONS_DEMANDEES');

-- CreateEnum
CREATE TYPE "NotificationCanal" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('NOT_READ', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('info', 'warn', 'error');

-- CreateEnum
CREATE TYPE "AnalysisOpinion" AS ENUM ('AF', 'AFR', 'AS', 'AD', 'NA');

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "refreshToken" TEXT,
    "registrationNumber" VARCHAR(30),
    "function" TEXT,
    "phone" VARCHAR(30),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastLogin" TIMESTAMP(3),
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100),
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "responsibleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "siteId" TEXT,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "display" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "permissionId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("permissionId","roleId")
);

-- CreateTable
CREATE TABLE "delegation" (
    "id" TEXT NOT NULL,
    "delegantId" TEXT NOT NULL,
    "delegataireId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "responsibility" VARCHAR(100),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "code" VARCHAR(30),
    "description" TEXT,
    "retentionMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courrier_nature" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courrier_nature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canal" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correspondent_type" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correspondent_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correspondent" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "typeId" TEXT,
    "address" TEXT,
    "city" VARCHAR(100),
    "country" VARCHAR(100),
    "email" VARCHAR(150),
    "phone" VARCHAR(30),
    "mainContact" VARCHAR(150),
    "status" "CorrespondentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correspondent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dossier" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "projectId" TEXT,
    "siteId" TEXT NOT NULL,
    "responsibleId" TEXT,
    "priority" "DossierPriority" NOT NULL DEFAULT 'NORMAL',
    "confidentiality" "DossierConfidentiality" NOT NULL DEFAULT 'PUBLIC',
    "status" "DossierStatus" NOT NULL DEFAULT 'OPEN',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "reference" VARCHAR(50),
    "mode" VARCHAR(100),
    "maitreOuvrageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dossier_access" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dossier_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courrier" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "dossierId" TEXT,
    "direction" "CourrierDirection" NOT NULL,
    "correspondentId" TEXT,
    "natureId" TEXT,
    "canalId" TEXT,
    "subject" VARCHAR(255) NOT NULL,
    "reference" VARCHAR(60),
    "status" "CourrierStatus" NOT NULL DEFAULT 'RECU',
    "copies" INTEGER,
    "receivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "scanUrl" TEXT,
    "dischargeRequested" BOOLEAN NOT NULL DEFAULT false,
    "dischargedAt" TIMESTAMP(3),
    "dischargedById" TEXT,
    "dischargedStamp" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "respondsToId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courrier_access" (
    "id" TEXT NOT NULL,
    "courrierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courrier_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruction" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "dossierId" TEXT NOT NULL,
    "courrierId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "priority" "InstructionPriority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" TIMESTAMP(3),
    "status" "InstructionStatus" NOT NULL DEFAULT 'A_AFFECTER',
    "refusalReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "instruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruction_dependency" (
    "instructionId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "instruction_dependency_pkey" PRIMARY KEY ("instructionId","dependsOnId")
);

-- CreateTable
CREATE TABLE "user_instructions" (
    "userId" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "role" "UserInstructionRole" NOT NULL,

    CONSTRAINT "user_instructions_pkey" PRIMARY KEY ("userId","instructionId","role")
);

-- CreateTable
CREATE TABLE "livrable" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "LivrableStatus" NOT NULL DEFAULT 'EN_PREPARATION',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "parentVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "livrable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT,
    "livrableId" TEXT,
    "courrierId" TEXT,
    "analysisSheetId" TEXT,
    "validatorId" TEXT NOT NULL,
    "decision" "ValidationDecision" NOT NULL,
    "motif" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "name" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "dossierId" TEXT,
    "courrierId" TEXT,
    "livrableId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT,
    "courrierId" TEXT,
    "type" VARCHAR(50) NOT NULL,
    "message" TEXT,
    "canal" "NotificationCanal" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification" (
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'NOT_READ',

    CONSTRAINT "user_notification_pkey" PRIMARY KEY ("userId","notificationId")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentLogId" TEXT,
    "userId" TEXT,
    "actorLabel" VARCHAR(100),
    "source" "ActivitySource" NOT NULL,
    "level" "ActivityLevel" NOT NULL,
    "action" VARCHAR(255) NOT NULL,
    "entityType" VARCHAR(50),
    "entityId" TEXT,
    "message" TEXT,
    "stack" TEXT,
    "metadata" JSONB,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_sheet" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "livrableId" TEXT NOT NULL,
    "courrierId" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentSheetId" TEXT,
    "authorId" TEXT NOT NULL,
    "refBL" VARCHAR(50),
    "lieuUsage" VARCHAR(150),
    "remise" TIMESTAMP(3),
    "norme" VARCHAR(150),
    "docsReferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedOpinion" "AnalysisOpinion",
    "overallOpinion" "AnalysisOpinion",
    "opinionMotif" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_item" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "observation" TEXT,
    "suggestedOpinion" "AnalysisOpinion",
    "opinion" "AnalysisOpinion",
    "order" INTEGER NOT NULL,

    CONSTRAINT "analysis_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_item_criterion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "templateId" TEXT,
    "label" VARCHAR(150) NOT NULL,
    "opinion" "AnalysisOpinion" NOT NULL DEFAULT 'NA',
    "observation" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "analysis_item_criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_criterion_template" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_criterion_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_tokenHash_key" ON "password_reset_token"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_token_userId_idx" ON "password_reset_token"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_registrationNumber_key" ON "user"("registrationNumber");

-- CreateIndex
CREATE INDEX "user_siteId_idx" ON "user"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "site_code_key" ON "site"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_siteId_name_key" ON "role"("siteId", "name") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "user_role_siteId_roleId_idx" ON "user_role"("siteId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_userId_roleId_siteId_key" ON "user_role"("userId", "roleId", "siteId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE INDEX "delegation_delegataireId_roleId_siteId_idx" ON "delegation"("delegataireId", "roleId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "category_label_key" ON "category"("label");

-- CreateIndex
CREATE UNIQUE INDEX "category_code_key" ON "category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "courrier_nature_name_key" ON "courrier_nature"("name");

-- CreateIndex
CREATE UNIQUE INDEX "canal_name_key" ON "canal"("name");

-- CreateIndex
CREATE UNIQUE INDEX "correspondent_type_name_key" ON "correspondent_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "correspondent_code_key" ON "correspondent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dossier_number_key" ON "dossier"("number");

-- CreateIndex
CREATE UNIQUE INDEX "project_name_key" ON "project"("name");

-- CreateIndex
CREATE UNIQUE INDEX "dossier_access_dossierId_userId_key" ON "dossier_access"("dossierId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "courrier_number_key" ON "courrier"("number");

-- CreateIndex
CREATE UNIQUE INDEX "courrier_access_courrierId_userId_key" ON "courrier_access"("courrierId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "instruction_number_key" ON "instruction"("number");

-- CreateIndex
CREATE INDEX "validation_livrableId_idx" ON "validation"("livrableId");

-- CreateIndex
CREATE INDEX "validation_courrierId_idx" ON "validation"("courrierId");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "document"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "document_access_documentId_userId_key" ON "document_access"("documentId", "userId");

-- CreateIndex
CREATE INDEX "activity_log_parentLogId_idx" ON "activity_log"("parentLogId");

-- CreateIndex
CREATE INDEX "activity_log_entityType_entityId_idx" ON "activity_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_log_userId_createdAt_idx" ON "activity_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_log_source_createdAt_idx" ON "activity_log"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_sheet_reference_key" ON "analysis_sheet"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_sheet_livrableId_key" ON "analysis_sheet"("livrableId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_sheet_parentSheetId_key" ON "analysis_sheet"("parentSheetId");

-- CreateIndex
CREATE INDEX "analysis_sheet_dossierId_idx" ON "analysis_sheet"("dossierId");

-- CreateIndex
CREATE INDEX "analysis_sheet_courrierId_idx" ON "analysis_sheet"("courrierId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_item_sheetId_documentId_key" ON "analysis_item"("sheetId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_item_sheetId_order_key" ON "analysis_item"("sheetId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_item_criterion_itemId_label_key" ON "analysis_item_criterion"("itemId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_criterion_template_label_key" ON "analysis_criterion_template"("label");

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_delegantId_fkey" FOREIGN KEY ("delegantId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_delegataireId_fkey" FOREIGN KEY ("delegataireId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correspondent" ADD CONSTRAINT "correspondent_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "correspondent_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_maitreOuvrageId_fkey" FOREIGN KEY ("maitreOuvrageId") REFERENCES "correspondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier_access" ADD CONSTRAINT "dossier_access_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier_access" ADD CONSTRAINT "dossier_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_respondsToId_fkey" FOREIGN KEY ("respondsToId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_correspondentId_fkey" FOREIGN KEY ("correspondentId") REFERENCES "correspondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "courrier_nature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_canalId_fkey" FOREIGN KEY ("canalId") REFERENCES "canal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_dischargedById_fkey" FOREIGN KEY ("dischargedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier_access" ADD CONSTRAINT "courrier_access_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier_access" ADD CONSTRAINT "courrier_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction_dependency" ADD CONSTRAINT "instruction_dependency_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "instruction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction_dependency" ADD CONSTRAINT "instruction_dependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "instruction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_instructions" ADD CONSTRAINT "user_instructions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_instructions" ADD CONSTRAINT "user_instructions_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "instruction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livrable" ADD CONSTRAINT "livrable_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "instruction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livrable" ADD CONSTRAINT "livrable_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "livrable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livrable" ADD CONSTRAINT "livrable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation" ADD CONSTRAINT "validation_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "instruction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation" ADD CONSTRAINT "validation_livrableId_fkey" FOREIGN KEY ("livrableId") REFERENCES "livrable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation" ADD CONSTRAINT "validation_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation" ADD CONSTRAINT "validation_analysisSheetId_fkey" FOREIGN KEY ("analysisSheetId") REFERENCES "analysis_sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation" ADD CONSTRAINT "validation_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_livrableId_fkey" FOREIGN KEY ("livrableId") REFERENCES "livrable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_parentLogId_fkey" FOREIGN KEY ("parentLogId") REFERENCES "activity_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_livrableId_fkey" FOREIGN KEY ("livrableId") REFERENCES "livrable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_parentSheetId_fkey" FOREIGN KEY ("parentSheetId") REFERENCES "analysis_sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_item" ADD CONSTRAINT "analysis_item_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "analysis_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_item" ADD CONSTRAINT "analysis_item_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_item_criterion" ADD CONSTRAINT "analysis_item_criterion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "analysis_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_item_criterion" ADD CONSTRAINT "analysis_item_criterion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "analysis_criterion_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

