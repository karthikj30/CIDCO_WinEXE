# Creating the database

A new, empty PostgreSQL database has no tables, so the first thing the portal
does — look up a user to sign in — fails with **"column/relation does not
exist"**. The schema has to be created once. Nothing needs doing by hand.

Everything below is run from `CIDCO_WEB/`.

---

## 1. The database and its user

Create these to match whatever `DATABASE_URL` you are going to use. For
`postgresql://cidco_sftp:<password>@localhost:5432/cidco_sftp?schema=public`:

```sql
-- psql as a superuser (e.g.  sudo -u postgres psql  /  psql -U postgres)
CREATE ROLE cidco_sftp WITH LOGIN PASSWORD '<password>';
CREATE DATABASE cidco_sftp OWNER cidco_sftp;
```

The role must **own** the database (or hold `CREATE` on the `public` schema),
or creating tables fails with *permission denied for schema public* on
PostgreSQL 15 and later.

Check it before going further — this proves the login and database are right:

```bash
psql "postgresql://cidco_sftp:<password>@localhost:5432/cidco_sftp" -c "select 1"
```

> **`?schema=public` is a Prisma parameter, not a PostgreSQL one.** Prisma needs
> it on `DATABASE_URL`; `psql` rejects the same string with
> *invalid URI query parameter: "schema"*. So the URL in `.env` ends with
> `?schema=public` and the `psql` commands here do not.

Then put the URL **with** `?schema=public` in `CIDCO_WEB/.env` as
`DATABASE_URL`:

```
DATABASE_URL="postgresql://cidco_sftp:<password>@localhost:5432/cidco_sftp?schema=public"
```

---

## 2. Creating the tables — pick one route

### Route A — Prisma migrations (use this one)

```bash
cd CIDCO_WEB
npm install
npx prisma migrate deploy     # creates every table, in order
npx prisma generate           # builds the client the app imports
npm run db:seed               # optional: demo logins and a demo company
```

`migrate deploy` also records what it applied in `_prisma_migrations`, so the
next schema change applies cleanly on top. **Route B does not**, which is the
one real difference between them.

### Route B — plain SQL

When you want the raw statements: a DBA applying them by hand, or a database
you cannot point Prisma at.

```bash
psql "postgresql://cidco_sftp:<password>@localhost:5432/cidco_sftp" \
  -v ON_ERROR_STOP=1 -f prisma/full_schema.sql
```

`-v ON_ERROR_STOP=1` matters: without it psql prints an error and carries on,
leaving a half-built database that looks like it worked.

Then, so the app can talk to it:

```bash
npx prisma generate
npm run db:seed                # optional
```

If you later use `migrate deploy` on a database built this way, tell Prisma the
tables are already there or it will try to create them again:

```bash
npx prisma migrate resolve --applied 20260810120000_init
# …and the same for each migration listed in prisma/migrations/
```

Both routes were checked against the same empty database and produce identical
tables and columns.

---

## 3. Checking it worked

```bash
psql "$DATABASE_URL" -c "\dt"
```

Sixteen tables, including these three:

| Table | What it is |
| --- | --- |
| `users` | portal accounts — the one whose absence causes the sign-in error |
| `companies` | the **MASTER** table: `companyId`, `publicKey`, `privateKey`, `userId` |
| `data_files` | the **DATA** table: `companyId`, `timestamp`, `aqiData`, `fileStatus` |

The full list: `api_keys`, `api_request_logs`, `architect_handshakes`,
`attachments`, `audit_logs`, `communication_logs`, `companies`, `data_files`,
`integration_tokens`, `projects`, `reports`, `sftp_uploads`,
`token_deliveries`, `token_requests`, `users`, `validation_requests`.

And the real test, which is what was failing:

```bash
npm run build && npm start
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"officer@cidco.example","password":"Password123"}'
```

`200` with a token means the database is good. (That login exists only after
`npm run db:seed`.)

---

## 4. The two tables you asked about

### MASTER — `companies`

