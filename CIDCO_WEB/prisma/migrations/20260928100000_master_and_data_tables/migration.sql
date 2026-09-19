-- The DATA table. `companies` is the MASTER table; this indexes the folder
-- tree every accepted CSV is filed into:
--   <companyId>/<month>/<timestamp>/<file>.csv
CREATE TABLE "data_files" (
    "id" TEXT NOT NULL,
    "companyRecordId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "monthFolder" TEXT NOT NULL,
    "timestampFolder" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "sourceIp" TEXT,
    "uploadId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_files_uploadId_key" ON "data_files"("uploadId");
CREATE INDEX "data_files_companyRecordId_idx" ON "data_files"("companyRecordId");
CREATE INDEX "data_files_companyId_idx" ON "data_files"("companyId");
CREATE INDEX "data_files_monthFolder_idx" ON "data_files"("monthFolder");

ALTER TABLE "data_files" ADD CONSTRAINT "data_files_companyRecordId_fkey"
  FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
