-- CreateTable
CREATE TABLE "service" (
    "uuid" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nom" VARCHAR(100) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "utilisateur" (
    "uuid" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utilisateur_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "utilisateur_service" (
    "utilisateurUuid" INTEGER NOT NULL,
    "serviceUuid" INTEGER NOT NULL,

    CONSTRAINT "utilisateur_service_pkey" PRIMARY KEY ("utilisateurUuid","serviceUuid")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "uuid" SERIAL NOT NULL,
    "utilisateurUuid" INTEGER NOT NULL,
    "actions" VARCHAR(10) NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "entityUuid" INTEGER,
    "entityType" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "notification" (
    "uuid" SERIAL NOT NULL,
    "utilisateurUuid" INTEGER NOT NULL,
    "documentUuid" INTEGER,
    "type" VARCHAR(20) NOT NULL,
    "message" VARCHAR(255),
    "statut" VARCHAR(10),
    "canal" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "document" (
    "uuid" SERIAL NOT NULL,
    "documentType" VARCHAR(10) NOT NULL,
    "type" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentDocumentUuid" INTEGER,
    "categoryUuid" INTEGER,
    "correspondantUuid" INTEGER,
    "status" VARCHAR(10),
    "date" TIMESTAMP(3),
    "libelle" VARCHAR(100),
    "directory" INTEGER,
    "reference" INTEGER,
    "canal" INTEGER,
    "nombreExemplaires" INTEGER,
    "parentVersionUuid" INTEGER,
    "numeroVersion" INTEGER,

    CONSTRAINT "document_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "instruction" (
    "uuid" SERIAL NOT NULL,
    "utilisateurUuid" INTEGER NOT NULL,
    "utilisateurUuid2" INTEGER,
    "documentUuid" INTEGER NOT NULL,
    "libelle" VARCHAR(100) NOT NULL,
    "priorite" VARCHAR(20),
    "echeance" TIMESTAMP(3),
    "statut" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "dependsOnUuid" INTEGER,
    "validatetionUuid" INTEGER,

    CONSTRAINT "instruction_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "category" (
    "uuid" SERIAL NOT NULL,
    "libelle" VARCHAR(100),
    "type" VARCHAR(10),
    "dureeConservation" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "category_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "correspondant" (
    "uuid" SERIAL NOT NULL,
    "noms" VARCHAR(100),
    "type" VARCHAR(10),
    "ville" VARCHAR(100),
    "status" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correspondant_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "validatetion" (
    "uuid" SERIAL NOT NULL,
    "decision" VARCHAR(255),
    "instanceCircuitUuid" INTEGER,
    "motif" VARCHAR(255),
    "dateDecision" TIMESTAMP(3),
    "utilisateurUuid" INTEGER NOT NULL,

    CONSTRAINT "validatetion_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "site" (
    "uuid" SERIAL NOT NULL,
    "nom" VARCHAR(100) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "affectation" (
    "uuid" SERIAL NOT NULL,
    "utilisateurUuid" INTEGER NOT NULL,
    "siteUuid" INTEGER NOT NULL,

    CONSTRAINT "affectation_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "permission" (
    "uuid" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "noms" VARCHAR(10),

    CONSTRAINT "permission_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "role" (
    "uuid" SERIAL NOT NULL,
    "affectationUuid" INTEGER NOT NULL,
    "etapeCircuitUuid" INTEGER,

    CONSTRAINT "role_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "permissionUuid" INTEGER NOT NULL,
    "roleUuid" INTEGER NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("permissionUuid","roleUuid")
);

-- CreateTable
CREATE TABLE "circuit" (
    "uuid" SERIAL NOT NULL,
    "roleUuid" INTEGER,
    "nom" VARCHAR(100),
    "typeDossierUuid" INTEGER,

    CONSTRAINT "circuit_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "etape_circuit" (
    "uuid" SERIAL NOT NULL,
    "circuitUuid" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "typeAction" VARCHAR(100),
    "delaiMaxH" INTEGER,
    "parentEtapeCircuitUuid" INTEGER,
    "docs" VARCHAR(10),
    "state" VARCHAR(10),
    "condition" VARCHAR(255),
    "roleUuid" INTEGER,

    CONSTRAINT "etape_circuit_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "instance_circuit" (
    "uuid" SERIAL NOT NULL,
    "documentUuid" INTEGER NOT NULL,
    "circuitUuid" INTEGER NOT NULL,
    "etapeCircuitUuid" INTEGER NOT NULL,
    "correspondantUuid" INTEGER,

    CONSTRAINT "instance_circuit_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "etape_circuit_instance_circuit" (
    "uuid" SERIAL NOT NULL,
    "etapeCircuitUuid" INTEGER NOT NULL,
    "instanceCircuitUuid" INTEGER NOT NULL,

    CONSTRAINT "etape_circuit_instance_circuit_pkey" PRIMARY KEY ("uuid")
);

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
