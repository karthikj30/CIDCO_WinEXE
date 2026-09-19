-- The SFTP delivery channel: Excel workbooks uploaded over SFTP, kept entirely
-- separate from the API/token channel.

CREATE TYPE "TransferChannel" AS ENUM ('API', 'SFTP');
CREATE TYPE "SftpUploadStatus" AS ENUM ('RECEIVED', 'PARSED', 'PARTIAL', 'FAILED');

ALTER TYPE "ReportSource" ADD VALUE IF NOT EXISTS 'SFTP';

ALTER TABLE "architect_handshakes" ADD COLUMN "channel" "TransferChannel" NOT NULL DEFAULT 'API';
ALTER TABLE "validation_requests" ADD COLUMN "channel" "TransferChannel" NOT NULL DEFAULT 'API';

CREATE TABLE "sftp_uploads" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "SftpUploadStatus" NOT NULL DEFAULT 'RECEIVED',
    "sheetName" TEXT,
    "columns" JSONB,
    "rows" JSONB,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "sourceIp" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsedAt" TIMESTAMP(3),
    CONSTRAINT "sftp_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sftp_uploads_handshakeId_idx" ON "sftp_uploads"("handshakeId");
CREATE INDEX "sftp_uploads_status_idx" ON "sftp_uploads"("status");

ALTER TABLE "sftp_uploads" ADD CONSTRAINT "sftp_uploads_handshakeId_fkey"
  FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
