-- Diffusion moves onto the CREAPP core: people sign in at the core, so the
-- passwords, refresh tokens, reset links and invitations go. Sites are the
-- core's companies and people the core's users (same ids), written by the
-- directory sync. Existing sites and accounts are kept: the sync matches them
-- to the core's (by name / email, or CORE_SITE_LINKS) and gives them the
-- core's id (every foreign key to "site" and "user" cascades on update).

-- DropForeignKey
ALTER TABLE "password_reset_token" DROP CONSTRAINT "password_reset_token_userId_fkey";

-- DropForeignKey
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_siteId_fkey";

-- DropForeignKey
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_roleId_fkey";

-- DropForeignKey
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_invitedById_fkey";

-- DropForeignKey
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_userId_fkey";

-- AlterTable
ALTER TABLE "user" DROP COLUMN "isConnected",
DROP COLUMN "isVerified",
DROP COLUMN "mustChangePassword",
DROP COLUMN "password",
DROP COLUMN "refreshToken",
ADD COLUMN     "coreSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "site" ADD COLUMN     "coreSyncedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "password_reset_token";

-- DropTable
DROP TABLE "invitation";
