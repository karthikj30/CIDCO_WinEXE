# CIDCO AQI Compliance Portal — how it is built and how to work on it

Three deployables, one database:

| Folder | What it is | Runs on |
|---|---|---|
| `CIDCO_WEB/` | **The CIDCO portal.** One officer dashboard covering both channels, the SFTP intake, the two ingestion polls. Also serves the architect's SFTP workspace, because that is the channel the Windows agent delivers into. | CIDCO's server, its own port |
| `arch_web/` | **The architect's API portal.** Their dashboard, and the token-authenticated endpoints their station posts readings to. | CIDCO's server, its own port |
| `architect_WINexe/` | **The agent.** A Windows desktop app. Picks up the newest AQI CSV, renames it, sends it. | The architect's PC |

An architect uses one channel or the other: the API portal, or the agent. A
CIDCO officer sees both on one dashboard, because their job does not divide by
transport.

`arch_web` and `CIDCO_WEB` read and write the same PostgreSQL database and
share the same session cookie — cookies ignore the port, so one sign-in covers
both, provided `JWT_SECRET` matches.

They are joined by exactly two things: **an upload** (SFTP or HTTP) and **a file name**. Nothing
else crosses. That is deliberate — the agent cannot reach the database, and the portal cannot
reach the architect's disk, so each side can be rebuilt without touching the other.

---

## 1. Tech stack, and why each piece is there

### The agent — `architect_WINexe/`

| Technology | Version | What it does here |
|---|---|---|
| **.NET 8 / C#** | `net8.0` (core), `net8.0-windows10.0.19041.0` (app) | The whole agent. The Windows 10 SDK target is needed only for the location API. |
| **WinForms** | built in | The installer wizard and the agent window. Chosen over WPF because the app is six controls and a log; WinForms ships a smaller single file. |
| **SSH.NET** | 2026.0.0 | The SFTP client. Handles password *and* key auth (`.ppk` and `.pem`), which cloud servers require since they usually refuse passwords. |
| **Microsoft.Data.Sqlite** | 8.0.11 | A one-file local database for settings and the send history. No server to install on the architect's PC. |
| **Windows.Devices.Geolocation** | WinRT | Reads where the PC is at each send. GPS if the machine has it, Wi-Fi positioning if not. |
| **xUnit** | — | 270 tests over `Cidco.Core`. |

The project splits in three so the logic is testable on a machine with no desktop:

```
src/Cidco.Core/     net8.0        — all logic. No WinForms. Runs in CI, runs on Linux.
src/Cidco.Agent/    net8.0-windows — windows, dialogs, the WinRT location source.
src/Shared/         linked files   — theme colours, shortcut creation.
tests/              net8.0        — tests Cidco.Core only, which is why Core has no UI.
```

**Why the split matters:** `Cidco.Core` has no reference to WinForms, so the file-naming rules,
the coordinate parsing, the schedule, the connection diagnosis and the send pipeline all run
under `dotnet test` on any machine. Only drawing needs Windows.

### The portal — `CIDCO_WEB/`

| Technology | Version | What it does here |
|---|---|---|
| **Next.js (App Router)** | 15.1.6 | Pages and API routes in one project. `output: 'standalone'` so the server ships as one folder. |
| **React** | 19 | The dashboards. |
| **TypeScript** | 5.7 | Everything. `npx tsc --noEmit` is the first gate on any change. |
| **PostgreSQL** | 16 | The database. |
| **Prisma** | 6 | Schema, migrations and the typed client. One schema file is the single source of truth for the tables. |
| **Tailwind CSS** | 3.4 | Styling. |
| **zod** | 3.24 | Validates every request body at the API edge, so a bad field never reaches Prisma. |
| **jose** | 5.9 | Signs and verifies the session JWT. |
| **bcryptjs** | 2.4 | Password hashing. |
| **ssh2** | 1.17 | The SFTP *server* — CIDCO's intake, not a client. |
| **papaparse / exceljs** | — | Reads delivered `.csv` and `.xlsx`. |
| **amCharts 5** | 5.20 | The dashboard charts. |
| **Leaflet + OpenStreetMap** | 1.9 | The monitoring map. Free and open, which matters for an authority-run portal. |
| **tsx** | 4.19 | Runs the TypeScript workers (`poll-worker.ts`, `sftp-server.ts`) without a build step. |

