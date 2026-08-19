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

-- AlterTable
ALTER TABLE "affectation" DROP CONSTRAINT "affectation_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "utilisateurUuid" SET DATA TYPE TEXT,
ALTER COLUMN "siteUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "affectation_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "affectation_uuid_seq";

-- AlterTable
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "utilisateurUuid" SET DATA TYPE TEXT,
ALTER COLUMN "entityUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "audit_log_uuid_seq";

-- AlterTable
ALTER TABLE "category" DROP CONSTRAINT "category_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "category_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "category_uuid_seq";

-- AlterTable
ALTER TABLE "circuit" DROP CONSTRAINT "circuit_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "roleUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "circuit_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "circuit_uuid_seq";

-- AlterTable
ALTER TABLE "correspondant" DROP CONSTRAINT "correspondant_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "correspondant_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "correspondant_uuid_seq";

-- AlterTable
ALTER TABLE "document" DROP CONSTRAINT "document_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "parentDocumentUuid" SET DATA TYPE TEXT,
ALTER COLUMN "categoryUuid" SET DATA TYPE TEXT,
ALTER COLUMN "correspondantUuid" SET DATA TYPE TEXT,
ALTER COLUMN "parentVersionUuid" SET DATA TYPE TEXT,
ALTER COLUMN "dechargeByUuid" SET DATA TYPE TEXT,
ALTER COLUMN "siteUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "document_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "document_uuid_seq";

-- AlterTable
ALTER TABLE "etape_circuit" DROP CONSTRAINT "etape_circuit_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "circuitUuid" SET DATA TYPE TEXT,
ALTER COLUMN "parentEtapeCircuitUuid" SET DATA TYPE TEXT,
ALTER COLUMN "roleUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "etape_circuit_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "etape_circuit_uuid_seq";

-- AlterTable
ALTER TABLE "etape_circuit_instance_circuit" DROP CONSTRAINT "etape_circuit_instance_circuit_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "etapeCircuitUuid" SET DATA TYPE TEXT,
ALTER COLUMN "instanceCircuitUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "etape_circuit_instance_circuit_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "etape_circuit_instance_circuit_uuid_seq";

-- AlterTable
ALTER TABLE "instance_circuit" DROP CONSTRAINT "instance_circuit_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "documentUuid" SET DATA TYPE TEXT,
ALTER COLUMN "circuitUuid" SET DATA TYPE TEXT,
ALTER COLUMN "etapeCircuitUuid" SET DATA TYPE TEXT,
ALTER COLUMN "correspondantUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "instance_circuit_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "instance_circuit_uuid_seq";

-- AlterTable
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "utilisateurUuid" SET DATA TYPE TEXT,
ALTER COLUMN "utilisateurUuid2" SET DATA TYPE TEXT,
ALTER COLUMN "documentUuid" SET DATA TYPE TEXT,
ALTER COLUMN "dependsOnUuid" SET DATA TYPE TEXT,
ALTER COLUMN "validatetionUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "instruction_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "instruction_uuid_seq";

-- AlterTable
ALTER TABLE "notification" DROP CONSTRAINT "notification_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "utilisateurUuid" SET DATA TYPE TEXT,
ALTER COLUMN "documentUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "notification_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "notification_uuid_seq";

-- AlterTable
ALTER TABLE "permission" DROP CONSTRAINT "permission_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "permission_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "permission_uuid_seq";

-- AlterTable
ALTER TABLE "role" DROP CONSTRAINT "role_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "affectationUuid" SET DATA TYPE TEXT,
ALTER COLUMN "etapeCircuitUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "role_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "role_uuid_seq";

-- AlterTable
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_pkey",
ALTER COLUMN "permissionUuid" SET DATA TYPE TEXT,
ALTER COLUMN "roleUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "role_permission_pkey" PRIMARY KEY ("permissionUuid", "roleUuid");

-- AlterTable
ALTER TABLE "service" DROP CONSTRAINT "service_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "service_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "service_uuid_seq";

-- AlterTable
ALTER TABLE "site" DROP CONSTRAINT "site_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "site_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "site_uuid_seq";

-- AlterTable
ALTER TABLE "utilisateur" DROP CONSTRAINT "utilisateur_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "utilisateur_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "utilisateur_uuid_seq";

-- AlterTable
ALTER TABLE "utilisateur_service" DROP CONSTRAINT "utilisateur_service_pkey",
ALTER COLUMN "utilisateurUuid" SET DATA TYPE TEXT,
ALTER COLUMN "serviceUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "utilisateur_service_pkey" PRIMARY KEY ("utilisateurUuid", "serviceUuid");

