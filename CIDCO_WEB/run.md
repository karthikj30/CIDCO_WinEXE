# Running the CIDCO AQI Portal (local)

Quick reference for pulling, setting up, and running this project on Windows.

---

## Requirements

- Node.js 18.18+ (developed on 22.x)
- npm
- Docker Desktop (for PostgreSQL), **or** a local PostgreSQL 14+

---

## 1. Get the latest code

```powershell
git fetch origin
git pull origin main
```

If you have local edits that touch `prisma/schema.prisma` (or related files):

```powershell
git stash push -m "wip" -- prisma/schema.prisma prisma/seed.ts src/lib/prisma.ts
git pull origin main
git stash pop
```

---

## 2. Install dependencies

```powershell
npm install
```

---

## 3. Environment

```powershell
copy .env.example .env
```

Edit `.env`. For the Docker Postgres container used in local dev (`cidco-postgres` on port **5432**):

```env
DATABASE_URL="postgresql://cidco:cidco_dev@localhost:5432/cidco_aqi?schema=public"
JWT_SECRET="dev-jwt-secret-change-me-for-local-only-cidco-aqi"
UPLOAD_DIR="./uploads"
NEXT_PUBLIC_APP_NAME="CIDCO AQI Compliance Portal"
```

> **Note:** `docker-compose.yml` uses Postgres on host port **5433** with user/password `cidco_user` / `cidco_password`. If you run via Compose instead of the standalone container, set `DATABASE_URL` accordingly.

---

## 4. Start PostgreSQL

### Option A — standalone container (usual local setup)

```powershell
# Start Docker Desktop first if it is not running

# Create once:
docker run -d --name cidco-postgres `
  -e POSTGRES_USER=cidco `
  -e POSTGRES_PASSWORD=cidco_dev `
  -e POSTGRES_DB=cidco_aqi `
  -p 5432:5432 `
  postgres:16-alpine

# Later sessions:
docker start cidco-postgres
docker exec cidco-postgres pg_isready -U cidco -d cidco_aqi
```

### Option B — docker compose (app + DB)

```powershell
docker compose up -d --build
```

- App: http://localhost:3000  
- DB: localhost:5433  

---

## 5. Database migrations + seed

```powershell
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

> The Prisma client is generated from `prisma/schema.prisma` and is **not** committed. `npm install`,
> `npm run dev`, `npm run build`, `npm run sftp` and `npm run db:seed` all run `prisma generate`
> first, so after a `git pull` you only need `npx prisma migrate deploy` for new migrations.

Seeded accounts (password for both: `Password123`):

| Role          | Email                 |
| ------------- | --------------------- |
| Architect     | architect@example.com |
| CIDCO officer | officer@cidco.example |

**Connect with CIDCO** demo credentials (Architect portal → enter any pair; not the officer name):

| # | CIDCO user id       | CIDCO password                     |
| - | ------------------- | ---------------------------------- |
| 1 | `ARCH-DEMO00000001` | `hs_sec_demo_local_dev_only_0001`  |
| 2 | `ARCH-DEMO00000002` | `hs_sec_demo_local_dev_only_0002`  |
| 3 | `ARCH-DEMO00000003` | `hs_sec_demo_local_dev_only_0003`  |
| 4 | `ARCH-DEMO00000004` | `hs_sec_demo_local_dev_only_0004`  |
| 5 | `ARCH-DEMO00000005` | `hs_sec_demo_local_dev_only_0005`  |

After you send for approval, sign in as the officer and approve the validation request.

---

## 6. Run the app (dev)

```powershell
npm run dev
```

Open:

| URL | Purpose |
| --- | ------- |
| http://localhost:3000 | CIDCO / main portal |
| http://localhost:3000/architect | Architect portal |
| http://localhost:3000/api/health | Health check (DB connectivity) |
| http://localhost:3000/docs/architect | Architect API docs |

Health should look like:

```json
{"success":true,"data":{"status":"ok","database":"connected",...}}
```

---

## 7. Useful npm scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Next.js dev server on port 3000 |
| `npm run build` | Generate Prisma client + production build |
| `npm start` | Production server on port 3000 |
| `npm run start:standalone` | The standalone server, `.next/standalone/server.js` |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | Interactive migrate (`prisma migrate dev`) |
| `npm run db:push` | Push schema without a migration |
| `npm run db:seed` | Seed demo users / data |
| `npm run db:studio` | Prisma Studio (DB GUI) |

---

## 8. Postman

Import collections from `postman/`:

- `postman/CIDCO-Architect-Handshake.postman_collection.json` — handshake / validate / tokens / data
- `postman/CIDCO-AQI-Portal.postman_collection.json` — older AQI portal APIs

Set collection variable `baseUrl` to `http://localhost:3000`.

---

## 9. Common fixes

**Port 3000 already in use**

```powershell
netstat -ano | findstr ":3000"
# Stop the PID that is LISTENING, then:
npm run dev
```

**"Cannot read properties of undefined (reading 'findMany')", or "Unknown field ... on model ..."**

Your generated Prisma client is older than `prisma/schema.prisma`. The client is built from the
schema and is not in git, so a pull that changes the schema leaves it stale.

`npm run dev`, `npm run build`, `npm run sftp`, `npm run db:seed` and `npm install` all regenerate it
automatically, so this normally fixes itself. If you started the server some other way:

```powershell
npx prisma generate
npx prisma migrate deploy
```

then restart. (`src/lib/prisma.ts` checks for this at startup and says so plainly rather than failing
with an undefined error.)

**Prisma `EPERM` / locked query engine (Windows)**

The query engine cannot be rewritten while a node process is holding it. Stop every running
`npm run dev` / `npm run sftp` window, then:

```powershell
npx prisma generate
```

**Docker Desktop not running**

```
error during connect: ... dockerDesktopLinuxEngine ...
```

Start Docker Desktop, wait until it is ready, then `docker start cidco-postgres`.

**Pull after local Prisma path edits conflict**

```powershell
git stash push -m "wip" -- prisma/schema.prisma prisma/seed.ts src/lib/prisma.ts
git pull origin main
git stash pop
npx prisma generate
npx prisma migrate deploy
```

**Stop Postgres container**

```powershell
docker stop cidco-postgres
```

---

## Typical day-to-day sequence

```powershell
# 1. Latest code
git pull origin main

# 2. DB
docker start cidco-postgres

# 3. Schema catch-up (after pulls that add migrations)
npx prisma migrate deploy

# 4. App  (regenerates the Prisma client for you)
npm run dev

# 5. SFTP intake, in a second window
npm run sftp
```