---

## 2. Folder by folder, and what links to what

```
CIDCO_WEB/
├── prisma/
│   ├── schema.prisma          ← THE source of truth for every table
│   ├── migrations/            ← one folder per change, applied in order
│   └── seed.ts                ← demo rows
├── src/
│   ├── app/                   ← routes. A folder = a URL.
│   │   ├── page.tsx                    /            the front door
│   │   ├── cidco/page.tsx              /cidco       officer, API channel
│   │   ├── cidco/sftp/page.tsx         /cidco/sftp  officer, SFTP channel ← the main screen
│   │   ├── architect/sftp/page.tsx     /architect/sftp
│   │   ├── docs/…                      /docs/sftp, /docs/architect
│   │   └── api/**/route.ts             every HTTP endpoint
│   ├── components/            ← the screens themselves
│   └── lib/                   ← all shared logic; routes stay thin
├── scripts/                   ← long-running workers and one-off tools
└── storage/                   ← files on disk (not in git)
```

### `src/lib/` — where the real work lives

API routes are deliberately thin: check who is asking, validate the body, call a lib function,
return. Everything reusable sits here, so the SFTP server, the HTTP upload and the poll worker
all take **the same path** into the database.

| File | Responsibility | Used by |
|---|---|---|
| `prisma.ts` | One shared Prisma client. Prevents a new connection pool per hot reload. | everything |
| `auth.ts` | Sign/verify the JWT, set the session cookie, decide the `Secure` flag. | login, register, officer-signup, `guards.ts` |
| `guards.ts` | `requireCidco()` — the one place that decides "is this an officer?". | every `/api/admin/**` route |
| `api.ts` | `ok()`, `fail()`, `handleError()`. Every endpoint answers in one shape. | every route |
| `validation.ts` | zod schemas for reports and registration. | upload paths |
| `sftp.ts` | The channel's core: storage folders, the sheet shape, `validateColumns`, `validateRows`, `importRows`, the shared login. | SFTP server, HTTP transfer, poll2 |
| `ingestionPoll.ts` | The two polls and the ten ingestion steps. `parseAqiFileName`, `runPoll1`, `runPoll2`, `ingestionHealth`. | poll worker, poll API, Data tab |
| `reports.ts` | `createReport()` — the single write path into `reports`. | `importRows`, API channel |
| `aqi.ts` | CPCB bands, the two colour scales, `metresBetween`, `checkLocation`, `reportingStatus`. | dashboard API, charts, map |
| `aqiRows.ts` | Turns stored `aqiData` JSON back into readable rows, including rejected ones. | readings table, analytics |
| `portalAccount.ts` | The shared architect login used by every agent. | transfer route, SFTP server |

**The important link:** the agent writes a file name; `ingestionPoll.ts` is the only thing that
reads that name; `sftp.ts` is the only thing that writes readings. Change the name format and
exactly two files care — `RemotePath.cs` on the agent side, `ingestionPoll.ts` on the portal side.

### `scripts/` — the three processes

| Script | `npm run …` | What it is |
|---|---|---|
| `poll-worker.ts` | `poll` | **Must always be running.** Calls poll1 and poll2 every `POLL_INTERVAL_MS` (15s) and writes a heartbeat the portal reads. |
| `sftp-server.ts` | `sftp` | The SFTP intake on port 2222, for agents that send over SFTP rather than HTTP. |
| `poll-selftest.ts` | `poll:selftest` | End-to-end test of the whole ingestion. **It clears the tables — never run it on production.** |
| `create-officer.ts` | `officer:create` | Creates or promotes a CIDCO officer from the shell. |
| `copy-standalone-assets.mjs` | runs automatically after `build` | Copies `.next/static` into the standalone folder. Without it the portal loads HTML with no CSS. |

---