-- AlterTable
ALTER TABLE "validatetion" DROP CONSTRAINT "validatetion_pkey",
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "uuid" SET DATA TYPE TEXT,
ALTER COLUMN "instanceCircuitUuid" SET DATA TYPE TEXT,
ALTER COLUMN "utilisateurUuid" SET DATA TYPE TEXT,
ADD CONSTRAINT "validatetion_pkey" PRIMARY KEY ("uuid");
DROP SEQUENCE "validatetion_uuid_seq";

-- AddForeignKey
ALTER TABLE "utilisateur_service" ADD CONSTRAINT "utilisateur_service_utilisateurUuid_fkey" FOREIGN KEY ("utilisateurUuid") REFERENCES "utilisateur"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utilisateur_service" ADD CONSTRAINT "utilisateur_service_serviceUuid_fkey" FOREIGN KEY ("serviceUuid") REFERENCES "service"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_utilisateurUuid_fkey" FOREIGN KEY ("utilisateurUuid") REFERENCES "utilisateur"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_utilisateurUuid_fkey" FOREIGN KEY ("utilisateurUuid") REFERENCES "utilisateur"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_documentUuid_fkey" FOREIGN KEY ("documentUuid") REFERENCES "document"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_parentDocumentUuid_fkey" FOREIGN KEY ("parentDocumentUuid") REFERENCES "document"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_categoryUuid_fkey" FOREIGN KEY ("categoryUuid") REFERENCES "category"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_correspondantUuid_fkey" FOREIGN KEY ("correspondantUuid") REFERENCES "correspondant"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_dechargeByUuid_fkey" FOREIGN KEY ("dechargeByUuid") REFERENCES "utilisateur"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_siteUuid_fkey" FOREIGN KEY ("siteUuid") REFERENCES "site"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_documentUuid_fkey" FOREIGN KEY ("documentUuid") REFERENCES "document"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_utilisateurUuid_fkey" FOREIGN KEY ("utilisateurUuid") REFERENCES "utilisateur"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_utilisateurUuid2_fkey" FOREIGN KEY ("utilisateurUuid2") REFERENCES "utilisateur"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_dependsOnUuid_fkey" FOREIGN KEY ("dependsOnUuid") REFERENCES "instruction"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_validatetionUuid_fkey" FOREIGN KEY ("validatetionUuid") REFERENCES "validatetion"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validatetion" ADD CONSTRAINT "validatetion_utilisateurUuid_fkey" FOREIGN KEY ("utilisateurUuid") REFERENCES "utilisateur"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validatetion" ADD CONSTRAINT "validatetion_instanceCircuitUuid_fkey" FOREIGN KEY ("instanceCircuitUuid") REFERENCES "instance_circuit"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affectation" ADD CONSTRAINT "affectation_utilisateurUuid_fkey" FOREIGN KEY ("utilisateurUuid") REFERENCES "utilisateur"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affectation" ADD CONSTRAINT "affectation_siteUuid_fkey" FOREIGN KEY ("siteUuid") REFERENCES "site"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_affectationUuid_fkey" FOREIGN KEY ("affectationUuid") REFERENCES "affectation"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_etapeCircuitUuid_fkey" FOREIGN KEY ("etapeCircuitUuid") REFERENCES "etape_circuit"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionUuid_fkey" FOREIGN KEY ("permissionUuid") REFERENCES "permission"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleUuid_fkey" FOREIGN KEY ("roleUuid") REFERENCES "role"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit" ADD CONSTRAINT "circuit_roleUuid_fkey" FOREIGN KEY ("roleUuid") REFERENCES "role"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etape_circuit" ADD CONSTRAINT "etape_circuit_circuitUuid_fkey" FOREIGN KEY ("circuitUuid") REFERENCES "circuit"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etape_circuit" ADD CONSTRAINT "etape_circuit_parentEtapeCircuitUuid_fkey" FOREIGN KEY ("parentEtapeCircuitUuid") REFERENCES "etape_circuit"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etape_circuit" ADD CONSTRAINT "etape_circuit_roleUuid_fkey" FOREIGN KEY ("roleUuid") REFERENCES "role"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_documentUuid_fkey" FOREIGN KEY ("documentUuid") REFERENCES "document"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_circuitUuid_fkey" FOREIGN KEY ("circuitUuid") REFERENCES "circuit"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_etapeCircuitUuid_fkey" FOREIGN KEY ("etapeCircuitUuid") REFERENCES "etape_circuit"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_correspondantUuid_fkey" FOREIGN KEY ("correspondantUuid") REFERENCES "correspondant"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etape_circuit_instance_circuit" ADD CONSTRAINT "etape_circuit_instance_circuit_etapeCircuitUuid_fkey" FOREIGN KEY ("etapeCircuitUuid") REFERENCES "etape_circuit"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etape_circuit_instance_circuit" ADD CONSTRAINT "etape_circuit_instance_circuit_instanceCircuitUuid_fkey" FOREIGN KEY ("instanceCircuitUuid") REFERENCES "instance_circuit"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

