-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "dischargeRemindedAt" TIMESTAMP(3),
ADD COLUMN     "dueReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "overdueRemindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "instruction" ADD COLUMN     "dueReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "overdueRemindedAt" TIMESTAMP(3);

