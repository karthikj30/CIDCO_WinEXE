-- Where CIDCO says a site is, so a delivery's own position can be checked
-- against it on the monitoring map.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "registeredLatitude"  DOUBLE PRECISION;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "registeredLongitude" DOUBLE PRECISION;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "permittedRadiusMetres" INTEGER NOT NULL DEFAULT 500;
