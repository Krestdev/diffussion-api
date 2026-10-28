-- Entries recorded inside an authenticated request are that user's actions,
-- but record() used to default them to SYSTEM. Only user actions are shown
-- in the audit journal now; align the existing rows with the new default.
UPDATE "activity_log" SET "source" = 'USER' WHERE "userId" IS NOT NULL AND "source" = 'SYSTEM';
