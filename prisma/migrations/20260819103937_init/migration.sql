-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIF', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DOSSIER', 'COURRIER', 'FILE');

-- CreateEnum
CREATE TYPE "UserInstructionsStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('NOT_READ', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserInstructionsActions" AS ENUM ('EXECUTANT', 'SUPERVISEUR');

-- CreateEnum
CREATE TYPE "CanalType" AS ENUM ('EMAIL', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ARCHIVED', 'ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "InstructionStatus" AS ENUM ('EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstructionPriorite" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CircuitStateStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "service" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "refreshToken" TEXT,
    "status" "UserStatus" NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastlogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_instructions" (
    "userId" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "status" "UserInstructionsStatus" NOT NULL,
    "action" "UserInstructionsActions" NOT NULL,

    CONSTRAINT "user_instructions_pkey" PRIMARY KEY ("userId","instructionId")
);

-- CreateTable
CREATE TABLE "user_service" (
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "user_service_pkey" PRIMARY KEY ("userId","serviceId")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actions" VARCHAR(10) NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "entityId" TEXT,
    "entityType" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification" (
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "statut" "NotificationStatus" NOT NULL,

    CONSTRAINT "user_notification_pkey" PRIMARY KEY ("userId","notificationId")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT,
    "type" VARCHAR(20) NOT NULL,
    "message" TEXT,
    "canal" "CanalType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "isDocument" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentId" TEXT,
    "categoryId" TEXT,
    "correspondantId" TEXT,
    "status" "DocumentStatus" NOT NULL,
    "date" TIMESTAMP(3),
    "label" VARCHAR(100),
    "directory" INTEGER,
    "reference" VARCHAR(30),
    "canal" VARCHAR(30),
    "copies" INTEGER,
    "version" INTEGER,
    "direction" VARCHAR(10),
    "modificationAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "transmittedOn" TIMESTAMP(3),
    "scanUrl" TEXT,
    "dischargedAt" TIMESTAMP(3),
    "dischargedById" TEXT,
    "dischargedStamp" BOOLEAN,
    "receivedAt" TIMESTAMP(3),
    "identifier" VARCHAR(30),
    "siteId" TEXT,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userId2" TEXT,
    "documentId" TEXT NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "priorite" "InstructionPriorite" NOT NULL,
    "dateline" TIMESTAMP(3),
    "statut" "InstructionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "parentId" TEXT,
    "validationId" TEXT,

    CONSTRAINT "instruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(100),
    "type" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correspondant" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100),
    "type" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correspondant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation" (
    "id" TEXT NOT NULL,
    "decision" TEXT,
    "circuitInstanceId" TEXT,
    "motif" TEXT,
    "dateDecision" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "validation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "SiteStatus" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" VARCHAR(10),

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "circuitStepId" TEXT,
    "name" VARCHAR(50),

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "permissionId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("permissionId","roleId")
);

-- CreateTable
CREATE TABLE "circuit" (
    "id" TEXT NOT NULL,
    "roleId" TEXT,
    "name" VARCHAR(100),
    "documentTypeId" INTEGER,

    CONSTRAINT "circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit_step" (
    "id" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "actionType" VARCHAR(100),
    "parentCircuitStepId" TEXT,
    "state" "CircuitStateStatus" NOT NULL,
    "condition" TEXT,
    "roleId" TEXT,

    CONSTRAINT "circuit_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_circuit" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "circuitStepId" TEXT NOT NULL,
    "correspondantId" TEXT,

    CONSTRAINT "instance_circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit_step_instance_circuit" (
    "id" TEXT NOT NULL,
    "circuitStepId" TEXT NOT NULL,
    "circuitInstanceId" TEXT NOT NULL,

    CONSTRAINT "circuit_step_instance_circuit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "document_identifier_key" ON "document"("identifier");

-- AddForeignKey
ALTER TABLE "user_instructions" ADD CONSTRAINT "user_instructions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_instructions" ADD CONSTRAINT "user_instructions_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "instruction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_service" ADD CONSTRAINT "user_service_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_service" ADD CONSTRAINT "user_service_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_correspondantId_fkey" FOREIGN KEY ("correspondantId") REFERENCES "correspondant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_dischargedById_fkey" FOREIGN KEY ("dischargedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "instruction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_validationId_fkey" FOREIGN KEY ("validationId") REFERENCES "validation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation" ADD CONSTRAINT "validation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation" ADD CONSTRAINT "validation_circuitInstanceId_fkey" FOREIGN KEY ("circuitInstanceId") REFERENCES "instance_circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_circuitStepId_fkey" FOREIGN KEY ("circuitStepId") REFERENCES "circuit_step"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit" ADD CONSTRAINT "circuit_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step" ADD CONSTRAINT "circuit_step_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "circuit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step" ADD CONSTRAINT "circuit_step_parentCircuitStepId_fkey" FOREIGN KEY ("parentCircuitStepId") REFERENCES "circuit_step"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step" ADD CONSTRAINT "circuit_step_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "circuit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_circuitStepId_fkey" FOREIGN KEY ("circuitStepId") REFERENCES "circuit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_correspondantId_fkey" FOREIGN KEY ("correspondantId") REFERENCES "correspondant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step_instance_circuit" ADD CONSTRAINT "circuit_step_instance_circuit_circuitStepId_fkey" FOREIGN KEY ("circuitStepId") REFERENCES "circuit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_step_instance_circuit" ADD CONSTRAINT "circuit_step_instance_circuit_circuitInstanceId_fkey" FOREIGN KEY ("circuitInstanceId") REFERENCES "instance_circuit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