## 3. The flow, end to end

### Step 1 — Install (once, on the architect's PC)

`SetupWizard.cs` walks five screens: role → CSV folder → schedule → **station location** →
install. `SetupFlow.cs` holds the decisions with no window attached, which is why the wizard's
rules are covered by tests. The answers land in a local SQLite file via `Settings.cs`.

The location step opens **blank** with a **Detect location** button. Detect reads the position
from the PC — Windows Location Service first, then a lookup from the public IP — fills the boxes
and says which source answered, so a rough network fix is not mistaken for a precise one. The
step will not pass until something is in it.

It used to open pre-filled with Navi Mumbai, and an architect anywhere else clicked straight
past it: the registered position became a city they had never visited, and because that value
is also the last fallback at send time, every file claimed Kharghar. A blank field asks the
question; a filled one answers it wrongly.

The position recorded here is the **registered** one — the point CIDCO measures each delivery
against on the map, and the fallback used only when nothing can measure where the PC is now.

### Step 2 — Send (every few hours, automatically)

```
ExportPicker.cs   picks the newest .csv in the folder, skips one already sent
StationLocation.cs resolves where the PC is NOW:
                     1. Windows Location Service   (GPS / Wi-Fi)
                     2. public-IP lookup           (rough, but real)
                     3. the position from install  (last resort)
RemotePath.cs     builds the name
CidcoSender.cs    sends over SFTP   ─┐
PortalSender.cs   sends over HTTP   ─┴→ CIDCO
```

The name is the entire contract:

```
Kharghar Sector 12_21_09_2026_11-30-24_19.033072_73.029683_AQI.csv
└──── site name ──┘ └─ date ─┘ └─time─┘ └─ lat ─┘ └── lon ──┘
```

Time uses hyphens, not colons — a colon makes NTFS read `11:30:24.csv` as an alternate data
stream, so an officer could not save the file. The coordinates are optional: an older agent
sends the shorter name and it still parses.

### Step 3 — Intake (CIDCO's server)

Either door writes the file into the inbox and creates an `sftp_uploads` row:

- **SFTP** → `scripts/sftp-server.ts`
- **HTTP** → `POST /api/architect/sftp/transfer`

### Step 4 — Poll 1: file it

Runs every 15 seconds. Reads the file *name* only.

```
inbox/<delivered name>  →  <dataRoot>/<Site_Name>/<dd_mm_yyyy>/<hh-mm-ss>.csv
```

Spaces become underscores on disk (`safeFolder`). Creates the `companies` row if the site has
never been seen, and writes a `data_files` row with the coordinates from the name. A name it
cannot read is left alone and reported on the Data tab.

### Step 5 — Poll 2: read it, store it, archive it

Ten steps, each recorded on the row so an officer can see exactly where a file stopped:

```
1. Detect new file        6. Validate columns
2. Check file completeness 7. Validate data
3. Validate file type      8. Check duplicate
4. Validate filename       9. Store audit information
5. Validate Project/Site  10. Move file  → storage/archive/…
```

Valid rows become `reports` rows through `createReport()`. Invalid rows are kept in the
`data_files.aqiData` JSON so the officer can see what was rejected and why. A reading with no
coordinates of its own inherits the file's.

### Step 6 — The officer looks

`/cidco/sftp` → `SftpPortalWorkspace.tsx`, five tabs:

| Tab | Component | Reads |
|---|---|---|
| Monitoring dashboard | `DashboardPanel.tsx` + `AmCharts.tsx` + `SiteMap.tsx` | `GET /api/admin/sftp/dashboard` |
| Delivered transfers | `TransfersPanel.tsx` | `…/analytics` |
| Data | `SftpDataPanel.tsx` | `…/data`, `…/data/rows` |
| Companies (master) | `SftpCompaniesPanel.tsx` | `…/companies`, `…/lookups` |
| SFTP accounts | `SftpAccountsPanel.tsx` | `…/accounts` |

The dashboard serves **every panel from one filtered query**, so the map, the tiles and the six
charts can never disagree about which readings they describe.

---

