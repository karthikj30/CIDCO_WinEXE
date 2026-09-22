-- Where the station stands, taken from the name the agent sends.
-- Null for every file delivered before the agent collected a position.
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "latitude"  DOUBLE PRECISION;
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
