-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- AlterTable
ALTER TABLE "role" ADD COLUMN     "formerUsersCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "correspondent_contact" (
    "id" TEXT NOT NULL,
    "correspondentId" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "position" VARCHAR(150),
    "phone" VARCHAR(30),
    "email" VARCHAR(150),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correspondent_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "priority" VARCHAR(30) NOT NULL,
    "page" VARCHAR(500),
    "description" TEXT NOT NULL,
    "technicalInfo" JSONB,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "requesterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_message" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "fromSupport" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(150) NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_sequence" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "support_sequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "help_feedback" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "userId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "correspondent_contact_correspondentId_idx" ON "correspondent_contact"("correspondentId");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_number_key" ON "support_ticket"("number");

-- CreateIndex
CREATE INDEX "support_ticket_requesterId_idx" ON "support_ticket"("requesterId");

-- CreateIndex
CREATE INDEX "support_message_ticketId_idx" ON "support_message"("ticketId");

-- CreateIndex
CREATE INDEX "support_attachment_ticketId_idx" ON "support_attachment"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "help_feedback_slug_userId_key" ON "help_feedback"("slug", "userId");

-- AddForeignKey
ALTER TABLE "correspondent_contact" ADD CONSTRAINT "correspondent_contact_correspondentId_fkey" FOREIGN KEY ("correspondentId") REFERENCES "correspondent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_feedback" ADD CONSTRAINT "help_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Archiving a project gets its own permission: whoever could already do it
-- (ADMIN_MANAGE_REFERENTIALS) keeps it.
INSERT INTO "permission" ("id", "code", "description", "display", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'PROJECT_ARCHIVE', 'Archiver un projet', true, now(), now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT p."id", rp."roleId"
FROM "permission" p
JOIN "role_permission" rp ON rp."permissionId" = (
  SELECT "id" FROM "permission" WHERE "code" = 'ADMIN_MANAGE_REFERENTIALS'
)
WHERE p."code" = 'PROJECT_ARCHIVE'
ON CONFLICT DO NOTHING;

-- Roles already archived: their holders count, from the audit journal.
UPDATE "role" r
SET "formerUsersCount" = COALESCE((
  SELECT (l."metadata"->>'holders')::int
  FROM "activity_log" l
  WHERE l."entityType" = 'role' AND l."entityId" = r."id"
    AND l."action" = 'role.archived' AND l."metadata" ? 'holders'
  ORDER BY l."createdAt" DESC
  LIMIT 1
), 0)
WHERE r."archivedAt" IS NOT NULL;
