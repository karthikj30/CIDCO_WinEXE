-- AlterTable
ALTER TABLE "api_readings" ADD COLUMN     "companyRecordId" TEXT;

-- CreateIndex
CREATE INDEX "api_readings_companyRecordId_idx" ON "api_readings"("companyRecordId");

-- AddForeignKey
ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Readings already posted by a handshake that is linked to a site take that
-- site now, so the dashboard shows them without waiting for new data.
UPDATE "api_readings" r
   SET "companyRecordId" = h."companyRecordId"
  FROM "architect_handshakes" h
 WHERE r."handshakeId" = h."id"
   AND r."companyRecordId" IS NULL
   AND h."companyRecordId" IS NOT NULL;
