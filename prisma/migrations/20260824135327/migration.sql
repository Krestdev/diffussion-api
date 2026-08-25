/*
  Warnings:

  - You are about to drop the `system_log` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('info', 'warn', 'error');

-- DropTable
DROP TABLE "system_log";

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "userId" TEXT,
    "actorLabel" VARCHAR(100),
    "source" "ActivitySource" NOT NULL,
    "level" "ActivityLevel" NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(50),
    "entityId" TEXT,
    "message" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "stack" TEXT,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_log_requestId_idx" ON "activity_log"("requestId");

-- CreateIndex
CREATE INDEX "activity_log_entityType_entityId_idx" ON "activity_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_log_userId_createdAt_idx" ON "activity_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_log_source_createdAt_idx" ON "activity_log"("source", "createdAt");
