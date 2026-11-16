-- Workflow engine (owner decisions, 2026-11-15): every status change of Diffusion's workflow
-- entities goes through src/workflow (as EXPENZO's) and is recorded here, in the same
-- transaction as the change. Append-only.
CREATE TABLE "status_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "entity" VARCHAR(50) NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" VARCHAR(50) NOT NULL,
    "fromStatus" VARCHAR(50),
    "toStatus" VARCHAR(50) NOT NULL,
    "event" VARCHAR(50) NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(64),

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "status_history_entity_entityId_idx" ON "status_history"("entity", "entityId");
CREATE INDEX "status_history_companyId_createdAt_idx" ON "status_history"("companyId", "createdAt");
