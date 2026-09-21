# CIDCO AQI Compliance Portal

A Next.js 15 dashboard where empanelled architects submit Air Quality Index (AQI) reports to
CIDCO (City and Industrial Development Corporation of Maharashtra), backed by PostgreSQL.

Reports reach CIDCO through **two channels**:

1. **API push** — the architect's own system authenticates with a CIDCO-issued API key and
   `POST`s the report document together with photographs of the on-site AQI display board to
   `POST /api/reports`.
2. **CSV upload** — the architect uploads a CSV of readings through the dashboard (or
   `POST /api/reports/csv`). Every row is validated on its own, so one bad row does not sink
   the file — the response names each rejected row and why.

Both channels land in the same table and are reviewed by CIDCO officers in the same workflow.

On top of those, an architect delivers their ongoing readings through one of **two integration
channels**, each with its own credentials, its own dashboards and its own CIDCO-side gate:

| Channel | Transport | Credentials | Docs |
|---------|-----------|-------------|------|
| **API** | REST over HTTPS, automated every few hours | client id + secret → access & refresh tokens | [`docs/ARCHITECT_API.md`](docs/ARCHITECT_API.md) |
| **SFTP** | A CSV sent over SFTP, automatically | SFTP user id + password, issued against a registered company | [`docs/SFTP_CHANNEL.md`](docs/SFTP_CHANNEL.md) |

The two never mix: an SFTP user id will not open the API, and an API client id will not open the
SFTP server.

### Getting in

Everyone starts at **`/`** — one page to sign in or sign up, as a CIDCO officer or an architect.
Once signed in you pick your channel, and that dashboard opens:

| | API channel | SFTP channel |
|---|---|---|
| CIDCO officer | `/cidco` | `/cidco/sftp` |
| Architect | `/architect` | `/architect/sftp` |

---

## Channel 1 — Architect ⇄ CIDCO handshake & token integration

A CIDCO-approved, token-based channel between an architect and CIDCO. Both sides have their own
portal: CIDCO at `/cidco`, the architect at `/architect`. Every protocol call is also a plain HTTP
API, so an architect's station (or Postman) can drive the same flow without a browser.

**The flow**

*CASE 1 — first-time setup*
1. **CIDCO issues a user id + password** (`clientId` / `clientSecret` and an expiry date — nothing
   else) from *Architect Handshakes* and sends it to the architect **by email or message**,
   off-platform. The endpoint URLs are not in that bundle: they live in the API documentation, and
   CIDCO repeats them in the message it delivers with the tokens.
2. **The architect hits the CIDCO API manually** — `POST /api/architect/validate` with those
   credentials plus their **IP address and device info**. No tokens are issued yet: the attempt is
   queued and answers **202 AWAITING_APPROVAL**.
3. **CIDCO reviews it** in the *Validation Requests* tab — architect identity, IP and device — and
   clicks **Validate & issue tokens** (or Reject).
4. On approval CIDCO whitelists the IP/device, generates the **access token (7 d)** and **refresh
   token (30 d)**, and **delivers both to the architect's dashboard** as a message: *"Your API
   request has been validated by CIDCO. Here are your access token and refresh token — keep them
   safely."* The same message lists **every endpoint URL**, each with a copy button, so the architect
   can paste them straight into Postman or their sender.
5. **The architect creates their own username and password** and fills in their details — name,
   firm, COA registration number, phone, designation, address. Those details are what CIDCO then
   sees against the handshake under *Architect Handshakes → Manage*.
6. The architect **saves the access token on their dashboard and clicks Automate** — the reading is
   then posted continuously (default every 3 h) with the access token as the header and the data as
   the body. CIDCO validates the token on every hit before storing.

*CASE 2 — access token expires*

CIDCO refuses the send with **503**, **returns the unsent reading in the response**, and says
*"Data has not been sent — your access token has expired."* The architect raises a request on their
dashboard with their **refresh token**; it pops up in CIDCO's *Token Requests* tab, an officer
verifies the refresh token and issues a **new access token**, which is delivered as a dashboard
message. The architect pastes it in and restarts Automate. The refresh token is unchanged.

*CASE 3 — refresh token expires*

