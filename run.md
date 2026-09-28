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

### The short version — pull, rebuild, restart both portals

```bash
cd ~/CIDCO_WinEXE/CIDCO_WEB
./deploy.sh
```

That is the whole deploy: pull, `npm ci`, `prisma migrate deploy`, `npm run
build`, then **reload** the pm2 processes. Safe to run as often as you like —
it reloads what is already running instead of starting more, so `pm2 ls` shows
the same three processes however many times it has run.

Changed only an `.env` value, like the poll interval or the port?

```bash
./deploy.sh --no-build
```

### The three web processes

| pm2 name | What | Port from |
|---|---|---|
| `cidco-web` | the CIDCO officer portal, both channels, plus the architect's SFTP workspace | `PORT` in `CIDCO_WEB/.env` |
| `arch-web` | the architect's API portal and the endpoints their station posts to | `ARCH_WEB_PORT` in `CIDCO_WEB/.env` |
| `cidco-poll` | ingestion — poll1 and poll2 | n/a |
| `cidco-sftp` | the SFTP intake the Windows agent connects to | `SFTP_PORT` |

`deploy.sh` builds both portals in one pass. They share a database, so a deploy
that rebuilt only half would leave the two disagreeing about the schema.

Tell each where the other is, in `.env`:

```
# CIDCO_WEB/.env
PORT=8040
ARCH_WEB_PORT=8041
ARCH_WEB_URL="http://13.127.203.85:8041"

# arch_web/.env
CIDCO_WEB_URL="http://13.127.203.85:8040"
JWT_SECRET=<<the same value as CIDCO_WEB>>
```

Both addresses are read at request time, so changing a port is an `.env` edit
and `pm2 reload`, never a rebuild.

#### What `JWT_SECRET` is, and when to change it

**Set it once. It is not per user, and it does not change when somebody logs
in.**

When anyone signs in, the server makes a small signed note — a JSON Web Token —
saying *who* they are, *what role* they have and *when it expires* (12 hours),
and puts it in a cookie. `JWT_SECRET` is the key it signs that note with.

On every later request the server re-checks the signature with the same key. If
it matches, the note is genuine and the request is that person. If it does not,
the note is rejected. That is the whole mechanism: **the secret proves the note
came from your server**, so nobody can hand-write a cookie claiming to be a
CIDCO officer.

The token itself is different for every user and every sign-in. The **secret**
is one value for the installation:

| | |
| --- | --- |
| Per user? | No. One value for the whole server |
| Change on each login? | No. Never touched by logging in |
| Must both portals match? | **Yes.** Cookies ignore the port, so the cookie CIDCO_WEB sets is sent to arch_web too. Different secrets and arch_web rejects it — an architect who just signed in lands on a login form with no explanation |
| Change it when? | Only if it leaks, or when rotating credentials deliberately. Everyone is signed out and has to log in again — nothing else breaks |
| How long? | 32+ random characters. `openssl rand -base64 48` |

```bash
openssl rand -base64 48        # generate once, paste into BOTH .env files
```

It is not the architect's API token, and not their SFTP password — those are
per architect and live in the database. This is only the server's own signing
key for browser sessions.

### First time on a box, or after a reboot

```bash
# 1. once per machine
sudo npm install -g pm2

# 2. get the code
cd ~
git clone https://github.com/karthikj30/CIDCO_WinEXE.git      # or: cd CIDCO_WinEXE && git pull
cd CIDCO_WinEXE

# 3. settings — see the block below for what goes in each
nano CIDCO_WEB/.env                      # DATABASE_URL, PORT, ARCH_WEB_*, JWT_SECRET
cp arch_web/.env.example arch_web/.env
nano arch_web/.env                       # DATABASE_URL, CIDCO_WEB_URL, the SAME JWT_SECRET

# 4. the CIDCO portal — this also owns the database
cd CIDCO_WEB
npm ci
npx prisma migrate deploy
npm run build

# 5. the architect API portal
cd ../arch_web
npm ci                                   # generates its own Prisma client
npm run build

# 6. start everything
cd ../CIDCO_WEB
pm2 startOrReload ecosystem.config.js
pm2 save
pm2 startup                              # run the sudo line it prints, once
```

Four processes come up:

| pm2 name | What | Listens on |
| --- | --- | --- |
| `cidco-web` | the CIDCO officer portal — both channels — and the architect's SFTP workspace | `PORT` |
| `arch-web` | the architect's API portal and the endpoints their station posts to | `ARCH_WEB_PORT` |
| `cidco-poll` | ingestion: poll1 and poll2 | — |
| `cidco-sftp` | the SFTP intake the Windows agent connects to | `SFTP_PORT` |

After that, every deploy is just `./deploy.sh` from `CIDCO_WEB` — it pulls,
installs, migrates, builds **both** portals and reloads all four.

