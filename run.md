# How to run CIDCO (client + server)

One place for both sides of this repo:

| Side | Folder | What you run |
|------|--------|--------------|
| **Client (architect)** | [`architect_WINexe/`](./architect_WINexe) | Windows `.exe` that sends AQI CSV over SFTP / portal |
| **CIDCO (server)** | [`CIDCO_WEB/`](./CIDCO_WEB) | Portal + SFTP intake + poll workers + database |

---

## Prerequisites

### Client (architect PC)

- Windows 10/11
- No .NET install needed to **run** the shipped exe
- To **rebuild**: [.NET 8 SDK](https://dot.net) (or newer)

### CIDCO server / local web

- Node.js 18.18+ (22.x is fine)
- npm
- Docker Desktop **or** PostgreSQL 14+

---

## A. Client — architect Windows agent

### Option 1 — use the shipped exe (no build)

```powershell
cd architect_WINexe\dist
.\CIDCO_AQI_Agent.exe
```

Or double-click `architect_WINexe\dist\CIDCO_AQI_Agent.exe`.

**First run:** setup wizard → Architect → pick CSV folder → schedule → install.  
**Later runs:** connection bar → Connect → Send now / automatic sending.

Useful flags:

```powershell
.\CIDCO_AQI_Agent.exe --setup      # re-run wizard
.\CIDCO_AQI_Agent.exe --uninstall  # remove install
```

### Option 2 — rebuild the exe

```powershell
cd architect_WINexe
.\build.bat
```

That restores packages, runs tests, and publishes to `architect_WINexe\dist\CIDCO_AQI_Agent.exe`.

Manual equivalent:

```powershell
cd architect_WINexe
dotnet restore
dotnet test --nologo
dotnet publish src\Cidco.Agent -c Release -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -p:DebugType=none `
  -o dist
```

### What the client needs from CIDCO

Fill these in the agent (from CIDCO’s email / registration):

| Field | Example |
|-------|---------|
| Designated IP | `13.207.123.12` or `http://host:3000` for portal |
| User ID | `cidco@example.com` |
| Password | (as issued) |
| Company ID | `ABCD123` |
| File path | local export folder, e.g. `C:\CIDCO\exports` |

The agent renames each CSV to `companyId_timestamp_AQI.csv`, checks the remote path exists (does not create folders), and uploads.

---

## B. CIDCO side — web portal + SFTP + polls

Open **three** terminals under `CIDCO_WEB` after setup: portal, SFTP, poll.

### 1. Install

```powershell
cd CIDCO_WEB
npm install
copy .env.example .env
```

Edit `.env` (standalone Postgres on 5432):

```env
DATABASE_URL="postgresql://cidco:cidco_dev@localhost:5432/cidco_aqi?schema=public"
JWT_SECRET="dev-jwt-secret-change-me-for-local-only-cidco-aqi"
UPLOAD_DIR="./uploads"
NEXT_PUBLIC_APP_NAME="CIDCO AQI Compliance Portal"
```

### 2. Start PostgreSQL

> Pointing at a **new, empty** database? It has no tables, so signing in fails
> with *relation "users" does not exist*. Creating the schema is one command —
> see **[db_commands.md](./db_commands.md)**, which also has the plain SQL.

```powershell
docker run -d --name cidco-postgres `
  -e POSTGRES_USER=cidco `
  -e POSTGRES_PASSWORD=cidco_dev `
  -e POSTGRES_DB=cidco_aqi `
  -p 5432:5432 `
  postgres:16-alpine

# Later sessions:
docker start cidco-postgres
```

Or with Compose (DB on host port **5433** — match `DATABASE_URL` accordingly):

```powershell
cd CIDCO_WEB
docker compose up -d
```

### 3. Migrate + seed

```powershell
cd CIDCO_WEB
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

### 4. Run (keep all three running)

**Terminal 1 — portal**

```powershell
cd CIDCO_WEB
npm run dev
```

→ http://localhost:3000

**Terminal 2 — SFTP intake** (default port 2222)

```powershell
cd CIDCO_WEB
npm run sftp
```

**Terminal 3 — poll1 + poll2 worker**

```powershell
cd CIDCO_WEB
npm run poll
```

Poll1 files inbound CSVs; poll2 runs the 10-step ingestion, writes DB rows, and archives.

### Useful CIDCO URLs

| URL | Purpose |
|-----|---------|
| http://localhost:3000 | Portal home |
| http://localhost:3000/cidco/sftp | CIDCO SFTP officer UI |
| http://localhost:3000/architect/sftp | Architect SFTP UI |
| http://localhost:3000/api/health | Health / DB check |

### Useful CIDCO npm scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js on port 3000 |
| `npm run sftp` | SFTP intake server |
| `npm run poll` | Poll1 + poll2 loop |
| `npm run db:migrate` | Interactive Prisma migrate |
| `npm run db:seed` | Seed demo users |
| `npm run db:studio` | Prisma Studio |
| `npm run build` / `npm start` | Production build + serve |

### Seeded logins (after `db:seed`)

Password for both: `Password123`

| Role | Email |
|------|-------|
| Architect | `architect@example.com` |
| CIDCO officer | `officer@cidco.example` |

Shared SFTP defaults (override in `.env`): user `cidco@example.com` / password `123456`.

---

## C. On the server, over PuTTY

Deploying the latest build on the Ubuntu box. Everything below is one session.

### 1. Pull and build

```bash
cd ~/CIDCO_WinEXE          # wherever you cloned it
git pull

cd CIDCO_WEB
npm ci                     # not npm install — matches package-lock exactly
npx prisma migrate deploy  # creates or updates every table
npx prisma generate        # the client the app imports
npm run build
```

`npm ci` fails if `package-lock.json` is missing; use `npm install` then.

If `migrate deploy` answers **"The database schema is not empty"**, the tables
were created from `prisma/full_schema.sql` rather than by Prisma, so there is
no migration history for it to build on. Tell it the existing migrations are
already applied — once, then it works normally from then on:

```bash
for m in $(ls prisma/migrations | grep -v migration_lock); do
  npx prisma migrate resolve --applied "$m"
done
npx prisma migrate deploy      # "No pending migrations to apply."
```

### 2. Tell the polls where the agent drops files

This is the step that decides whether anything appears on the portal. The
Windows agent uploads over plain SFTP into a folder; **poll1 only looks at
`CIDCO_INBOX_DIR`**, so if that is not the same folder, the files sit there and
the portal stays empty. Files arriving are not ingestion — something has to go
and read them.

In `CIDCO_WEB/.env`:

```
CIDCO_INBOX_DIR="/home/ubuntu/cidco/sftp1"
```

The folder must be the one in the agent's address bar, and the user running the
poll worker must be able to read **and delete** from it — poll1 moves files out.

### 3. Make yourself a CIDCO officer

Signing up on the portal creates an **architect**, which is why *Data* answers
*CIDCO officer sign-in required*. Officers are created here, because an officer
reads every company's data:

```bash
npm run officer:create -- you@cidco.gov.in "Your Name" YourPassword123
```

Run it on an email that already exists and it promotes that account instead,
keeping the password:

```bash
npm run officer:create -- you@cidco.gov.in
```

Then **sign out in the browser first** — the cookie carries the old role until
it is replaced — and sign in again at `/cidco`.

### 4. Run it

Two processes. The portal alone will never show data; the poll worker is what
puts it there.

```bash
# terminal 1 — the portal
npm start                          # port 3000

# terminal 2 — the ingestion worker
npm run poll
```

On a different port, use the standalone server:

```bash
PORT=8040 node .next/standalone/server.js
```

### 5. Keeping them up after you close PuTTY

Closing the session kills both. `pm2` survives logout and reboots:

```bash
sudo npm install -g pm2
cd ~/CIDCO_WinEXE/CIDCO_WEB

pm2 start npm --name cidco-web  -- start
pm2 start npm --name cidco-poll -- run poll
pm2 save
pm2 startup                      # run the sudo line it prints

pm2 logs cidco-poll              # watch ingestion
pm2 restart cidco-web cidco-poll # after a git pull + rebuild
```

Without pm2, `nohup npm start > web.log 2>&1 &` works but does not come back
after a reboot.

### 6. Checking it worked

```bash
ls ~/cidco/sftp1                 # should empty as poll1 files things away
pm2 logs cidco-poll --lines 20   # "poll1 moved=1 … poll2 processed=1"
```

Then open the portal, sign in at `/cidco` as the officer, and the delivery is
under **Data → the company → the date**, with its ten-step status. **Readings
table** shows the rows and which parameters are missing.

### If the portal is still empty

| What you see | What it means |
| --- | --- |
| *CIDCO officer sign-in required*, with the officer's name already in the sidebar | the browser is not keeping the session cookie. Serving over `http://` on a bare IP while the cookie is marked `Secure` does this, silently. Set `COOKIE_SECURE=false` in `.env` and restart, or serve over https |
| *CIDCO officer sign-in required* on a fresh sign-in | the account is an architect — step 3 |
| *Delivered transfers* stays empty | that page only shows CIDCO's own SFTP intake. Files dropped in a plain SFTP folder and picked up by the poll worker are under **Data** |
| Files pile up in the dropbox | the poll worker is not running, or `CIDCO_INBOX_DIR` points elsewhere |
| `poll1 … errors=… filename must be` | the file was not put there by the agent, so its name is not `companyId_dd_mm_yyyy_hh-mm-ss_AQI.csv` |
| Page loads unstyled | `.next/static` missing — rerun `npm run build` |
| *Environment variable not found: DATABASE_URL* | `.env` was not read; in Docker pass it into the container |

## Quick end-to-end check

1. Start Postgres + `npm run dev` + `npm run sftp` + `npm run poll` on CIDCO.
2. Register a company in `/cidco/sftp` (company id, IP, optional path).
3. On the architect PC, run `CIDCO_AQI_Agent.exe`, connect with that company id, send a `.csv`.
4. Confirm the file appears under Data / uploads, then poll2 stores readings and sets `fileStatus`.

---

## More detail

- Architect build notes: [`architect_WINexe/run.md`](./architect_WINexe/run.md)
- Portal-only notes: [`CIDCO_WEB/run.md`](./CIDCO_WEB/run.md)
- Overview: [`README.md`](./README.md)
