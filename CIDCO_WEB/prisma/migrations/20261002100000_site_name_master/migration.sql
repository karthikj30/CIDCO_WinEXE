-- The master table becomes a register of monitoring sites.
--
-- `companyId` was a code CIDCO assigned and `companyName` the firm's name.
-- The site is the thing being registered, so siteName is now the identifier —
-- the value the agent puts in every file name and poll1 files by. Existing
-- rows keep working because the column is renamed, not replaced: a delivery
-- already filed under "ABCD123" still matches the row that is now
-- siteName = 'ABCD123'.
ALTER TABLE "companies" RENAME COLUMN "companyId" TO "siteName";
ALTER TABLE "companies" RENAME COLUMN "filePath"  TO "designatedPath";
ALTER TABLE "companies" RENAME COLUMN "contactEmail" TO "email";

-- companyName held the firm; the site now carries the name. Nothing reads it.
ALTER TABLE "companies" DROP COLUMN IF EXISTS "companyName";
-- The architect's server address stopped gating transfers some time ago and
-- is not part of the master record any more.
ALTER TABLE "companies" DROP COLUMN IF EXISTS "architectServerIp";

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "mobile"        TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "address"       TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "architectName" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "departmentId"  TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "nodeId"        TEXT;

ALTER TABLE "data_files"   RENAME COLUMN "companyId" TO "siteName";
ALTER TABLE "sftp_uploads" RENAME COLUMN "presentedCompanyId" TO "presentedSiteName";
ALTER TABLE "sftp_uploads" RENAME COLUMN "companyIdMatch" TO "siteNameMatch";

CREATE TABLE IF NOT EXISTS "nodes" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "nodes_name_key" ON "nodes"("name");

CREATE TABLE IF NOT EXISTS "departments" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "departments_name_key" ON "departments"("name");

CREATE INDEX IF NOT EXISTS "companies_departmentId_idx" ON "companies"("departmentId");
CREATE INDEX IF NOT EXISTS "companies_nodeId_idx" ON "companies"("nodeId");
CREATE INDEX IF NOT EXISTS "data_files_siteName_idx" ON "data_files"("siteName");
DROP INDEX IF EXISTS "data_files_companyId_idx";

ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_departmentId_fkey";
ALTER TABLE "companies" ADD CONSTRAINT "companies_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_nodeId_fkey";
ALTER TABLE "companies" ADD CONSTRAINT "companies_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The nodes CIDCO works in, and the departments that own the sites. Officers
-- can add more from the portal; these are the ones that exist today.
INSERT INTO "nodes" ("id", "name") VALUES
  ('node_pushpak',  'Pushpak'),
  ('node_dronagiri','Dronagiri'),
  ('node_kharghar', 'Kharghar'),
  ('node_karanjade','Karanjade'),
  ('node_taloja',   'Taloja'),
  ('node_ulwe',     'Ulwe')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "departments" ("id", "name") VALUES
  ('dept_planning_naina',      'Planning NAINA'),
  ('dept_planning_navi_mumbai','Planning Navi Mumbai'),
  ('dept_engineering',         'Engineering Department')
ON CONFLICT ("name") DO NOTHING;