## 4. The database

### Connecting

```bash
psql -h localhost -U cidco_sftp -d cidco_sftp        # it will ask for the password
```

The connection string lives in `CIDCO_WEB/.env` as `DATABASE_URL`. Note: `?schema=public` is a
**Prisma-only** parameter — psql rejects it. Use the plain host/user/database form above.

### The tables that matter

| Table | Prisma model | What it holds |
|---|---|---|
| `companies` | `Company` | **The master.** One row per site. |
| `nodes` | `Node` | Pushpak, Dronagiri, Kharghar, Karanjade, Taloja, Ulwe. |
| `departments` | `Department` | Planning NAINA, Planning Navi Mumbai, Engineering Department. |
| `data_files` | `DataFile` | **One row per delivered file**, its ingestion status and its rejected rows. |
| `reports` | `Report` | **One row per reading.** This is what the dashboard charts. |
| `sftp_uploads` | `SftpUpload` | The raw arrival record, before filing. |
| `users` | `User` | Officers and architects. |
| `architect_handshakes` | `ArchitectHandshake` | Issued SFTP credentials. |

`companies.id` → `data_files.companyRecordId` → and `reports.companyRecordId`. Delete a company
and its files cascade; its readings have the link set to null rather than being destroyed.

### Looking at data

```sql
-- what tables exist, and the shape of one
\dt
\d companies
\d data_files

-- the master
SELECT "siteName", "architectName", "designatedPath",
       "registeredLatitude", "registeredLongitude", active
FROM companies ORDER BY "siteName";

-- how many readings per site
SELECT c."siteName", COUNT(r.id) AS readings, ROUND(AVG(r."aqiValue")) AS avg_aqi
FROM companies c LEFT JOIN reports r ON r."companyRecordId" = c.id
GROUP BY c."siteName" ORDER BY readings DESC;

-- the last ten deliveries and how they went
SELECT "siteName", "deliveredName", "pollStatus",
       "importedCount" || '/' || "rowCount" AS stored, "receivedAt"
FROM data_files ORDER BY "receivedAt" DESC LIMIT 10;

-- why one file failed
SELECT "fileStatus" FROM data_files WHERE "pollStatus" = 'FAILED'
ORDER BY "receivedAt" DESC LIMIT 1;

-- anything stuck mid-ingestion
SELECT "pollStatus", COUNT(*) FROM data_files GROUP BY 1;

-- the newest readings, named by the site that sent them
SELECT c."siteName", r."measuredAt", r."aqiValue", r.pm25, r.pm10, r.no2
FROM reports r JOIN companies c ON c.id = r."companyRecordId"
ORDER BY r."measuredAt" DESC LIMIT 20;
```

**A trap worth knowing:** `reports."siteName"` is *not* the company site name — it is whatever
the CSV's "Project / Site ID" column said, so it comes out as `PRJ-002` or `CIDCO-ULW-008`. The
authoritative site name is `companies."siteName"`, reached through `companyRecordId`, which is
why the query above joins. `data_files."siteName"` *is* the company name, copied there so the
folder tree can be listed without a join.

**Column names are quoted for a reason.** Prisma creates them in camelCase, and unquoted
PostgreSQL folds identifiers to lowercase — `SELECT siteName` fails, `SELECT "siteName"` works.
Table names are lowercase and need no quotes.

### Adding and changing data

```sql
-- register a site
INSERT INTO companies (id, "siteName", "designatedPath", "architectName",
                       "registeredLatitude", "registeredLongitude", "updatedAt")
VALUES (gen_random_uuid()::text, 'Kharghar Sector 12', '/home/ubuntu/cidco/kharghar12',
        'Sharma Constructions', 19.033000, 73.029700, NOW());

-- put it in a node and a department
UPDATE companies SET
  "nodeId"       = (SELECT id FROM nodes       WHERE name = 'Kharghar'),
  "departmentId" = (SELECT id FROM departments WHERE name = 'Planning Navi Mumbai'),
  "updatedAt"    = NOW()
WHERE "siteName" = 'Kharghar Sector 12';

-- set the permitted radius the map checks against
UPDATE companies SET "permittedRadiusMetres" = 750, "updatedAt" = NOW()
WHERE "siteName" = 'Kharghar Sector 12';

-- add a node
INSERT INTO nodes (id, name, "createdAt")
VALUES (gen_random_uuid()::text, 'Panvel', NOW()) ON CONFLICT (name) DO NOTHING;

-- turn a site off without losing its history
UPDATE companies SET active = false, "updatedAt" = NOW() WHERE "siteName" = 'Old Site';

-- re-queue a file poll2 should try again
UPDATE data_files SET "pollStatus" = 'FILED', "fileStatus" = NULL WHERE id = '<id>';
```