Once the refresh window closes the access token dies with it, whatever its own expiry says. The send
is refused with **503** and the data returned, telling the architect to authenticate again with the
user id and password — i.e. back to CASE 1 step 2, and CIDCO issues a **fresh pair**.

*Token policy — set from the dashboard*

Each handshake carries its own `accessTokenTtlDays` / `refreshTokenTtlDays` (default 7 / 30) and an
`enforceWhitelist` flag, all editable from *Architect Handshakes → Manage*. Changes apply to every
token issued afterwards. The officer can also set explicit expiry dates on the live pair, choose
which token to regenerate (**Both / Access only / Refresh only**), or reset the IP/device whitelist.

*Logs* — every step is timestamped in the communication log, shown to the officer as an activity
timeline and to the architect on their *Activity log* tab.

**Admin endpoints** (CIDCO officer session):

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/admin/handshakes` | Issue credentials for an architect (returns the credential JSON once) |
| `GET` | `/api/admin/validation-requests` | The approval queue — architects awaiting validation |
| `POST` | `/api/admin/validation-requests/:id/approve` | Validate the architect/IP/device, issue tokens, deliver them |
| `POST` | `/api/admin/validation-requests/:id/reject` | Refuse, with a reason shown to the architect |
| `GET` | `/api/admin/handshakes` | List handshakes and their state |
| `GET` | `/api/admin/handshakes/:id` | Handshake detail: tokens, requests, comm log |
| `POST` | `/api/admin/handshakes/:id/tokens` | Generate tokens (needs `clientId` + `clientSecret`). `mode`: `both` (default, new pair — revokes the previous one), `access` (new access token only), `refresh` (new refresh token only) |
| `PATCH` | `/api/admin/handshakes/:id/policy` | Set access/refresh expiry windows and whitelist enforcement |
| `PATCH` | `/api/admin/handshakes/:id/token-expiry` | Set explicit expiry dates on the live token pair |
| `DELETE` | `/api/admin/handshakes/:id/whitelist` | Clear the registered IP/device |
| `POST` | `/api/admin/handshakes/:id/revoke` | Revoke the handshake and all its tokens |
| `GET` | `/api/admin/token-requests` | List renewal requests |
| `POST` | `/api/admin/token-requests/:id/approve` | Approve a request, issue a fresh token |
| `GET` | `/api/admin/comm-logs` | Timestamped communication trail |

**Architect endpoints** (credentials / token, from Postman):

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/architect/validate` | clientId + secret (+ ip/device) | Submit for CIDCO approval → **202 AWAITING_APPROVAL** / 504 rejected. Tokens arrive on the dashboard after approval |
| `POST` | `/api/architect/handshake-status` | clientId + secret | Where the validation stands, before the architect has an account |
| `POST` | `/api/architect/register` | clientId + secret | After approval — choose a username and password and record the architect's details → **201**, signed in |
| `POST` | `/api/architect/data` | Bearer access token | Send an AQI reading → stored. **503 + the reading returned** when a token has expired |
| `POST` | `/api/architect/token-requests` | refresh token | CASE 2 — ask CIDCO for a new access token → **202**, delivered after approval |
| `GET` | `/api/architect/me` | architect session | Dashboard data: handshakes, token deliveries, readings, logs |
| `POST` | `/api/architect/deliveries/:id/ack` | architect session | Confirm the tokens were saved; plaintext is wiped |
| `POST` | `/api/architect/refresh` | refresh token | Direct renewal for a machine client (bypasses the approval queue) |
| `GET` | `/api/architect/status` | token or clientId+secret headers | Handshake / token status |
| `GET` | `/api/architect/logs` | token or clientId+secret headers | Timestamped exchange log |

Full architect guide: **`/docs/architect`** (in-app) and **`docs/ARCHITECT_API.md`**. Postman
collection: **`postman/CIDCO-Architect-Handshake.postman_collection.json`** — it chains the whole
flow and saves the clientId, secret and token into collection variables automatically.

> **Status-code conventions.** `504` means *handshake validation failed* and `503` means *a token has
> expired* (`ACCESS_EXPIRED` → refresh; `BOTH_EXPIRED` → re-validate). Both follow the CIDCO protocol
> rather than the usual `401`, and are documented for the architect.

