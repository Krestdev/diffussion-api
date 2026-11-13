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
CREATE TYPE "CourrierStatus" AS ENUM ('RECU', 'ENREGISTRE', 'TRANSMIS', 'EN_TRAITEMENT', 'EN_ATTENTE', 'BROUILLON', 'EN_VERIFICATION', 'A_CORRIGER', 'EN_VALIDATION', 'VALIDE', 'PRET_A_ENVOYER', 'ENVOYE', 'ANNULE', 'CLOTURE', 'ARCHIVE');

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
CREATE TYPE "CircuitStepState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationCanal" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('NOT_READ', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('info', 'warn', 'error');

-- CreateTable
CREATE TABLE "service" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_service" (
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "user_service_pkey" PRIMARY KEY ("userId","serviceId")
);

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100),
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "responsibleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
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
    "responsibility" VARCHAR(100) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
CREATE TABLE "dossier_type" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dossier_type_pkey" PRIMARY KEY ("id")
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
    "typeId" TEXT,
    "categoryId" TEXT,
    "siteId" TEXT NOT NULL,
    "responsibleId" TEXT,
    "priority" "DossierPriority" NOT NULL DEFAULT 'NORMAL',
    "confidentiality" "DossierConfidentiality" NOT NULL DEFAULT 'PUBLIC',
    "status" "DossierStatus" NOT NULL DEFAULT 'OPEN',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courrier" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "dossierId" TEXT NOT NULL,
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
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruction" (
    "id" TEXT NOT NULL,
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
    "circuitInstanceId" TEXT,
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
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "dossierId" TEXT,
    "courrierId" TEXT,
    "livrableId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "dossierTypeId" TEXT,
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit_step" (
    "id" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "actionType" VARCHAR(100),
    "parentStepId" TEXT,
    "maxDelayHours" INTEGER,
    "condition" TEXT,
    "roleId" TEXT,

    CONSTRAINT "circuit_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit_instance" (
    "id" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "dossierId" TEXT,
    "courrierId" TEXT,
    "currentStepId" TEXT NOT NULL,
    "correspondentId" TEXT,

    CONSTRAINT "circuit_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit_step_instance_circuit" (
    "id" TEXT NOT NULL,
    "circuitStepId" TEXT NOT NULL,
    "circuitInstanceId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circuit_step_instance_circuit_pkey" PRIMARY KEY ("id")
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
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(50),
    "entityId" TEXT,
    "message" TEXT,
    "stack" TEXT,
    "metadata" JSONB,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_registrationNumber_key" ON "user"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_userId_siteId_key" ON "assignment"("userId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "role_name_key" ON "role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dossier_type_name_key" ON "dossier_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "courrier_nature_name_key" ON "courrier_nature"("name");

-- CreateIndex
CREATE UNIQUE INDEX "canal_name_key" ON "canal"("name");

-- CreateIndex
CREATE UNIQUE INDEX "correspondent_type_name_key" ON "correspondent_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "dossier_number_key" ON "dossier"("number");

-- CreateIndex
CREATE UNIQUE INDEX "courrier_number_key" ON "courrier"("number");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "document"("storageKey");

-- CreateIndex
CREATE INDEX "activity_log_parentLogId_idx" ON "activity_log"("parentLogId");

-- CreateIndex
CREATE INDEX "activity_log_entityType_entityId_idx" ON "activity_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_log_userId_createdAt_idx" ON "activity_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_log_source_createdAt_idx" ON "activity_log"("source", "createdAt");

-- AddForeignKey
ALTER TABLE "user_service" ADD CONSTRAINT "user_service_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_service" ADD CONSTRAINT "user_service_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_delegantId_fkey" FOREIGN KEY ("delegantId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_delegataireId_fkey" FOREIGN KEY ("delegataireId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correspondent" ADD CONSTRAINT "correspondent_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "correspondent_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "dossier_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "validation" ADD CONSTRAINT "validation_circuitInstanceId_fkey" FOREIGN KEY ("circuitInstanceId") REFERENCES "circuit_instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "circuit" ADD CONSTRAINT "circuit_dossierTypeId_fkey" FOREIGN KEY ("dossierTypeId") REFERENCES "dossier_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit" ADD CONSTRAINT "circuit_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step" ADD CONSTRAINT "circuit_step_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "circuit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step" ADD CONSTRAINT "circuit_step_parentStepId_fkey" FOREIGN KEY ("parentStepId") REFERENCES "circuit_step"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step" ADD CONSTRAINT "circuit_step_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_instance" ADD CONSTRAINT "circuit_instance_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "circuit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_instance" ADD CONSTRAINT "circuit_instance_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_instance" ADD CONSTRAINT "circuit_instance_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_instance" ADD CONSTRAINT "circuit_instance_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "circuit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_instance" ADD CONSTRAINT "circuit_instance_correspondentId_fkey" FOREIGN KEY ("correspondentId") REFERENCES "correspondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step_instance_circuit" ADD CONSTRAINT "circuit_step_instance_circuit_circuitStepId_fkey" FOREIGN KEY ("circuitStepId") REFERENCES "circuit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step_instance_circuit" ADD CONSTRAINT "circuit_step_instance_circuit_circuitInstanceId_fkey" FOREIGN KEY ("circuitInstanceId") REFERENCES "circuit_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
