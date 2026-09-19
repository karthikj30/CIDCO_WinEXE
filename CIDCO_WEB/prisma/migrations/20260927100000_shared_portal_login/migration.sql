-- Architects sign in with one shared CIDCO portal login, so registering a
-- company no longer creates an account: the architect's email is stored as
-- contact data, and readings attribute to the company that delivered them.

ALTER TABLE "companies" ADD COLUMN "contactEmail" TEXT;

ALTER TABLE "reports" ADD COLUMN "companyRecordId" TEXT;
CREATE INDEX "reports_companyRecordId_idx" ON "reports"("companyRecordId");
ALTER TABLE "reports" ADD CONSTRAINT "reports_companyRecordId_fkey"
  FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry any email captured on a linked account across to the new column.
UPDATE "companies" c SET "contactEmail" = u."email"
  FROM "users" u WHERE c."architectId" = u."id" AND c."contactEmail" IS NULL;