```sql
CREATE TABLE "companies" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,   -- the id quoted on every transfer
    "companyName"       TEXT NOT NULL,
    "architectServerIp" TEXT NOT NULL,   -- data is only accepted from here
    "filePath"          TEXT NOT NULL DEFAULT '',
    "publicKey"         TEXT,            -- master-table credentials
    "privateKey"        TEXT,
    "userId"            TEXT,            -- portal / SFTP user id
    "contactEmail"      TEXT,
    "architectId"       TEXT,
    "notes"             TEXT,
    "active"            BOOLEAN NOT NULL DEFAULT true,
    "createdById"       TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "companies_companyId_key" ON "companies"("companyId");
CREATE INDEX "companies_architectId_idx" ON "companies"("architectId");
CREATE INDEX "companies_userId_idx" ON "companies"("userId");
```

### DATA — `data_files`

```sql
CREATE TABLE "data_files" (
    "id"              TEXT NOT NULL,
    "companyRecordId" TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "monthFolder"     TEXT NOT NULL,
    "dateFolder"      TEXT NOT NULL DEFAULT 'pending',  -- dd_mm_yyyy
    "timestampFolder" TEXT NOT NULL,                    -- hh-mm-ss
    "timestamp"       TEXT,
    "relativePath"    TEXT NOT NULL,   -- companyId/dd_mm_yyyy/hh-mm-ss.csv
    "fileName"        TEXT NOT NULL,   -- the name in the tree
    "deliveredName"   TEXT,            -- the flat name the agent sent
    "sizeBytes"       INTEGER NOT NULL,
    "rowCount"        INTEGER NOT NULL DEFAULT 0,
    "importedCount"   INTEGER NOT NULL DEFAULT 0,
    "sourceIp"        TEXT,
    "uploadId"        TEXT,
    "aqiData"         JSONB,           -- the parsed readings
    "fileStatus"      TEXT,            -- ingestion steps 1–10, or CORRECT
    "pollStatus"      "DataFilePollStatus" NOT NULL DEFAULT 'INBOX',
    "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "data_files_uploadId_key" ON "data_files"("uploadId");
CREATE INDEX "data_files_companyRecordId_idx" ON "data_files"("companyRecordId");
CREATE INDEX "data_files_companyId_idx" ON "data_files"("companyId");
CREATE INDEX "data_files_monthFolder_idx" ON "data_files"("monthFolder");
CREATE INDEX "data_files_pollStatus_idx" ON "data_files"("pollStatus");
```

`pollStatus` needs its enum, which `full_schema.sql` creates:

```sql
CREATE TYPE "DataFilePollStatus" AS ENUM
  ('INBOX', 'FILED', 'INGESTING', 'ARCHIVED', 'FAILED');
```

---

## 5. When it still will not work

**`relation "users" does not exist`** / *no user column* — the schema was never
created, or it went into a different database than the one `DATABASE_URL`
names. Check with `psql "$DATABASE_URL" -c "\dt"`.

**`permission denied for schema public`** — the role does not own the database.
`ALTER DATABASE cidco_sftp OWNER TO cidco_sftp;` as a superuser.

**`Environment variable not found: DATABASE_URL`** — the app was started
somewhere `.env` never reached. In a container, pass `DATABASE_URL` in; a
`.env` on the host is not read inside one.

**`password authentication failed`** — the role's password differs from the
URL. `ALTER ROLE cidco_sftp WITH PASSWORD '<password>';`

**Tables exist but the app still errors on a column** — the generated client
predates the schema. `npx prisma generate`, then restart.

**Starting over:**

```sql
DROP DATABASE cidco_sftp;
CREATE DATABASE cidco_sftp OWNER cidco_sftp;
```

---

## 6. The whole thing, inline

Identical to `CIDCO_WEB/prisma/full_schema.sql`. Run that file rather than
pasting this, unless pasting is all you have.

```sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ARCHITECT', 'CIDCO_OFFICER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReportSource" AS ENUM ('API', 'CSV', 'WEB', 'SFTP');

-- CreateEnum
CREATE TYPE "TransferChannel" AS ENUM ('API', 'SFTP');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('DOCUMENT', 'AQI_BOARD_PHOTO', 'CSV_SOURCE', 'OTHER');

-- CreateEnum
CREATE TYPE "HandshakeStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'ESTABLISHED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeliveryKind" AS ENUM ('INITIAL_PAIR', 'ACCESS_RENEWAL', 'FULL_REISSUE');

-- CreateEnum
CREATE TYPE "TokenRequestKind" AS ENUM ('ACCESS_RENEWAL', 'FULL_REISSUE');

-- CreateEnum
CREATE TYPE "CommDirection" AS ENUM ('ADMIN_TO_ARCHITECT', 'ARCHITECT_TO_ADMIN');

-- CreateEnum
CREATE TYPE "TokenRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SftpUploadStatus" AS ENUM ('RECEIVED', 'PARSED', 'PARTIAL', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransferMode" AS ENUM ('DIRECT_SFTP', 'PORTAL');

-- CreateEnum
CREATE TYPE "DataFilePollStatus" AS ENUM ('INBOX', 'FILED', 'INGESTING', 'ARCHIVED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ARCHITECT',
    "firmName" TEXT,
    "councilRegNo" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "address" TEXT,
    "accountSetupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "plotNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "source" "ReportSource" NOT NULL,
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
    "companyRecordId" TEXT,
    "otherParams" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ip" TEXT,
    "userId" TEXT,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "architect_handshakes" (
    "id" TEXT NOT NULL,
    "architectId" TEXT NOT NULL,
    "channel" "TransferChannel" NOT NULL DEFAULT 'API',
    "companyRecordId" TEXT,
    "clientId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "credentialExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "HandshakeStatus" NOT NULL DEFAULT 'PENDING',
    "architectValidatedAt" TIMESTAMP(3),
    "establishedAt" TIMESTAMP(3),
    "lastValidatedIp" TEXT,
    "createdById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "whitelistedIp" TEXT,
    "deviceInfo" TEXT,
    "deviceFingerprint" TEXT,
    "whitelistedAt" TIMESTAMP(3),
    "enforceWhitelist" BOOLEAN NOT NULL DEFAULT true,
    "accessTokenTtlDays" INTEGER NOT NULL DEFAULT 7,
    "refreshTokenTtlDays" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "architect_handshakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_tokens" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenHash" TEXT,
    "refreshTokenPrefix" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "fromRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_requests" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "channel" "TransferChannel" NOT NULL DEFAULT 'API',
    "presentedIp" TEXT,
    "deviceInfo" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_deliveries" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "kind" "DeliveryKind" NOT NULL,
    "message" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessPrefix" TEXT,
    "refreshPrefix" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "refreshExpiresAt" TIMESTAMP(3),
    "endpoints" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "architectServerIp" TEXT NOT NULL,
    "filePath" TEXT NOT NULL DEFAULT '',
    "publicKey" TEXT,
    "privateKey" TEXT,
    "userId" TEXT,
    "contactEmail" TEXT,
    "architectId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sftp_uploads" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "SftpUploadStatus" NOT NULL DEFAULT 'RECEIVED',
    "mode" "TransferMode" NOT NULL DEFAULT 'DIRECT_SFTP',
    "presentedCompanyId" TEXT,
    "presentedIp" TEXT,
    "presentedPath" TEXT,
    "companyIdMatch" BOOLEAN NOT NULL DEFAULT false,
    "ipMatch" BOOLEAN NOT NULL DEFAULT false,
    "pathMatch" BOOLEAN NOT NULL DEFAULT false,
    "validationPassed" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
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

-- CreateTable
CREATE TABLE "data_files" (
    "id" TEXT NOT NULL,
    "companyRecordId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "monthFolder" TEXT NOT NULL,
    "dateFolder" TEXT NOT NULL DEFAULT 'pending',
    "timestampFolder" TEXT NOT NULL,
    "timestamp" TEXT,
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "deliveredName" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "sourceIp" TEXT,
    "uploadId" TEXT,
    "aqiData" JSONB,
    "fileStatus" TEXT,
    "pollStatus" "DataFilePollStatus" NOT NULL DEFAULT 'INBOX',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_requests" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "TokenRequestStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "TokenRequestKind" NOT NULL DEFAULT 'ACCESS_RENEWAL',
    "refreshTokenHash" TEXT,
    "requestedIp" TEXT,
    "resolvedById" TEXT,
    "issuedTokenId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "token_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" TEXT NOT NULL,
    "handshakeId" TEXT,
    "direction" "CommDirection" NOT NULL,
    "event" TEXT NOT NULL,
    "statusCode" INTEGER,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "reports_referenceNo_key" ON "reports"("referenceNo");

-- CreateIndex
CREATE INDEX "reports_userId_idx" ON "reports"("userId");

-- CreateIndex
CREATE INDEX "reports_measuredAt_idx" ON "reports"("measuredAt");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_monitoringStationId_idx" ON "reports"("monitoringStationId");

-- CreateIndex
CREATE INDEX "reports_projectSiteId_idx" ON "reports"("projectSiteId");

-- CreateIndex
CREATE INDEX "reports_companyRecordId_idx" ON "reports"("companyRecordId");

-- CreateIndex
CREATE INDEX "attachments_reportId_idx" ON "attachments"("reportId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "api_request_logs_userId_idx" ON "api_request_logs"("userId");

-- CreateIndex
CREATE INDEX "api_request_logs_endpoint_idx" ON "api_request_logs"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "architect_handshakes_clientId_key" ON "architect_handshakes"("clientId");

-- CreateIndex
CREATE INDEX "architect_handshakes_architectId_idx" ON "architect_handshakes"("architectId");

-- CreateIndex
CREATE INDEX "architect_handshakes_status_idx" ON "architect_handshakes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tokens_tokenHash_key" ON "integration_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tokens_refreshTokenHash_key" ON "integration_tokens"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tokens_fromRequestId_key" ON "integration_tokens"("fromRequestId");

-- CreateIndex
CREATE INDEX "integration_tokens_handshakeId_idx" ON "integration_tokens"("handshakeId");

-- CreateIndex
CREATE INDEX "validation_requests_handshakeId_idx" ON "validation_requests"("handshakeId");

-- CreateIndex
CREATE INDEX "validation_requests_status_idx" ON "validation_requests"("status");

-- CreateIndex
CREATE INDEX "token_deliveries_handshakeId_idx" ON "token_deliveries"("handshakeId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_companyId_key" ON "companies"("companyId");

-- CreateIndex
CREATE INDEX "companies_architectId_idx" ON "companies"("architectId");

-- CreateIndex
CREATE INDEX "companies_userId_idx" ON "companies"("userId");

-- CreateIndex
CREATE INDEX "sftp_uploads_handshakeId_idx" ON "sftp_uploads"("handshakeId");

-- CreateIndex
CREATE INDEX "sftp_uploads_status_idx" ON "sftp_uploads"("status");

-- CreateIndex
CREATE UNIQUE INDEX "data_files_uploadId_key" ON "data_files"("uploadId");

-- CreateIndex
CREATE INDEX "data_files_companyRecordId_idx" ON "data_files"("companyRecordId");

-- CreateIndex
CREATE INDEX "data_files_companyId_idx" ON "data_files"("companyId");

-- CreateIndex
CREATE INDEX "data_files_monthFolder_idx" ON "data_files"("monthFolder");

-- CreateIndex
CREATE INDEX "data_files_pollStatus_idx" ON "data_files"("pollStatus");

-- CreateIndex
CREATE INDEX "token_requests_handshakeId_idx" ON "token_requests"("handshakeId");

-- CreateIndex
CREATE INDEX "token_requests_status_idx" ON "token_requests"("status");

-- CreateIndex
CREATE INDEX "communication_logs_handshakeId_idx" ON "communication_logs"("handshakeId");

-- CreateIndex
CREATE INDEX "communication_logs_event_idx" ON "communication_logs"("event");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "architect_handshakes" ADD CONSTRAINT "architect_handshakes_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "architect_handshakes" ADD CONSTRAINT "architect_handshakes_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_requests" ADD CONSTRAINT "validation_requests_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_deliveries" ADD CONSTRAINT "token_deliveries_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sftp_uploads" ADD CONSTRAINT "sftp_uploads_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_files" ADD CONSTRAINT "data_files_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_requests" ADD CONSTRAINT "token_requests_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_handshakeId_fkey" FOREIGN KEY ("handshakeId") REFERENCES "architect_handshakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
