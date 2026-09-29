-- Written to be safe on a database that already has some or all of this —
-- for example one where `prisma db push` was run against the new schema
-- before this migration. Every object is created only if it is missing, and
-- the data move skips rows it has already moved, so running it again changes
-- nothing.

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "apiReadingId" TEXT,
ADD COLUMN IF NOT EXISTS "sftpReadingId" TEXT,
ALTER COLUMN "reportId" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "sftp_readings" (
    "id" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "source" "ReportSource" NOT NULL DEFAULT 'SFTP',
    "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "siteName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "aqiValue" INTEGER NOT NULL,
    "pm25" DOUBLE PRECISION,
    "pm10" DOUBLE PRECISION,
    "so2" DOUBLE PRECISION,
    "no2" DOUBLE PRECISION,
    "co" DOUBLE PRECISION,
    "ozone" DOUBLE PRECISION,
    "remarks" TEXT,
    "projectSiteId" TEXT,
    "monitoringStationId" TEXT,
    "oem" TEXT,
    "deviceModel" TEXT,
    "temperature" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "integrationMethod" TEXT,
    "otherParams" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyRecordId" TEXT,
    "dataFileId" TEXT,
    "deliveredName" TEXT,

    CONSTRAINT "sftp_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_readings" (
    "id" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "source" "ReportSource" NOT NULL DEFAULT 'API',
    "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "siteName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "aqiValue" INTEGER NOT NULL,
    "pm25" DOUBLE PRECISION,
    "pm10" DOUBLE PRECISION,
    "so2" DOUBLE PRECISION,
    "no2" DOUBLE PRECISION,
    "co" DOUBLE PRECISION,
    "ozone" DOUBLE PRECISION,
    "remarks" TEXT,
    "projectSiteId" TEXT,
    "monitoringStationId" TEXT,
    "oem" TEXT,
    "deviceModel" TEXT,
    "temperature" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "integrationMethod" TEXT,
    "otherParams" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "handshakeId" TEXT,
    "tokenPrefix" TEXT,
    "sourceIp" TEXT,

    CONSTRAINT "api_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sftp_readings_referenceNo_key" ON "sftp_readings"("referenceNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sftp_readings_userId_idx" ON "sftp_readings"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sftp_readings_measuredAt_idx" ON "sftp_readings"("measuredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sftp_readings_status_idx" ON "sftp_readings"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sftp_readings_monitoringStationId_idx" ON "sftp_readings"("monitoringStationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sftp_readings_projectSiteId_idx" ON "sftp_readings"("projectSiteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sftp_readings_companyRecordId_idx" ON "sftp_readings"("companyRecordId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sftp_readings_dataFileId_idx" ON "sftp_readings"("dataFileId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "api_readings_referenceNo_key" ON "api_readings"("referenceNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_readings_userId_idx" ON "api_readings"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_readings_measuredAt_idx" ON "api_readings"("measuredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_readings_status_idx" ON "api_readings"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_readings_monitoringStationId_idx" ON "api_readings"("monitoringStationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_readings_projectSiteId_idx" ON "api_readings"("projectSiteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_readings_handshakeId_idx" ON "api_readings"("handshakeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attachments_sftpReadingId_idx" ON "attachments"("sftpReadingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attachments_apiReadingId_idx" ON "attachments"("apiReadingId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sftp_readings_userId_fkey') THEN
    ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sftp_readings_projectId_fkey') THEN
    ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sftp_readings_companyRecordId_fkey') THEN
    ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sftp_readings_dataFileId_fkey') THEN
    ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_dataFileId_fkey" FOREIGN KEY ("dataFileId") REFERENCES "data_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_readings_userId_fkey') THEN
    ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_readings_projectId_fkey') THEN
    ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_readings_handshakeId_fkey') THEN
    ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_sftpReadingId_fkey') THEN
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sftpReadingId_fkey" FOREIGN KEY ("sftpReadingId") REFERENCES "sftp_readings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_apiReadingId_fkey') THEN
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_apiReadingId_fkey" FOREIGN KEY ("apiReadingId") REFERENCES "api_readings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RenameIndex (only where an older database still carries the pre-rename name)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'companies_companyId_key') THEN
    ALTER INDEX "companies_companyId_key" RENAME TO "companies_siteName_key";
  END IF;
END
$$;



-- ---------------------------------------------------------------------------
-- Move the readings already stored into the channel table they belong to.
--
-- "reports" keeps only what CIDCO received by hand (the web form and CSV
-- uploads). Everything an agent delivered over SFTP, and everything posted to
-- the REST API, moves to its own table. Reference numbers gain the channel in
-- the middle so the three sequences cannot collide.
--
-- Safe to repeat: a row whose id is already in the channel table is skipped,
-- and only rows that did arrive there are removed from "reports". If the
-- channel table already issued the rewritten number to a newer reading, the
-- moved one keeps its old number instead of either of them being lost.
-- ---------------------------------------------------------------------------

INSERT INTO "sftp_readings" (
  "id", "referenceNo", "userId", "projectId", "source", "status",
  "siteName", "location", "latitude", "longitude", "measuredAt", "aqiValue",
  "pm25", "pm10", "so2", "no2", "co", "ozone", "remarks",
  "projectSiteId", "monitoringStationId", "oem", "deviceModel",
  "temperature", "humidity", "integrationMethod", "otherParams", "receivedAt",
  "reviewedBy", "reviewNote", "reviewedAt", "createdAt", "updatedAt",
  "companyRecordId"
)
SELECT
  r."id",
  CASE WHEN EXISTS (SELECT 1 FROM "sftp_readings" s
                     WHERE s."referenceNo" = regexp_replace(r."referenceNo", '^CIDCO/AQI/', 'CIDCO/AQI/SFTP/'))
       THEN r."referenceNo"
       ELSE regexp_replace(r."referenceNo", '^CIDCO/AQI/', 'CIDCO/AQI/SFTP/') END,
  r."userId", r."projectId", r."source", r."status",
  r."siteName", r."location", r."latitude", r."longitude", r."measuredAt", r."aqiValue",
  r."pm25", r."pm10", r."so2", r."no2", r."co", r."ozone", r."remarks",
  r."projectSiteId", r."monitoringStationId", r."oem", r."deviceModel",
  r."temperature", r."humidity", r."integrationMethod", r."otherParams", r."receivedAt",
  r."reviewedBy", r."reviewNote", r."reviewedAt", r."createdAt", r."updatedAt",
  r."companyRecordId"
FROM "reports" r
WHERE r."source" = 'SFTP'
  AND NOT EXISTS (SELECT 1 FROM "sftp_readings" s WHERE s."id" = r."id")
ON CONFLICT DO NOTHING;

INSERT INTO "api_readings" (
  "id", "referenceNo", "userId", "projectId", "source", "status",
  "siteName", "location", "latitude", "longitude", "measuredAt", "aqiValue",
  "pm25", "pm10", "so2", "no2", "co", "ozone", "remarks",
  "projectSiteId", "monitoringStationId", "oem", "deviceModel",
  "temperature", "humidity", "integrationMethod", "otherParams", "receivedAt",
  "reviewedBy", "reviewNote", "reviewedAt", "createdAt", "updatedAt"
)
SELECT
  r."id",
  CASE WHEN EXISTS (SELECT 1 FROM "api_readings" a
                     WHERE a."referenceNo" = regexp_replace(r."referenceNo", '^CIDCO/AQI/', 'CIDCO/AQI/API/'))
       THEN r."referenceNo"
       ELSE regexp_replace(r."referenceNo", '^CIDCO/AQI/', 'CIDCO/AQI/API/') END,
  r."userId", r."projectId", r."source", r."status",
  r."siteName", r."location", r."latitude", r."longitude", r."measuredAt", r."aqiValue",
  r."pm25", r."pm10", r."so2", r."no2", r."co", r."ozone", r."remarks",
  r."projectSiteId", r."monitoringStationId", r."oem", r."deviceModel",
  r."temperature", r."humidity", r."integrationMethod", r."otherParams", r."receivedAt",
  r."reviewedBy", r."reviewNote", r."reviewedAt", r."createdAt", r."updatedAt"
FROM "reports" r
WHERE r."source" = 'API'
  AND NOT EXISTS (SELECT 1 FROM "api_readings" a WHERE a."id" = r."id")
ON CONFLICT DO NOTHING;

-- The moved rows keep their ids, so an attachment follows its reading simply
-- by moving which pointer is set.
UPDATE "attachments" a
   SET "sftpReadingId" = a."reportId", "reportId" = NULL
  FROM "sftp_readings" r WHERE a."reportId" = r."id";

UPDATE "attachments" a
   SET "apiReadingId" = a."reportId", "reportId" = NULL
  FROM "api_readings" r WHERE a."reportId" = r."id";

-- Only what actually arrived in a channel table leaves "reports".
DELETE FROM "reports" r
 WHERE (r."source" = 'SFTP' AND EXISTS (SELECT 1 FROM "sftp_readings" s WHERE s."id" = r."id"))
    OR (r."source" = 'API'  AND EXISTS (SELECT 1 FROM "api_readings"  a WHERE a."id" = r."id"));