### Never use `npm start` or `npm restart` here

They start a *second* copy beside the one pm2 is already running, and you get:

```
Error: listen EADDRINUSE: address already in use :::3000
```

Use pm2:

```bash
pm2 reload cidco-web           # just the portal
pm2 reload all                 # everything
pm2 ls                         # what is actually running
pm2 logs cidco-poll            # follow ingestion
```

If duplicates have already built up, clear them once:

```bash
pm2 delete all
pm2 startOrReload ecosystem.config.js
pm2 save
```

### Which port

Nothing in the code hardcodes one. Set it in `CIDCO_WEB/.env`:

```
PORT=8040
```

`ecosystem.config.js` reads it from there, and a shell variable of the same
name wins over it. Change it in one place and pm2, the build and the health
check all follow.

### Checking both channels

Both live on **one dashboard** now — sign in once at `/cidco` and the sidebar
has them grouped:

```
Monitoring dashboard
SFTP channel    Delivered transfers · Data · Companies (master) · SFTP accounts
API channel     AQI data · Architect handshakes · Validation requests ·
                Token requests · Communication logs
```

`/cidco/sftp` still works and opens on the SFTP group, so old links are fine.

From the shell:

```bash
# is the portal up and can it see the database?
curl -s localhost:8040/api/health
# {"success":true,"data":{"status":"ok","database":"connected", … }}

# is ingestion running? a line every POLL_INTERVAL_MS
pm2 logs cidco-poll --lines 5 --nostream

# is the SFTP intake listening?
pm2 logs cidco-sftp --lines 5 --nostream
ss -ltnp | grep 2222

# every page answering, on both portals
for r in / /cidco /cidco/sftp /architect/sftp; do
  printf '  8040%-18s %s\n' "$r" "$(curl -s -o /dev/null -w '%{http_code}' localhost:8040$r)"
done
printf '  8041/%-17s %s\n' "" "$(curl -s -o /dev/null -w '%{http_code}' localhost:8041/)"

# do the two know about each other?
curl -s localhost:8040/api/config     # {"archWebUrl":"http://…:8041"}
curl -s localhost:8041/api/config     # {"cidcoWebUrl":"http://…:8040"}
```

In the browser, signed in as an officer:

| Check | Where | What good looks like |
| --- | --- | --- |
| **SFTP channel** | Data | *Poll worker last ran Ns ago*, and the delivery under the site → the date, with its ten-step status |
| | Monitoring dashboard | sites on the map, AQI in the charts |
| | Companies (master) | the site, its keys, node and department |
| **API channel** | AQI data | readings posted through the API |
| | Architect handshakes | the credentials issued, and their status |
| | Token requests | anything waiting for approval |

An architect still gets two doors on the front page — **API integration** and
**SFTP file transfer** — because they use one or the other.

### Scheduling the two polls

One process runs both every 15 seconds by default. To give them separate
schedules — poll1 only reads file names and is cheap, poll2 parses whole
spreadsheets:

```bash
POLL1_INTERVAL_MS=5000   npm run poll -- --only=1
POLL2_INTERVAL_MS=60000  npm run poll -- --only=2
```

As pm2 processes: comment out `cidco-poll` in `ecosystem.config.js`, uncomment
`cidco-poll1` and `cidco-poll2` below it, then `./deploy.sh --no-build`.

### Looking at PostgreSQL

**On the server**, straight in:

```bash
psql -h localhost -U cidco_sftp -d cidco_sftp
```

`DATABASE_URL` in `.env` has the user, database and password. Its
`?schema=public` is a **Prisma-only** parameter — psql rejects it, so use the
plain form above.

**On a different port.** Postgres is on 5432 by default; a second instance or
the docker-compose one is usually 5433:

```bash
psql -h localhost -p 5433 -U cidco_user -d cidco_aqi

# which port is this server on?
psql -h localhost -U cidco_sftp -d cidco_sftp -c "show port"

# what is listening
ss -ltnp | grep -E '543[0-9]'
```

Match `.env` to it:

```
DATABASE_URL="postgresql://cidco_user:cidco_password@localhost:5433/cidco_aqi?schema=public"
```

**From your own laptop — use an SSH tunnel, do not open the port.** Forward the
server's 5432 to any free local port, say 6543:

```bash
ssh -i <your-key.pem> -L 6543:localhost:5432 ubuntu@<server-ip>
```

Leave that open, and point psql, pgAdmin or DBeaver on your machine at
`localhost:6543`:

```bash
psql -h localhost -p 6543 -U cidco_sftp -d cidco_sftp
```

**Prisma Studio, the click-to-edit view.** On the server:

```bash
cd ~/CIDCO_WinEXE/CIDCO_WEB
npx prisma studio                  # port 5555
npx prisma studio --port 5600      # or any free port
```

