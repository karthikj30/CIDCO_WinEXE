-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "deviceModel" TEXT,
ADD COLUMN     "humidity" DOUBLE PRECISION,
ADD COLUMN     "integrationMethod" TEXT,
ADD COLUMN     "monitoringStationId" TEXT,
ADD COLUMN     "oem" TEXT,
ADD COLUMN     "otherParams" JSONB,
ADD COLUMN     "projectSiteId" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "temperature" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "reports_monitoringStationId_idx" ON "reports"("monitoringStationId");

-- CreateIndex
CREATE INDEX "reports_projectSiteId_idx" ON "reports"("projectSiteId");