Prefer the portal for all of this — the Companies tab does every one of these with validation
behind it. SQL is for when you need a hundred rows changed at once, or to look at something the
UI does not show.

### Deleting — read this first

**Always run the `SELECT` before the `DELETE`.** There is no undo.

```sql
BEGIN;                                   -- open a transaction
SELECT COUNT(*) FROM reports WHERE "measuredAt" < NOW() - INTERVAL '2 years';
DELETE FROM reports WHERE "measuredAt" < NOW() - INTERVAL '2 years';
-- COMMIT;   ← only when the count was what you expected
ROLLBACK;                                -- otherwise this undoes it
```

Deleting a company deletes its `data_files` rows with it (`ON DELETE CASCADE`), and sets
`reports.companyRecordId` to null rather than removing the readings. Files on disk are **not**
touched by any of this — clear `storage/cidco-data` and `storage/archive` by hand if you mean to.

```sql
-- a whole site, master row and file index (readings survive, unlinked)
DELETE FROM companies WHERE "siteName" = 'Test Site';

-- one delivery
DELETE FROM data_files WHERE "deliveredName" = 'ABCD123_21_09_2026_11-30-24_AQI.csv';
```

### A browser instead of SQL — and why you cannot see it

```bash
cd CIDCO_WEB && npx prisma studio
# Prisma Studio is up on http://localhost:5555
```

That `localhost` is **the server's** localhost, not yours — the message is printed for whoever
is sitting at the machine. Studio itself listens on all interfaces (`0.0.0.0:5555`), so what is
actually stopping you is the **EC2 security group**: inbound 5555 is closed, as it should be.

**Open an SSH tunnel instead.** On *your* machine, not the server:

```bash
ssh -i <your-key.pem> -L 5555:localhost:5555 ubuntu@<server-ip>
```

Leave that terminal open, start Studio on the server in another, and open
`http://localhost:5555` in your own browser. The traffic goes down the SSH connection you are
already trusted on; nothing new is exposed to the internet.

The same tunnel works for psql from a desktop client — forward `5432` and point pgAdmin or
DBeaver at `localhost:5432`.

**Do not open 5555 in the security group.** It is tempting — Studio is already listening on
every interface, so one firewall rule would make it work. But Studio has **no login of any
kind**. Anyone who finds the port gets full read and write on every table, including dropping
it: the master, every reading, every officer account. It is a development tool that assumes it
is on your own machine. The same goes for 5432 — tunnel it rather than opening it.

### Backups

```bash
pg_dump -h localhost -U cidco_sftp cidco_sftp > backup_$(date +%F).sql
psql   -h localhost -U cidco_sftp -d cidco_sftp < backup_2026-09-27.sql
```

### Changing the schema

Never with `ALTER TABLE` by hand — Prisma would not know, and the next migration would fight it.

```bash
cd CIDCO_WEB
# edit prisma/schema.prisma
npx prisma migrate dev --name what_changed    # development: writes the migration and applies it
npx prisma migrate deploy                     # production: applies what is already written
```

---

## 5. Running it

### Deploying — one command, every time

```bash
cd CIDCO_WEB
./deploy.sh
```

Pull, install, migrate, build, reload. Safe to run as often as you like: it **reloads** the
processes named in `ecosystem.config.js` rather than starting new ones, so `pm2 ls` shows the
same three however many times it has run.

