-- Journal d'audit « Appareil » and « Lieu » (as EXPENZO): the author's User-Agent and place.
ALTER TABLE "activity_log" ADD COLUMN "userAgent" VARCHAR(500),
ADD COLUMN "location" VARCHAR(120);
