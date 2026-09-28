-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "apiReadingId" TEXT,
ADD COLUMN     "sftpReadingId" TEXT,
ALTER COLUMN "reportId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sftp_readings" (
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
CREATE TABLE "api_readings" (
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
CREATE UNIQUE INDEX "sftp_readings_referenceNo_key" ON "sftp_readings"("referenceNo");

-- CreateIndex
CREATE INDEX "sftp_readings_userId_idx" ON "sftp_readings"("userId");

-- CreateIndex
CREATE INDEX "sftp_readings_measuredAt_idx" ON "sftp_readings"("measuredAt");

-- CreateIndex
CREATE INDEX "sftp_readings_status_idx" ON "sftp_readings"("status");

-- CreateIndex
CREATE INDEX "sftp_readings_monitoringStationId_idx" ON "sftp_readings"("monitoringStationId");

-- CreateIndex
CREATE INDEX "sftp_readings_projectSiteId_idx" ON "sftp_readings"("projectSiteId");

-- CreateIndex
CREATE INDEX "sftp_readings_companyRecordId_idx" ON "sftp_readings"("companyRecordId");

-- CreateIndex
CREATE INDEX "sftp_readings_dataFileId_idx" ON "sftp_readings"("dataFileId");

-- CreateIndex
CREATE UNIQUE INDEX "api_readings_referenceNo_key" ON "api_readings"("referenceNo");

-- CreateIndex
CREATE INDEX "api_readings_userId_idx" ON "api_readings"("userId");

-- CreateIndex
CREATE INDEX "api_readings_measuredAt_idx" ON "api_readings"("measuredAt");

-- CreateIndex
CREATE INDEX "api_readings_status_idx" ON "api_readings"("status");

-- CreateIndex
CREATE INDEX "api_readings_monitoringStationId_idx" ON "api_readings"("monitoringStationId");

-- CreateIndex
CREATE INDEX "api_readings_projectSiteId_idx" ON "api_readings"("projectSiteId");

-- CreateIndex
CREATE INDEX "api_readings_handshakeId_idx" ON "api_readings"("handshakeId");

-- CreateIndex
CREATE INDEX "attachments_sftpReadingId_idx" ON "attachments"("sftpReadingId");

-- CreateIndex
CREATE INDEX "attachments_apiReadingId_idx" ON "attachments"("apiReadingId");

-- AddForeignKey
ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sftp_readings" ADD CONSTRAINT "sftp_readings_dataFileId_fkey" FOREIGN KEY ("dataFileId") REFERENCES "data_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_readings" ADD CONSTRAINT "api_readings_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sftpReadingId_fkey" FOREIGN KEY ("sftpReadingId") REFERENCES "sftp_readings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_apiReadingId_fkey" FOREIGN KEY ("apiReadingId") REFERENCES "api_readings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
-- the middle so the three sequences can never collide.
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
  "id",
  regexp_replace("referenceNo", '^CIDCO/AQI/', 'CIDCO/AQI/SFTP/'),
  "userId", "projectId", "source", "status",
  "siteName", "location", "latitude", "longitude", "measuredAt", "aqiValue",
  "pm25", "pm10", "so2", "no2", "co", "ozone", "remarks",
  "projectSiteId", "monitoringStationId", "oem", "deviceModel",
  "temperature", "humidity", "integrationMethod", "otherParams", "receivedAt",
  "reviewedBy", "reviewNote", "reviewedAt", "createdAt", "updatedAt",
  "companyRecordId"
FROM "reports" WHERE "source" = 'SFTP';

INSERT INTO "api_readings" (
  "id", "referenceNo", "userId", "projectId", "source", "status",
  "siteName", "location", "latitude", "longitude", "measuredAt", "aqiValue",
  "pm25", "pm10", "so2", "no2", "co", "ozone", "remarks",
  "projectSiteId", "monitoringStationId", "oem", "deviceModel",
  "temperature", "humidity", "integrationMethod", "otherParams", "receivedAt",
  "reviewedBy", "reviewNote", "reviewedAt", "createdAt", "updatedAt"
)
SELECT
  "id",
  regexp_replace("referenceNo", '^CIDCO/AQI/', 'CIDCO/AQI/API/'),
  "userId", "projectId", "source", "status",
  "siteName", "location", "latitude", "longitude", "measuredAt", "aqiValue",
  "pm25", "pm10", "so2", "no2", "co", "ozone", "remarks",
  "projectSiteId", "monitoringStationId", "oem", "deviceModel",
  "temperature", "humidity", "integrationMethod", "otherParams", "receivedAt",
  "reviewedBy", "reviewNote", "reviewedAt", "createdAt", "updatedAt"
FROM "reports" WHERE "source" = 'API';

-- The moved rows keep their ids, so an attachment follows its reading simply
-- by moving which pointer is set.
UPDATE "attachments" a
   SET "sftpReadingId" = a."reportId", "reportId" = NULL
  FROM "sftp_readings" r WHERE a."reportId" = r."id";

UPDATE "attachments" a
   SET "apiReadingId" = a."reportId", "reportId" = NULL
  FROM "api_readings" r WHERE a."reportId" = r."id";

DELETE FROM "reports" WHERE "source" IN ('SFTP', 'API');