The first time only, or after a reboot:

```bash
pm2 startOrReload ecosystem.config.js
pm2 save
pm2 startup          # prints a command to run once, so pm2 comes back on boot
```

Changed only a `.env` value, like the poll interval? Skip the build:

```bash
./deploy.sh --no-build
```

**Why not `pm2 start`:** `pm2 start` on a name that already exists adds *another* copy. Run it
after every deploy and you end up with six `cidco-web` processes, all listening, with the old
ones still serving the previous build. `startOrReload` starts what is missing and reloads what
is already there, which is what `deploy.sh` uses.

If duplicates have already built up:

```bash
pm2 delete all
pm2 startOrReload ecosystem.config.js
pm2 save
```

**`cidco-web` must be reloaded after every build.** The old process keeps serving HTML that
points at chunks the new build deleted — in the browser that is `ChunkLoadError`. `deploy.sh`
does this for you.

### Scheduling the two polls

By default one process runs both, every 15 seconds:

```bash
npm run poll                       # POLL_INTERVAL_MS, default 15000
```

They can also run apart, on their own schedules. Poll1 only reads file names and is cheap, so
it can run often and file a delivery the moment it lands; poll2 parses whole spreadsheets and
is usually happy to run less often:

```bash
POLL1_INTERVAL_MS=5000   npm run poll -- --only=1
POLL2_INTERVAL_MS=60000  npm run poll -- --only=2

npm run poll -- --only=2 --interval=30000     # or set it on the command line
```

Interval, most specific first: `--interval=` → `POLL1_INTERVAL_MS` / `POLL2_INTERVAL_MS` →
`POLL_INTERVAL_MS` → 15000.

To run them as two pm2 processes, comment out `cidco-poll` in `ecosystem.config.js` and
uncomment `cidco-poll1` and `cidco-poll2` below it, then `./deploy.sh --no-build`.

**Cron is the wrong tool here.** Cron's floor is one minute, and a new `tsx` process per tick
costs a second or two of startup before it does any work. The worker already schedules the next
tick only once the current one has finished, so a slow spreadsheet can never have a second run
racing it over the same inbox — which is exactly how one delivery gets ingested twice. If you
do want cron, drive the API instead of spawning a worker:

```
* * * * * curl -s -X POST -H "Cookie: <officer session>" \
          "http://localhost:8040/api/admin/sftp/poll?which=1" >/dev/null
```

### Choosing an interval

| Interval | Suits |
|---|---|
| 5–15 s | A live dashboard. What CIDCO runs. |
| 60 s | Agents sending hourly. Nothing is lost; the Data tab lags a minute. |
| 5 min+ | Very large sheets, or a server doing other work. |

An interval longer than the agent's send interval is fine — deliveries queue in the inbox and
are filed in order.

### The two portals, and how they find each other

Neither address is baked into a build. Both are read at request time, so moving
one is an `.env` edit and a reload:

| Setting | In | Means |
|---|---|---|
| `PORT` | `CIDCO_WEB/.env` | where the CIDCO portal listens |
| `ARCH_WEB_PORT` | `CIDCO_WEB/.env` | where pm2 starts the architect portal |
| `ARCH_WEB_URL` | `CIDCO_WEB/.env` | the architect portal's public address. The front door's API card points here, and so do the endpoints CIDCO issues with a token |
| `CIDCO_WEB_URL` | `arch_web/.env` | the CIDCO portal's public address, for the links back |
| `JWT_SECRET` | **both**, identical | one sign-in across both ports. Different values and an architect who signed in at the front door lands on a login form |

`NEXT_PUBLIC_` variables would have been simpler and are wrong here: Next bakes
those into the bundle at build time, so changing a port would mean rebuilding.
Both portals serve their address from `/api/config` instead.

Leave `ARCH_WEB_URL` and `CIDCO_WEB_URL` unset and every link stays relative —
which is how it behaved before the split, so an installation that has not been
reconfigured keeps working.

### The shared plumbing