---

## Channel 2 — SFTP file transfer

The architect's system exports a **CSV** of readings and sends it to CIDCO over SFTP, automatically.
CIDCO validates every single transfer, previews the file and imports the rows. Portals: CIDCO at
`/cidco/sftp`, the architect at `/architect/sftp`.

**The flow**

*Before any credentials exist:*

- **i. CIDCO registers the company by hand** in *Companies*: company name, **company id**, the
  **architect's server IP** (the only address data is accepted from) and the **file path** their CSV
  is taken from, plus the architect's email — **stored as contact detail only**, no account is
  created for it.

*Then:*

1. **CIDCO issues credentials against that registration** and emails the architect their company's
   **SFTP user id**, **password** and the **designated IP** — CIDCO's own address, the one they send
   to — along with the shared portal login.
2. **The architect sends automatically.** Their server takes the CSV from the registered path and
   puts it on the designated address, on a schedule. `scripts/architect-sender.ts` does exactly this;
   any SFTP client or cron job works the same way.
3. **CIDCO validates every transfer** before anything is stored. Three fields are compared against
   the registration:

   | Checked | Where it comes from |
   | ------- | ------------------- |
   | Company id | the registration behind the credentials used |
   | Server IP | the address the connection actually came from |
   | File path | the directory the file was written to |

   Any mismatch and the transfer is **refused**: nothing is parsed, no reading is stored. It is still
   recorded, marked `REJECTED`, with the failing field named. A connection from an unregistered
   address never gets that far — it is refused at authentication.
4. **CIDCO previews it** in *Delivered transfers*: the comparison field by field, incoming beside
   registered, above the file as it arrived. Rows are independent — a bad row is named with its row
   number and reason while the rest still import, so a transfer lands as `PARSED`, `PARTIAL`,
   `FAILED` or `REJECTED`.

There is **no separate approval step**: registering the company is CIDCO's manual gate, so the
credentials work as soon as they are issued.

**Sending by hand.** `/architect/sftp` also gives the architect a **WinSCP-style pair of panes** —
their own files on the left (open a folder, browse it), CIDCO on the right at the registered path.
They enter the user id, password and designated IP and drag a CSV across. Those transfers are marked
`PORTAL` rather than `DIRECT_SFTP` and go through identical validation.

### The Windows agent

