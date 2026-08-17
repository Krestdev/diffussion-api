-- AlterTable: widen status/canal to fit real French vocabulary, switch
-- reference to string (courrier references are alphanumeric), decouple
-- décharge from the status state machine.
ALTER TABLE "document"
  ALTER COLUMN "status" TYPE VARCHAR(30),
  ALTER COLUMN "canal" TYPE VARCHAR(30),
  ALTER COLUMN "reference" TYPE VARCHAR(30) USING "reference"::text,
  ADD COLUMN "dechargeCachet" BOOLEAN,
  ADD COLUMN "dateReception" TIMESTAMP(3);

ALTER TABLE "instruction"
  ALTER COLUMN "statut" TYPE VARCHAR(30);
