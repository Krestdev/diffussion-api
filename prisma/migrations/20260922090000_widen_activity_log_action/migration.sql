-- Request-scoped root entries store "METHOD /url", which overflowed 100 chars
-- on longer routes and failed the whole request.
ALTER TABLE "activity_log" ALTER COLUMN "action" SET DATA TYPE VARCHAR(255);
