-- Master table extras + data table poll / file-status fields.
-- companies: publicKey, privateKey, userId; filePath optional
-- data_files: dateFolder, timestamp, aqiData, fileStatus, pollStatus

CREATE TYPE "DataFilePollStatus" AS ENUM ('INBOX', 'FILED', 'INGESTING', 'ARCHIVED', 'FAILED');

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "publicKey" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "privateKey" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "userId" TEXT;

ALTER TABLE "companies" ALTER COLUMN "filePath" SET DEFAULT '';

CREATE INDEX IF NOT EXISTS "companies_userId_idx" ON "companies"("userId");

ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "dateFolder" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "timestamp" TEXT;
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "aqiData" JSONB;
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "fileStatus" TEXT;
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "pollStatus" "DataFilePollStatus" NOT NULL DEFAULT 'INBOX';

CREATE INDEX IF NOT EXISTS "data_files_pollStatus_idx" ON "data_files"("pollStatus");
