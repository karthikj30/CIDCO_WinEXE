# arch_web — the architect's API portal

The architect's half of the API channel: their dashboard, and the
token-authenticated endpoints their monitoring station posts readings to.

It runs as its own app on its own port, against the **same PostgreSQL database**
as the CIDCO portal beside it.

## What is here, and what is not

| | Where |
|---|---|
| Architect API dashboard, `/` | **here** |
| `/api/architect/data`, `validate`, `refresh`, `token-requests`, `logs`, … | **here** |
| Architect SFTP workspace, `/architect/sftp` | `CIDCO_WEB` |
| `/api/architect/sftp/transfer` — what the Windows agent posts to | `CIDCO_WEB` |
| The CIDCO officer dashboard | `CIDCO_WEB` |
| The database schema and every migration | `CIDCO_WEB/prisma` |

The SFTP channel was deliberately left where it was: the Windows agent is
installed on architects' machines with an address already configured, and
moving its endpoint would mean visiting every one of them.

## Running it

```bash
npm ci
npm run build        # checks the shared lib first, then builds
PORT=8041 node .next/standalone/arch_web/server.js
```

Or through pm2 from the CIDCO portal, which starts both:

```bash
cd ../CIDCO_WEB && ./deploy.sh
```

## Settings

`.env` — see `.env.example`:

- `DATABASE_URL` — the same database as `CIDCO_WEB`
- `JWT_SECRET` — **the same value as `CIDCO_WEB`**. Cookies ignore the port, so
  one sign-in covers both portals; different secrets and an architect who signed
  in at the front door lands on a login form here
- `CIDCO_WEB_URL` — where the CIDCO portal is, for the links back. Read at
  request time, so changing it is an edit and a reload, not a rebuild
- `PORT` — where this listens

## The shared library

`src/lib/` holds a copy of eleven modules from `CIDCO_WEB/src/lib/` — auth, the
Prisma client, validation, the handshake rules — so this app can be built and
deployed on its own.

A copy drifts, and the failure is quiet: a token that validates on one port and
not the other. `scripts/check-shared-lib.mjs` runs before every build and fails
it if any of the eleven differ, naming the file.

The Prisma **schema** is not copied. `npm run db:generate` reads
`../CIDCO_WEB/prisma/schema.prisma`, so there is one schema and one set of
migrations, owned by `CIDCO_WEB`.
