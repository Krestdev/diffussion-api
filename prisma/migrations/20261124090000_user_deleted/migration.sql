-- Users deleted in the core while their history is kept (contract C9, owner 2026-11-17): the
-- directory sends them with status DEACTIVATED and their deletion date. The copy stays (names on
-- decisions, comments, journal, documents, notifications) and is left out of every list and picker.
ALTER TABLE "user" ADD COLUMN "deletedAt" TIMESTAMP(3);