The `http://localhost:5555` it prints is **the server's** localhost. Studio
listens on every interface, so what stops your browser reaching it is the EC2
security group — which should stay closed. Tunnel it instead, from your laptop:

```bash
ssh -i <your-key.pem> -L 5555:localhost:5555 ubuntu@<server-ip>
```

then open `http://localhost:5555` in your own browser.

> **Do not open 5555 or 5432 in the security group.** Prisma Studio has no login
> of any kind — anyone who finds the port gets full read and write on every
> table, including dropping it.

**Some queries worth having:**

```bash
psql -h localhost -U cidco_sftp -d cidco_sftp <<'SQL'
\dt                                                    -- the tables
SELECT "siteName", "architectName", active FROM companies ORDER BY 1;
SELECT "pollStatus", COUNT(*) FROM data_files GROUP BY 1;   -- anything stuck?
SELECT c."siteName", COUNT(r.id) AS readings
FROM companies c LEFT JOIN reports r ON r."companyRecordId" = c.id
GROUP BY 1 ORDER BY 2 DESC;
SQL
```

### Tell the polls where the agent drops files

The step that decides whether anything appears at all. The Windows agent
uploads into a folder; **poll1 only looks at `CIDCO_INBOX_DIR`**, so if that is
not the same folder the files sit there and the portal stays empty.

In `CIDCO_WEB/.env`:

```
CIDCO_INBOX_DIR="/home/ubuntu/cidco/sftp1"
```

It must be the folder in the agent's address bar, and the user running the poll
worker must be able to read **and delete** from it — poll1 moves files out.

A **relative** path such as `./storage/cidco-data` is measured from the
`CIDCO_WEB` folder by both the portal and the poll worker, so they agree.

### Make yourself a CIDCO officer

**From the portal** — open `/cidco`, choose **Create an account**, pick *CIDCO
officer*. The first officer on an empty database needs no code; every one after
needs `CIDCO_OFFICER_SIGNUP_CODE` from `CIDCO_WEB/.env`.

Or from the shell, which also promotes an account created by mistake:

```bash
npm run officer:create -- you@cidco.gov.in "Your Name" YourPassword123
npm run officer:create -- you@cidco.gov.in        # promote, keep the password
```

After promoting, **sign out in the browser first** — the cookie carries the old
role until it is replaced.

### If migrate deploy refuses

If it answers **"The database schema is not empty"**, the tables were created
from `prisma/full_schema.sql` rather than by Prisma, so there is no migration
history to build on. Tell it the existing migrations are already applied —
once, then it works normally:

```bash
for m in $(ls prisma/migrations | grep -v migration_lock); do
  npx prisma migrate resolve --applied "$m"
done
npx prisma migrate deploy      # "No pending migrations to apply."
```

### If the portal is still empty

| What you see | What it means |
| --- | --- |
| *CIDCO officer sign-in required*, with the officer's name already in the sidebar | the browser is not keeping the session cookie. Serving over `http://` on a bare IP while the cookie is marked `Secure` does this, silently. Set `COOKIE_SECURE=false` in `.env` and reload |
| *CIDCO officer sign-in required* on a fresh sign-in | the account is an architect — promote it above |
| Data says *Poll worker is not running* | start it: `pm2 startOrReload ecosystem.config.js` |
| Data says *N files cannot be filed* | the names are not in the agent's format. It lists them; rename or remove them from the inbox |
| Files pile up in the dropbox | `CIDCO_INBOX_DIR` points somewhere else |
| A new site's files never appear | the poll worker again — a site does not need registering first, poll1 creates it from the file name |
| `poll1 … errors=… filename must be` | the file was not put there by the agent. The name has to be `siteName_dd_mm_yyyy_hh-mm-ss[_lat_lon]_AQI.csv` |
| Page loads unstyled, or `ChunkLoadError` | the old process is still serving a deleted build. `pm2 reload cidco-web` |
| *Environment variable not found: DATABASE_URL* | `.env` was not read; in Docker pass it into the container |

## Quick end-to-end check

1. Start Postgres, then `pm2 startOrReload ecosystem.config.js` (or `npm run dev`
   + `npm run sftp` + `npm run poll` locally).
2. Register the site in **Companies (master)** — site name, designated path, and
   the registered position the map checks deliveries against.
3. On the architect PC run `CIDCO_AQI_Agent.exe`, connect with that site name,
   and send a `.csv`.
4. **Data** shows the file under the site → the date with all ten steps OK, the
   **Monitoring dashboard** puts it on the map, and **Delivered transfers**
   counts it.

---

## More detail

- Architect build notes: [`architect_WINexe/run.md`](./architect_WINexe/run.md)
- Portal-only notes: [`CIDCO_WEB/run.md`](./CIDCO_WEB/run.md)
- Overview: [`README.md`](./README.md)
