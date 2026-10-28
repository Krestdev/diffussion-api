-- Not subscribing to a task: the executant gives a motif and leaves the
-- task; once no executant is left, it goes back to its creator
-- (NON_SOUSCRITE, formerly REFUSEE). Every subscription decision is kept,
-- with its motif.

ALTER TYPE "InstructionStatus" RENAME VALUE 'REFUSEE' TO 'NON_SOUSCRITE';

CREATE TYPE "SubscriptionDecision" AS ENUM ('SOUSCRITE', 'NON_SOUSCRITE');

CREATE TABLE "instruction_subscription" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "SubscriptionDecision" NOT NULL,
    "motif" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instruction_subscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "instruction_subscription_instructionId_idx" ON "instruction_subscription"("instructionId");

ALTER TABLE "instruction_subscription" ADD CONSTRAINT "instruction_subscription_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "instruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instruction_subscription" ADD CONSTRAINT "instruction_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