`arch_web/src/lib/` holds a copy of eleven modules from `CIDCO_WEB/src/lib/` —
auth, the Prisma client, validation, the handshake rules — so that it can be
built and deployed on its own.

A copy drifts, and the failure that causes is quiet: a token that validates on
one port and not the other. `arch_web/scripts/check-shared-lib.mjs` runs before
every build and fails it if any of the eleven differ, naming the file. It
already caught one during the split.

The Prisma **schema** is not copied: `arch_web` generates its client from
`../CIDCO_WEB/prisma/schema.prisma`, so there is one schema and one set of
migrations, owned by `CIDCO_WEB`.

### Ports and addresses

Nothing in the code hardcodes a port or an IP. The portal's port comes from `PORT` in `.env`
(a shell variable of the same name wins), `ecosystem.config.js` reads it from there, and
`deploy.sh` reports whatever it found. Change the port in one place and everything follows.

The address CIDCO tells architects to send to is taken from whatever host the browser asked
for, so it follows a changing public IP on its own. `SFTP_PUBLIC_HOST` overrides it only if you
ever put the portal behind a name that differs from the SFTP endpoint.

**`npm start` and `npm restart` are not how this runs in production.** They start a second copy
on port 3000 beside the one pm2 is already running, which is the `EADDRINUSE: address already
in use :::3000` you get. Use pm2:

```bash
pm2 reload cidco-web      # restart the portal
pm2 reload all            # everything
./deploy.sh               # pull, build, reload — the usual one
```

### Storage folders (`.env`)

| Variable | Default | Holds |
|---|---|---|
| `CIDCO_INBOX_DIR` | `./storage/inbox` | Where deliveries land. Poll1 empties it. |
| `CIDCO_DATA_DIR` | `./storage/cidco-data` | The filed tree, and the poll heartbeat. |
| `CIDCO_ARCHIVE_DIR` | `./storage/archive` | Where poll2 moves a file once stored. |

A **relative** path here is measured from the `CIDCO_WEB` folder by both the portal and the poll
worker. That was a real bug: the standalone server runs from `.next/standalone`, so the two
processes used to resolve the same setting to two different folders — the worker filed into one,
the portal read the other and reported the worker stopped while it was running. Absolute paths
were never affected.

### Checking it is alive

- **Data tab** should read *"Poll worker last ran Ns ago."* If it says the worker is not
  running, it is not running.
- `curl localhost:3000/api/health` → `{"database":"connected"}`
- `pm2 logs cidco-poll` → a line every 15 seconds.

---

## 6. Testing

```bash
cd CIDCO_WEB
npx tsc --noEmit          # the first gate — types across the whole project
npm run poll:selftest     # end to end: drops files, polls, asserts. WIPES THE TABLES.
npm run build

cd ../architect_WINexe
dotnet test tests/Cidco.Core.Tests/Cidco.Core.Tests.csproj    # 270 tests
```

---

## 7. Where to change what

| To change… | Edit | Then also |
|---|---|---|
| The file name the agent sends | `Cidco.Core/RemotePath.cs` | `lib/ingestionPoll.ts` — `AQI_FILE_RE` must still parse it |
| The ten ingestion steps | `lib/ingestionPoll.ts` | `INGESTION_STEPS` is rendered verbatim on the Data tab |
| Accepted CSV columns | `lib/sftp.ts` — `SHEET_COLUMNS` | `lib/aqiRows.ts` for the readings table |
| A table or column | `prisma/schema.prisma` | `npx prisma migrate dev`, never raw SQL |
| A chart | `components/admin/sftp/AmCharts.tsx` | `api/admin/sftp/dashboard/route.ts` for the data |
| AQI bands or colours | `lib/aqi.ts` | nothing — every chart and the map read it from there |
| What an officer may do | `lib/guards.ts` | one place, deliberately |

## Related documents

- `run.md` — starting the agent and the server, step by step, including PuTTY
- `db_commands.md` — creating the database from scratch
- `CIDCO_WEB/docs/SFTP_CHANNEL.md` — the SFTP channel in detail
- `CIDCO_WEB/docs/ARCHITECT_API.md` — the API channel
