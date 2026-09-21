-- The filed file is now named after the delivery time alone:
--
--     <companyId>/<dd_mm_yyyy>/<hh-mm-ss>.csv
--
-- so `fileName` no longer carries the company id. `deliveredName` keeps the
-- flat name the agent sent (companyId_dd_mm_yyyy_hh-mm-ss_AQI.csv), which is
-- what step 4 of the ingestion service validates.
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "deliveredName" TEXT;
