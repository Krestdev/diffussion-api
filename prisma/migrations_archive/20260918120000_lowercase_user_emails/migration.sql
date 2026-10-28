-- Emails are now normalized to lowercase at the API boundary (NormalizeEmail
-- transform). Bring existing rows in line so logins keep matching. Fails on
-- the unique index if two accounts differ only by case: resolve those manually.
UPDATE "user" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));
