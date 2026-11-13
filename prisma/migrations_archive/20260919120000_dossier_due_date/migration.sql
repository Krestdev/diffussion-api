-- Target completion date; an active dossier past it is marked LATE.
ALTER TABLE "dossier" ADD COLUMN "dueDate" TIMESTAMP(3);
