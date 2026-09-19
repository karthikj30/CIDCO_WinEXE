-- CIDCO registers a company by hand before any SFTP credentials are issued.
-- Every later transfer is validated against that record: company id, the
-- address the data arrives from, and the file path it is taken from.

CREATE TYPE "TransferMode" AS ENUM ('DIRECT_SFTP', 'PORTAL');
ALTER TYPE "SftpUploadStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "architectServerIp" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "architectId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_companyId_key" ON "companies"("companyId");
CREATE INDEX "companies_architectId_idx" ON "companies"("architectId");

ALTER TABLE "companies" ADD CONSTRAINT "companies_architectId_fkey"
  FOREIGN KEY ("architectId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "architect_handshakes" ADD COLUMN "companyRecordId" TEXT;
ALTER TABLE "architect_handshakes" ADD CONSTRAINT "architect_handshakes_companyRecordId_fkey"
  FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sftp_uploads"
  ADD COLUMN "mode" "TransferMode" NOT NULL DEFAULT 'DIRECT_SFTP',
  ADD COLUMN "presentedCompanyId" TEXT,
  ADD COLUMN "presentedIp" TEXT,
  ADD COLUMN "presentedPath" TEXT,
  ADD COLUMN "companyIdMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ipMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pathMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "validationPassed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rejectionReason" TEXT;
