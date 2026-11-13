-- Two deadlines per task: the task's (dueDate, set by its creator) and the
-- executants' (agentDueDate, set by the superviseur, or the creator when
-- there is none). Overdue alerts are sent once (the *NotifiedAt columns).
-- The cycle only moves when the creator changes what is asked once work
-- has started; corrections keep it, and each validation records it.

-- AlterTable
ALTER TABLE "instruction" ADD COLUMN     "agentDueDate" TIMESTAMP(3),
ADD COLUMN     "agentOverdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "cycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "validation" ADD COLUMN     "cycle" INTEGER;
