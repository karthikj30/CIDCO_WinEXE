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
