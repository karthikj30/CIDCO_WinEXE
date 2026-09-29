-- Written to be safe on a database that already has some or all of this —
-- for example one where `prisma db push` was run against the new schema
-- before this migration. Every object is created only if it is missing, and
-- the data move skips rows it has already moved, so running it again changes
-- nothing.

-- AlterTable
ALTER TABLE "api_readings" ADD COLUMN IF NOT EXISTS "companyRecordId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_readings_companyRecordId_idx" ON "api_readings"("companyRecordId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_readings_companyRecordId_fkey') THEN
    ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;


-- Readings already posted by a handshake that is linked to a site take that
-- site now, so the dashboard shows them without waiting for new data.
UPDATE "api_readings" r
   SET "companyRecordId" = h."companyRecordId"
  FROM "architect_handshakes" h
 WHERE r."handshakeId" = h."id"
   AND r."companyRecordId" IS NULL
   AND h."companyRecordId" IS NOT NULL;