Architects who would rather not drag files by hand install the **CIDCO AQI Agent**, a small Windows
program that watches their export folder and sends the newest CSV on a schedule. It lives in its own
repository — [`karthikj30/CIDCO_WinEXE`](https://github.com/karthikj30/CIDCO_WinEXE) — and talks to
this server and nothing else. It is C# on .NET 8, published as one self-contained `.exe` that is both
its own installer and the agent.

It signs in with **one shared SFTP login** (`SFTP_SHARED_USER` / `SFTP_SHARED_PASSWORD`, by default
`cidco@example.com` / `123456`) and names its company in the upload path:

```
/<companyId>/<the folder the CSV was taken from>/<file>.csv
/ABCD123/C:/CIDCO/exports/readings.csv
```

The shared login proves the sender is an architect; it does not say *which* architect. That comes
from the company id in the path, and it is checked against the master record — along with the source
IP and the declared file path — on every single transfer, exactly as for a per-company account. An
unregistered or deactivated company id is refused at the door.

### The master and data tables

| Table | What it holds |
| ----- | ------------- |
| `companies` (**master**) | `companyId`, `publicKey`, `privateKey`, `userId`, plus name / architect IP / optional file path |
| `data_files` (**data**) | `companyId`, `timestamp`, `aqiData`, `fileStatus` (ingestion steps 1–10), folder indexes |

Inbound files are **queued**, then processed by polls (not ingested inline):

1. Intake → `storage/inbox/`
2. **poll1** (`npm run poll`) → creates **`<companyId>/<dd_mm_yyyy>/`** and files the CSV as `<hh-mm-ss>.csv`
3. **poll2** → runs the AQI SFTP Ingestion Service (steps 1–10), inserts readings, sets `fileStatus`, moves to `storage/archive/`

```
storage/cidco-data/
└── ABCD123/                 the company id
    └── 21_09_2026/          the day, dd_mm_yyyy
        └── 07-02-17.csv     the time the agent sent it

The agent delivers one flat file, ABCD123_21_09_2026_07-02-17_AQI.csv, because
it may not create folders. poll1 takes that name apart and builds the tree.
The delivered name is kept on the row as `deliveredName` — the filed name no
longer carries the company id, and step 4 validates what actually arrived.

The time is hyphenated, never 11:30:24. A colon is reserved in a Windows file
name (NTFS reads it as an alternate data stream), so a colon-named file would
be unsaveable for anyone who downloaded it.
```

Officers browse that tree under **Data** in `/cidco/sftp`, with the company's master row and each
file's `fileStatus`. Trigger polls manually with `POST /api/admin/sftp/poll`.

#### Files, or readings

The **Data** panel has two views. *Files* is the folder tree as delivered, with
each file's ten-step status. *Readings table* is what is inside those files:
one row per reading, every AQI parameter as a column, and a **Missing
parameters** column naming what that row does not carry.

It reads from the parsed sheet rather than from the stored readings, so rows
CIDCO rejected are in it too — a reading thrown away for a missing AQI value is
exactly the one an officer needs to see, and a table built only from what was
stored would quietly hide it. A missing **required** parameter (AQI Value, Date
& Time) is marked in red and the row is tinted, because that row was never
stored; anything else missing is amber and was stored as null.

#### Reading `fileStatus`

It always lists **all ten steps**, whatever happened. A run stops at the first
failure, so the steps after it are spelled out as `NOT REACHED` rather than left
off — otherwise a step that passed and a step that never ran would look the
same, and saying which step is missing is the whole point of the field. A file
that cleared all ten opens with `CORRECT`.

```
1. Detect new file — OK
2. Check file completeness — OK
3. Validate file type — OK
4. Validate filename — OK
5. Validate Project/Site — OK
6. Validate columns — FAILED: missing required column(s): measuredAt, aqiValue;
   unrecognised header(s): foo, bar
7. Validate data — NOT REACHED (stopped at 6. Validate columns)
8. Check duplicate — NOT REACHED (stopped at 6. Validate columns)
…
```

Step 6 compares the header row against the columns CIDCO published, so a sheet
that is simply the wrong sheet is caught once, by name, instead of as one
validation error per row. Step 7 then checks every row against the same schema
the store uses, but writes nothing — so "is this data valid" (step 7) stays a
separate question from "did it go in" (step 9).

The columns CIDCO reads:

```
Project / Site ID, AQI Monitoring Station / Device ID, OEM / Model,
Date & Time of Reading, AQI Value, PM2.5, PM10, NO₂, SO₂, CO, O₃,
Temperature, Humidity, Other applicable environmental parameters,
Data Source / Integration Method, Data Receipt Timestamp
```

Headers are matched on their letters and digits alone, so `PM 2.5`, `NO2`, `Station/Device ID` and
`AQI Monitoring Station / Device ID` all land on the same field; unknown columns are carried through
to the preview and ignored.

**Running it.** The SFTP server is a separate process from the web app:

```bash
npm run sftp       # listens on SFTP_PORT, default 2222
```

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`/`POST` | `/api/admin/sftp/companies` | The register / register a company (step i) |
| `PATCH` | `/api/admin/sftp/companies/:id` | Correct a registration, or deactivate it |
| `GET`/`POST` | `/api/admin/sftp/accounts` | SFTP accounts / issue credentials against a registration (step 1) |
| `GET` | `/api/admin/sftp/uploads` | Every transfer, with its validation result |
| `GET` | `/api/admin/sftp/uploads/:id` | One transfer: the full comparison and a file preview |
| `GET` | `/api/architect/sftp/me` | The architect's registration, where to send, and every result |
| `POST` | `/api/architect/sftp/transfer` | The portal's drag-and-drop send |
| `GET` | `/api/architect/sftp/template` | The blank CSV (`?format=xlsx` for Excel) |
| `GET` | `/api/admin/sftp/data` | The data table as a company / month / timestamp tree |
| `GET` | `/api/admin/sftp/data/:id/download` | One filed CSV, byte for byte as it arrived |

Full guide: **`/docs/sftp`** (in-app) and **`docs/SFTP_CHANNEL.md`**.

---

## Stack

| Layer     | Choice                                            |
| --------- | ------------------------------------------------- |
| Framework | Next.js 15 (App Router, React 19, TypeScript)     |
| Database  | PostgreSQL via Prisma ORM                         |
| Auth      | bcrypt passwords, JWT (`jose`) in an httpOnly cookie, plus API keys for machine-to-machine |
| Styling   | Tailwind CSS                                      |
| CSV       | PapaParse                                         |

---

## Setup

### 1. Requirements

- Node.js 18.18+ (developed on 22.x)
- PostgreSQL 14+

### 2. Install

```bash
npm install
```

### 3. Create the database

```bash
createdb cidco_aqi
# or:
psql -c "CREATE DATABASE cidco_aqi;"
```

### 4. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/cidco_aqi?schema=public"
JWT_SECRET="a-long-random-string"
UPLOAD_DIR="./uploads"

# SFTP channel (optional — these are the defaults)
SFTP_PORT=2222
SFTP_HOST=0.0.0.0
SFTP_STORAGE_DIR="./storage/sftp"
# SFTP_PUBLIC_HOST="cidco.example.gov.in"   # hostname shown to architects

# The Windows agent's shared login, and where accepted CSVs are filed
SFTP_SHARED_USER="cidco@example.com"
SFTP_SHARED_PASSWORD="123456"
CIDCO_DATA_DIR="./storage/cidco-data"
```

### 5. Create the tables and seed demo data

```bash
npx prisma migrate deploy   # applies prisma/migrations
npm run db:seed
```

Seeded accounts (password `Password123` for both):

| Role          | Email                  |
| ------------- | ---------------------- |
| Architect     | architect@example.com  |
| CIDCO officer | officer@cidco.example  |

### 6. Run

```bash
npm run dev        # http://localhost:3000
npm run sftp       # the SFTP intake, on port 2222 — a separate process
```

`SFTP_PUBLIC_HOST` is the **designated IP** CIDCO emails architects; it defaults to the request host.

Production:

```bash
npm run build && npm start
npm run sftp
```

### If the site loads with no styling

Every page answers 200, every stylesheet and script under `/_next/static/`
answers 404, and the site renders as unstyled text. That is not a CSS problem —
it is the assets not being served at all.

`next.config.mjs` sets `output: 'standalone'`, which builds a self-contained
`.next/standalone/server.js`. Next deliberately leaves `.next/static` and
`public/` **out** of that bundle, because they are meant to go on a CDN. Run
that server without them beside it and the HTML is all you get.

`npm run build` now copies them in afterwards (`npm run postbuild`), so both
ways of starting work:

```bash
npm start              # next start — serves .next itself
npm run start:standalone   # node .next/standalone/server.js
```

If you build by any route that skips the postbuild hook, copy them by hand:

```bash
cp -r .next/static .next/standalone/.next/static
```

The Dockerfile already does this in its own `COPY` step, so container builds
were never affected.

If the assets 404 behind a reverse proxy instead, the proxy is not forwarding
`/_next/` — that is the other way to get the same symptom, and it is fixed in
the proxy, not here.

The SFTP server generates its SSH host key on first boot and keeps it, with every uploaded workbook,
under `SFTP_STORAGE_DIR` (gitignored).

---

## Pages

`/` is the front door: one page to sign in or sign up as either a CIDCO officer or an architect.
After signing in you choose **API** or **SFTP**, and that dashboard opens.

| Route              | Portal | Purpose                                                        |
| ------------------ | ------ | -------------------------------------------------------------- |
| `/`                | — | Sign in / sign up, then pick your channel |
| `/cidco`           | CIDCO · API | AQI Data, Architect Handshakes, **Validation Requests**, Token Requests, Communication Logs |
| `/cidco/sftp`      | CIDCO · SFTP | **Delivered transfers** (validation + file preview), **Companies** (the register), SFTP accounts |
| `/architect`       | Architect · API | Connection, Messages (tokens from CIDCO), Send AQI data (**Automate**), My readings, Activity log |
| `/architect/sftp`  | Architect · SFTP | **WinSCP-style transfer panes**, their registration, CSV template, per-transfer validation results |
| `/docs/architect`  | — | API channel guide (validation, tokens, sending data) |
| `/docs/sftp`       | — | SFTP channel guide (handshake, the workbook, uploading) |

Seeded logins: CIDCO officer `officer@cidco.example` / `Password123`; **the shared architect portal
login `cidco@gmail.com` / `123456`** (every architect uses this, then connects with their company's
SFTP user id and password); demo architect `architect@example.com` / `Password123`. Every dashboard links to its sibling channel and back to the
chooser from the header.

### Architect portal (`/architect`)

An architect who has no account yet is walked through onboarding: they enter **the user id and
password CIDCO emailed them**, the page waits while a CIDCO officer reviews the request (polling, so
approval lands without a reload), and once approved they **create their own username and password**
and fill in their details. They are signed in from there. Returning architects use *Already have an
account? Sign in*.

Once inside:

- **Messages** — everything CIDCO sends: the access and refresh tokens (plaintext until marked
  saved), **and every endpoint URL with a copy button**. One click loads the tokens into this
  dashboard.
- **Connection** — declares the IP and device to whitelist, shows live expiry countdowns for both
  tokens, the handshake status as CIDCO sees it, and the **request a new access token** flow (CASE 2).
- **Send AQI data** — a form covering every parameter, posted to `POST /api/architect/data` with the
  access token: the same call a station makes every 3 hours. A 503 is rendered with its
  `ACCESS_EXPIRED` / `BOTH_EXPIRED` reason and the exact next step.
- **My readings** — the readings CIDCO accepted from this architect.
- **Activity log** — their own timestamped exchange with CIDCO.

The portal is a client of the same public API — it holds tokens the way an external system would and
makes ordinary token-authenticated calls, so it is never a back door around the handshake.

---

## API

Every response uses the same envelope:

```jsonc
{ "success": true,  "data":  { /* ... */ } }
{ "success": false, "error": "message", "details": { /* field errors */ } }
```

### Authentication

Three interchangeable credentials are accepted on the data endpoints:

| Credential          | Header                              | Best for                       |
| ------------------- | ----------------------------------- | ------------------------------ |
| API key             | `X-API-Key: cidco_live_...`         | The architect's server         |
| API key (bearer)    | `Authorization: Bearer cidco_live_…`| Same, if a client prefers it   |
| JWT                 | `Authorization: Bearer eyJ...`      | Postman after `/api/auth/login`|
| Session cookie      | set automatically                   | The browser dashboard          |

API keys are stored only as a SHA-256 hash — the plaintext value is shown exactly once, at
creation.

### Endpoints

| Method   | Path                       | Auth                  | Description                                        |
| -------- | -------------------------- | --------------------- | -------------------------------------------------- |
| `GET`    | `/api/health`              | none                  | Liveness + database check                           |
| `POST`   | `/api/auth/register`       | none                  | Create an account, returns a JWT                    |
| `POST`   | `/api/auth/login`          | none                  | Sign in, returns a JWT                              |
| `POST`   | `/api/auth/logout`         | session               | Clear the session cookie                            |
| `GET`    | `/api/auth/me`             | any                   | Caller identity + which credential was used         |
| `GET`    | `/api/api-keys`            | session / JWT         | List your keys (prefix only)                        |
| `POST`   | `/api/api-keys`            | session / JWT         | Issue a key (plaintext returned once)               |
| `DELETE` | `/api/api-keys/:id`        | session / JWT         | Revoke a key                                        |
| `POST`   | `/api/reports`             | any                   | **Method 1** — submit a report (multipart or JSON)  |
| `GET`    | `/api/reports`             | any                   | List reports (`page`, `pageSize`, `status`, `source`, `q`) |
| `GET`    | `/api/reports/:id`         | any                   | Full report with attachment download URLs           |
| `DELETE` | `/api/reports/:id`         | any                   | Withdraw a report while still `SUBMITTED`           |
| `POST`   | `/api/reports/csv`         | any                   | **Method 2** — bulk CSV upload                      |
| `GET`    | `/api/reports/csv`         | none                  | Download a CSV template                             |
| `PATCH`  | `/api/reports/:id/review`  | CIDCO officer         | Change a report's status                            |
| `GET`    | `/api/files/:id`           | owner / officer       | Stream an attachment                                |
| `GET`    | `/api/stats`               | any                   | Dashboard aggregates                                |

### Method 1 — API push

`POST /api/reports` as `multipart/form-data`:

| Field         | Required | Notes                                                        |
| ------------- | -------- | ------------------------------------------------------------ |
| `siteName`    | yes      |                                                              |
| `location`    | yes      |                                                              |
| `measuredAt`  | yes      | ISO 8601, e.g. `2026-08-01T09:30:00Z`                        |
| `aqiValue`    | yes      | Integer 0–1000                                               |
| `pm25`, `pm10`, `so2`, `no2`, `co`, `ozone` | no | Numeric                            |
| `latitude`, `longitude`                     | no | Numeric                            |
| `projectCode` | no       | Links the report to a CIDCO project (e.g. `CIDCO-KHR-012`)   |
| `remarks`     | no       |                                                              |
| `document`    | no       | PDF / DOC / DOCX / TXT / image, max 15 MB                    |
| `boardPhotos` | yes\*    | Photo of the AQI display board; repeat the field for several |

\* Required for multipart submissions. A pure `application/json` body (no attachments at all) is
also accepted for readings-only integrations.

```bash
curl -X POST http://localhost:3000/api/reports \
  -H "X-API-Key: cidco_live_xxxxxxxx" \
  -F 'siteName=Kharghar Sector 12 Site' \
  -F 'location=Kharghar, Navi Mumbai' \
  -F 'measuredAt=2026-08-01T09:30:00Z' \
  -F 'aqiValue=148' \
  -F 'pm25=62.4' \
  -F 'projectCode=CIDCO-KHR-012' \
  -F 'document=@aqi-report.pdf' \
  -F 'boardPhotos=@board-front.jpg' \
  -F 'boardPhotos=@board-side.jpg'
```

### Method 2 — CSV upload

`POST /api/reports/csv` as `multipart/form-data` with a single `file` field.

Required columns: `siteName`, `location`, `measuredAt`, `aqiValue`.
Optional: `pm25`, `pm10`, `so2`, `no2`, `co`, `ozone`, `latitude`, `longitude`, `remarks`,
`projectCode`.

Friendlier header spellings are accepted too — `Site Name`, `Date`, `AQI`, `PM2.5`, `lat`,
`lng`, `notes`, `project`.

```bash
curl -X POST http://localhost:3000/api/reports/csv \
  -H "X-API-Key: cidco_live_xxxxxxxx" \
  -F 'file=@samples/sample-aqi-readings.csv'
```

The response reports each row individually:

```json
{
  "success": true,
  "data": {
    "totalRows": 3,
    "createdCount": 2,
    "failedCount": 1,
    "created": [{ "row": 2, "referenceNo": "CIDCO/AQI/2026/00004", "aqiValue": 96 }],
    "errors": [{ "row": 4, "message": "Validation failed", "details": { "measuredAt": ["measuredAt must be a valid ISO date"] } }]
  }
}
```

Sample files live in `samples/` — `sample-aqi-readings.csv` (all valid) and
`sample-with-errors.csv` (alias headers plus two deliberately bad rows).

---

## Testing with Postman

Two collections are provided:

**`postman/CIDCO-Architect-Handshake.postman_collection.json`** — the handshake + token flow.

1. **Admin → Officer login** (sets the session cookie).
2. **Admin → Issue handshake credentials** — clientId + secret saved to variables.
3. **Architect → Validate** — 200 establishes the channel (a companion request shows the 504 case).
4. **Admin → Generate token** — 7-day token saved to `{{token}}`.
5. **Architect → Send AQI data** — posts a reading with the Bearer token.
6. **Architect → Raise token request** → **Admin → List / Approve token request** — the renewal loop.

**`postman/CIDCO-AQI-Portal.postman_collection.json`** — the original reports/API-key flow.

1. Check the `baseUrl` collection variable (`http://localhost:3000`).
2. **Auth → Login** with the seeded architect. The JWT is saved to `{{token}}` automatically.
3. **API Keys → Create API key**. The plaintext key is saved to `{{apiKey}}` automatically.
4. **Reports → Submit report (multipart)** — in the Body tab, pick a PDF for `document` and one
   or more images for `boardPhotos`, then send. The new report id is saved to `{{reportId}}`.
5. **Reports → Upload CSV** — pick `samples/sample-with-errors.csv` to see per-row validation.

Postman cannot store binary files inside a collection, so the file fields ship empty by design —
select your own files before sending.

---

## Data model

- **User** — architect or CIDCO officer; firm name and Council of Architecture number for architects.
- **ApiKey** — hashed key, prefix for display, last-used timestamp, revocation.
- **Project** — CIDCO project a report can be attached to via `projectCode`.
- **Report** — the reading itself: AQI, pollutants (PM2.5/PM10/NO₂/SO₂/CO/O₃), temperature,
  humidity, station/device provenance (`projectSiteId`, `monitoringStationId`, `oem`,
  `deviceModel`), `integrationMethod`, free-form `otherParams`, source channel, review state, and a
  server-stamped `receivedAt` (data-receipt timestamp).
- **Attachment** — `DOCUMENT`, `AQI_BOARD_PHOTO`, `CSV_SOURCE` or `OTHER`, stored on disk under
  `UPLOAD_DIR` with a random name and served only through the authorised `/api/files/:id` route.
- **AuditLog** — registrations, logins, submissions, reviews and key lifecycle events.
- **ApiRequestLog** — method, endpoint, status, duration and IP of every logged API request (the
  *API Logs* tab). Bodies are omitted for endpoints that carry secrets.
- **ArchitectHandshake** — an issued credential: `clientId`, hashed secret, credential expiry, and
  status (`PENDING → ESTABLISHED → EXPIRED | REVOKED`).
- **IntegrationToken** — a hashed, expiring bearer token for an established handshake.
- **TokenRequest** — an architect's renewal request (`PENDING → FULFILLED | REJECTED`).
- **CommunicationLog** — the timestamped handshake / data-transfer trail (never stores secrets).

Report status flows `SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED`.

---

## Viewing the data

Two ways to inspect what's in PostgreSQL:

**1. On the dashboard — CIDCO Admin → AQI Data.** A live table of the `reports` table (every reading
architects feed in) with all station/device columns, colour-coded AQI, search, source filter and
pagination. It auto-refreshes every 5 s while **Live** is ticked, backed by
`GET /api/admin/reports` (officer-only).

**2. In your codespace / editor — Prisma Studio.** A full browser UI over every table:

```bash
npm run db:studio      # opens http://localhost:5555
```

Or query directly with psql:

```bash
psql "$DATABASE_URL" -c 'SELECT "referenceNo","monitoringStationId","aqiValue","receivedAt" FROM reports ORDER BY "receivedAt" DESC LIMIT 20;'
```

---

## Notes for production

- Set a strong `JWT_SECRET`; cookies are marked `secure` automatically when `NODE_ENV=production`.
- `UPLOAD_DIR` is local disk. Point it at a mounted volume, or swap `src/lib/storage.ts` for S3
  if you deploy to a platform with an ephemeral filesystem.
- Uploads are capped at 15 MB per file and restricted by MIME type in `src/lib/storage.ts`.

## Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Development server on port 3000      |
| `npm run build`     | Generate the Prisma client and build |
| `npm start`         | Production server                    |
| `npm run db:migrate`| Create/apply a migration             |
| `npm run db:push`   | Push the schema without a migration  |
| `npm run db:seed`   | Seed demo users, projects, reports   |
| `npm run db:studio` | Prisma Studio                        |
| `npm run sftp`      | The SFTP intake server (port 2222)   |
| `npx tsx scripts/architect-sender.ts` | The architect-side automated CSV sender |

End-to-end checks, with the servers running:

```bash
npx tsx scripts/api-e2e.ts    # the API channel, front to back
npx tsx scripts/sftp-e2e.ts   # the SFTP channel, over a real SFTP client
```
