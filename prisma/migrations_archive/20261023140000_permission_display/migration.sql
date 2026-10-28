-- Whether a permission is listed in the role screens (GET /permissions). All
-- of them stay listed until told otherwise; a hidden one is still checked
-- wherever a route requires it.
ALTER TABLE "permission" ADD COLUMN "display" BOOLEAN NOT NULL DEFAULT true;
