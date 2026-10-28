-- AlterTable
ALTER TABLE "utilisateur"
  ADD COLUMN "email" VARCHAR(255) NOT NULL,
  ADD COLUMN "password" VARCHAR(255) NOT NULL,
  ADD COLUMN "refreshToken" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "utilisateur_email_key" ON "utilisateur"("email");
