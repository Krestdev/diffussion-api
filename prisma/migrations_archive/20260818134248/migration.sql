/*
  Warnings:

  - The primary key for the `audit_log` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `entityUuid` on the `audit_log` table. All the data in the column will be lost.
  - You are about to drop the column `utilisateurUuid` on the `audit_log` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `audit_log` table. All the data in the column will be lost.
  - The primary key for the `category` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `uuid` on the `category` table. All the data in the column will be lost.
  - The primary key for the `circuit` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `nom` on the `circuit` table. All the data in the column will be lost.
  - You are about to drop the column `roleUuid` on the `circuit` table. All the data in the column will be lost.
  - You are about to drop the column `typeDossierUuid` on the `circuit` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `circuit` table. All the data in the column will be lost.
  - The primary key for the `correspondant` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `noms` on the `correspondant` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `correspondant` table. All the data in the column will be lost.
  - The primary key for the `document` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `categoryUuid` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `correspondantUuid` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `dateReception` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `dechargeAt` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `dechargeByUuid` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `dechargeCachet` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `nombreExemplaires` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `numero` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `numeroVersion` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `parentDocumentUuid` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `parentVersionUuid` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `priorite` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `rejectionMotif` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `siteUuid` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `transmittedAt` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `document` table. All the data in the column will be lost.
  - The primary key for the `instance_circuit` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `circuitUuid` on the `instance_circuit` table. All the data in the column will be lost.
  - You are about to drop the column `correspondantUuid` on the `instance_circuit` table. All the data in the column will be lost.
  - You are about to drop the column `documentUuid` on the `instance_circuit` table. All the data in the column will be lost.
  - You are about to drop the column `etapeCircuitUuid` on the `instance_circuit` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `instance_circuit` table. All the data in the column will be lost.
  - The primary key for the `instruction` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `dependsOnUuid` on the `instruction` table. All the data in the column will be lost.
  - You are about to drop the column `documentUuid` on the `instruction` table. All the data in the column will be lost.
  - You are about to drop the column `utilisateurUuid` on the `instruction` table. All the data in the column will be lost.
  - You are about to drop the column `utilisateurUuid2` on the `instruction` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `instruction` table. All the data in the column will be lost.
  - You are about to drop the column `validatetionUuid` on the `instruction` table. All the data in the column will be lost.
  - The primary key for the `notification` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `documentUuid` on the `notification` table. All the data in the column will be lost.
  - You are about to drop the column `utilisateurUuid` on the `notification` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `notification` table. All the data in the column will be lost.
  - The primary key for the `permission` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `noms` on the `permission` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `permission` table. All the data in the column will be lost.
  - The primary key for the `role` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `affectationUuid` on the `role` table. All the data in the column will be lost.
  - You are about to drop the column `etapeCircuitUuid` on the `role` table. All the data in the column will be lost.
  - You are about to drop the column `nom` on the `role` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `role` table. All the data in the column will be lost.
  - The primary key for the `role_permission` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `permissionUuid` on the `role_permission` table. All the data in the column will be lost.
  - You are about to drop the column `roleUuid` on the `role_permission` table. All the data in the column will be lost.
  - The primary key for the `service` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `nom` on the `service` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `service` table. All the data in the column will be lost.
  - The primary key for the `site` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `nom` on the `site` table. All the data in the column will be lost.
  - You are about to drop the column `uuid` on the `site` table. All the data in the column will be lost.
  - You are about to drop the `affectation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `etape_circuit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `etape_circuit_instance_circuit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `utilisateur` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `utilisateur_service` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `validatetion` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[number]` on the table `document` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `audit_log` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `userId` to the `audit_log` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `category` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `circuit` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `correspondant` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `document` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `status` to the `document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `circuitId` to the `instance_circuit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `circuitStepId` to the `instance_circuit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `documentId` to the `instance_circuit` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `instance_circuit` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `documentId` to the `instruction` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `instruction` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `userId` to the `instruction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `priorite` to the `instruction` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `statut` on the `instruction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - The required column `id` was added to the `notification` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `userId` to the `notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `statut` to the `notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `canal` to the `notification` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `permission` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `assignmentId` to the `role` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `role` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `status` to the `role` table without a default value. This is not possible if the table is not empty.
  - Added the required column `permissionId` to the `role_permission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `roleId` to the `role_permission` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `service` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `name` to the `service` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `site` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `name` to the `site` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `site` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIF', 'INACTIF', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DOSSIER', 'COURRIER', 'FILE');

-- CreateEnum
CREATE TYPE "UserInstructionsStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "UserInstructionsActions" AS ENUM ('EXECUTANT', 'SUPERVISEUR');

-- CreateEnum
CREATE TYPE "CanalType" AS ENUM ('EMAIL', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "InstructionStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstructionPriorite" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- DropForeignKey
ALTER TABLE "affectation" DROP CONSTRAINT "affectation_siteUuid_fkey";

-- DropForeignKey
ALTER TABLE "affectation" DROP CONSTRAINT "affectation_utilisateurUuid_fkey";

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_utilisateurUuid_fkey";

-- DropForeignKey
ALTER TABLE "circuit" DROP CONSTRAINT "circuit_roleUuid_fkey";

-- DropForeignKey
ALTER TABLE "document" DROP CONSTRAINT "document_categoryUuid_fkey";

-- DropForeignKey
ALTER TABLE "document" DROP CONSTRAINT "document_correspondantUuid_fkey";

-- DropForeignKey
ALTER TABLE "document" DROP CONSTRAINT "document_dechargeByUuid_fkey";

-- DropForeignKey
ALTER TABLE "document" DROP CONSTRAINT "document_parentDocumentUuid_fkey";

-- DropForeignKey
ALTER TABLE "document" DROP CONSTRAINT "document_siteUuid_fkey";

-- DropForeignKey
ALTER TABLE "etape_circuit" DROP CONSTRAINT "etape_circuit_circuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "etape_circuit" DROP CONSTRAINT "etape_circuit_parentEtapeCircuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "etape_circuit" DROP CONSTRAINT "etape_circuit_roleUuid_fkey";

-- DropForeignKey
ALTER TABLE "etape_circuit_instance_circuit" DROP CONSTRAINT "etape_circuit_instance_circuit_etapeCircuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "etape_circuit_instance_circuit" DROP CONSTRAINT "etape_circuit_instance_circuit_instanceCircuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "instance_circuit" DROP CONSTRAINT "instance_circuit_circuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "instance_circuit" DROP CONSTRAINT "instance_circuit_correspondantUuid_fkey";

-- DropForeignKey
ALTER TABLE "instance_circuit" DROP CONSTRAINT "instance_circuit_documentUuid_fkey";

-- DropForeignKey
ALTER TABLE "instance_circuit" DROP CONSTRAINT "instance_circuit_etapeCircuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_dependsOnUuid_fkey";

-- DropForeignKey
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_documentUuid_fkey";

-- DropForeignKey
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_utilisateurUuid2_fkey";

-- DropForeignKey
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_utilisateurUuid_fkey";

-- DropForeignKey
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_validatetionUuid_fkey";

-- DropForeignKey
ALTER TABLE "notification" DROP CONSTRAINT "notification_documentUuid_fkey";

-- DropForeignKey
ALTER TABLE "notification" DROP CONSTRAINT "notification_utilisateurUuid_fkey";

-- DropForeignKey
ALTER TABLE "role" DROP CONSTRAINT "role_affectationUuid_fkey";

-- DropForeignKey
ALTER TABLE "role" DROP CONSTRAINT "role_etapeCircuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permissionUuid_fkey";

-- DropForeignKey
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_roleUuid_fkey";

-- DropForeignKey
ALTER TABLE "utilisateur_service" DROP CONSTRAINT "utilisateur_service_serviceUuid_fkey";

-- DropForeignKey
ALTER TABLE "utilisateur_service" DROP CONSTRAINT "utilisateur_service_utilisateurUuid_fkey";

-- DropForeignKey
ALTER TABLE "validatetion" DROP CONSTRAINT "validatetion_instanceCircuitUuid_fkey";

-- DropForeignKey
ALTER TABLE "validatetion" DROP CONSTRAINT "validatetion_utilisateurUuid_fkey";

-- DropIndex
DROP INDEX "document_numero_key";

-- AlterTable
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_pkey",
DROP COLUMN "entityUuid",
DROP COLUMN "utilisateurUuid",
DROP COLUMN "uuid",
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "category" DROP CONSTRAINT "category_pkey",
DROP COLUMN "uuid",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "category_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "circuit" DROP CONSTRAINT "circuit_pkey",
DROP COLUMN "nom",
DROP COLUMN "roleUuid",
DROP COLUMN "typeDossierUuid",
DROP COLUMN "uuid",
ADD COLUMN     "documentTypeId" INTEGER,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "name" VARCHAR(100),
ADD COLUMN     "roleId" TEXT,
ADD CONSTRAINT "circuit_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "correspondant" DROP CONSTRAINT "correspondant_pkey",
DROP COLUMN "noms",
DROP COLUMN "uuid",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "name" VARCHAR(100),
ADD CONSTRAINT "correspondant_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "document" DROP CONSTRAINT "document_pkey",
DROP COLUMN "categoryUuid",
DROP COLUMN "correspondantUuid",
DROP COLUMN "dateReception",
DROP COLUMN "dechargeAt",
DROP COLUMN "dechargeByUuid",
DROP COLUMN "dechargeCachet",
DROP COLUMN "nombreExemplaires",
DROP COLUMN "numero",
DROP COLUMN "numeroVersion",
DROP COLUMN "parentDocumentUuid",
DROP COLUMN "parentVersionUuid",
DROP COLUMN "priorite",
DROP COLUMN "rejectionMotif",
DROP COLUMN "siteUuid",
DROP COLUMN "transmittedAt",
DROP COLUMN "uuid",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "copies" INTEGER,
ADD COLUMN     "correspondantId" TEXT,
ADD COLUMN     "dischargedAt" TIMESTAMP(3),
ADD COLUMN     "dischargedBy" TEXT,
ADD COLUMN     "dischargedStamp" BOOLEAN,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "number" VARCHAR(30),
ADD COLUMN     "parentDocumentId" TEXT,
ADD COLUMN     "priority" VARCHAR(20),
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "transmittedOn" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER,
DROP COLUMN "status",
ADD COLUMN     "status" "DocumentStatus" NOT NULL,
ALTER COLUMN "scanUrl" SET DATA TYPE TEXT,
ADD CONSTRAINT "document_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "instance_circuit" DROP CONSTRAINT "instance_circuit_pkey",
DROP COLUMN "circuitUuid",
DROP COLUMN "correspondantUuid",
DROP COLUMN "documentUuid",
DROP COLUMN "etapeCircuitUuid",
DROP COLUMN "uuid",
ADD COLUMN     "circuitId" TEXT NOT NULL,
ADD COLUMN     "circuitStepId" TEXT NOT NULL,
ADD COLUMN     "correspondantId" TEXT,
ADD COLUMN     "documentId" TEXT NOT NULL,
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "instance_circuit_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_pkey",
DROP COLUMN "dependsOnUuid",
DROP COLUMN "documentUuid",
DROP COLUMN "utilisateurUuid",
DROP COLUMN "utilisateurUuid2",
DROP COLUMN "uuid",
DROP COLUMN "validatetionUuid",
ADD COLUMN     "documentId" TEXT NOT NULL,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "userId" TEXT NOT NULL,
ADD COLUMN     "userId2" TEXT,
ADD COLUMN     "validationId" TEXT,
DROP COLUMN "priorite",
ADD COLUMN     "priorite" "InstructionPriorite" NOT NULL,
DROP COLUMN "statut",
ADD COLUMN     "statut" "InstructionStatus" NOT NULL,
ADD CONSTRAINT "instruction_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "notification" DROP CONSTRAINT "notification_pkey",
DROP COLUMN "documentUuid",
DROP COLUMN "utilisateurUuid",
DROP COLUMN "uuid",
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "message" SET DATA TYPE TEXT,
DROP COLUMN "statut",
ADD COLUMN     "statut" "NotificationStatus" NOT NULL,
DROP COLUMN "canal",
ADD COLUMN     "canal" "CanalType" NOT NULL,
ADD CONSTRAINT "notification_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "permission" DROP CONSTRAINT "permission_pkey",
DROP COLUMN "noms",
DROP COLUMN "uuid",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "name" VARCHAR(10),
ADD CONSTRAINT "permission_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "role" DROP CONSTRAINT "role_pkey",
DROP COLUMN "affectationUuid",
DROP COLUMN "etapeCircuitUuid",
DROP COLUMN "nom",
DROP COLUMN "uuid",
ADD COLUMN     "assignmentId" TEXT NOT NULL,
ADD COLUMN     "circuitStepId" TEXT,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "name" VARCHAR(50),
ADD COLUMN     "status" "RoleStatus" NOT NULL,
ADD CONSTRAINT "role_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_pkey",
DROP COLUMN "permissionUuid",
DROP COLUMN "roleUuid",
ADD COLUMN     "permissionId" TEXT NOT NULL,
ADD COLUMN     "roleId" TEXT NOT NULL,
ADD CONSTRAINT "role_permission_pkey" PRIMARY KEY ("permissionId", "roleId");

-- AlterTable
ALTER TABLE "service" DROP CONSTRAINT "service_pkey",
DROP COLUMN "nom",
DROP COLUMN "uuid",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "name" VARCHAR(100) NOT NULL,
ADD CONSTRAINT "service_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "site" DROP CONSTRAINT "site_pkey",
DROP COLUMN "nom",
DROP COLUMN "uuid",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "name" VARCHAR(100) NOT NULL,
ADD COLUMN     "status" "SiteStatus" NOT NULL,
ADD CONSTRAINT "site_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "affectation";

-- DropTable
DROP TABLE "etape_circuit";

-- DropTable
DROP TABLE "etape_circuit_instance_circuit";

-- DropTable
DROP TABLE "utilisateur";

-- DropTable
DROP TABLE "utilisateur_service";

-- DropTable
DROP TABLE "validatetion";

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "refreshToken" TEXT,
    "status" "UserStatus" NOT NULL,
    "isVerified" BOOLEAN NOT NULL,
    "isConnected" BOOLEAN NOT NULL,
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
CREATE TABLE "user_notification" (
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_notification_pkey" PRIMARY KEY ("userId","notificationId")
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
CREATE TABLE "assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuit_step" (
    "id" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "actionType" VARCHAR(100),
    "maxDelayHours" INTEGER,
    "parentCircuitStepId" TEXT,
    "docs" VARCHAR(10),
    "state" VARCHAR(10),
    "condition" TEXT,
    "roleId" TEXT,

    CONSTRAINT "circuit_step_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "document_number_key" ON "document"("number");

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
ALTER TABLE "document" ADD CONSTRAINT "document_parentDocumentId_fkey" FOREIGN KEY ("parentDocumentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_correspondantId_fkey" FOREIGN KEY ("correspondantId") REFERENCES "correspondant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
