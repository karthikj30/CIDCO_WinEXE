# CIDCO SFTP Channel

The second way an architect delivers AQI data to CIDCO: a **CSV sent over SFTP**, automatically.

It is deliberately separate from the [API channel](./ARCHITECT_API.md) — different credentials,
different dashboards, a different transport. An SFTP user id will not open the API, and an API
client id will not open the SFTP server.

Everyone starts at the portal's front door (`/`), signs in, and picks the channel they work in.
The SFTP dashboards are `/cidco/sftp` for officers and `/architect/sftp` for architects.

---

## The flow

**Before any credentials exist, CIDCO registers the company by hand.** That record is the reference
every later transfer is checked against.

| # | Who | Action | Where |
|---|-----|--------|-------|
| **i** | CIDCO | **Registers the company**: company name, company id, the architect's server IP, and the file path their CSV is taken from | `/cidco/sftp` → Companies |
| **1** | CIDCO | **Emails the architect** the shared portal login, plus their company's SFTP user id, password and the **designated IP** to send to | `/cidco/sftp` → Companies → Issue credentials |
| **2** | Architect | **Sends automatically** — takes the CSV from the registered path and puts it on the designated address | their own server |
| **✓** | CIDCO | **Validates every single transfer** against the registration, then stores the readings | `/cidco/sftp` → Delivered transfers |

Two different addresses are in play, and it is worth keeping them straight:

- the **designated IP** — CIDCO's address, emailed to the architect, the one they send *to*;
- the **architect's server IP** — registered by CIDCO, the only address data is accepted *from*.

---

## i. Registering the company

A CIDCO officer enters four things by hand:

| Field | Meaning |
|-------|---------|
| **Company name** | e.g. `Nair Design Studio` |
| **Company id** | CIDCO-assigned, e.g. `CIDCO-CO-0142`. Quoted on every transfer. |
| **Architect's server IP** | e.g. `203.0.113.9`. Data is only accepted from here. |
| **File path** | e.g. `/var/aqi/exports`. Where the CSV is picked up from, and written to here. |

The architect's email goes in the same form and is **stored as contact detail only** — any email is
accepted and no account is created for it.

## Signing in

Architects do not get an account each. **One shared CIDCO portal login is handed to every
architect:**

```
cidco@gmail.com  /  123456
```

(Override with `ARCHITECT_PORTAL_EMAIL` / `ARCHITECT_PORTAL_PASSWORD`.)

That login only opens the door. Inside `/architect/sftp` the architect **connects** the way they
would in WinSCP — designated address, SFTP user id, password — and *that* pair identifies their
company. Readings are attributed to the company, not to a person.

A registration can be corrected later (`PATCH /api/admin/sftp/companies/:id`) — the change applies
to the very next transfer, because validation reads this record every time. Deactivating a company
stops its transfers immediately.

## 1. The credentials CIDCO emails

Issued against a registration, and returned exactly once:

```json
{
  "companyName": "Nair Design Studio",
  "companyId": "CIDCO-CO-0142",
  "username": "sftp_6d94ababfb",
  "password": "xQ8w…",
  "designatedIp": "cidco.example.gov.in",
  "port": 2222,
  "protocol": "SFTP (SSH File Transfer Protocol)",
  "filePath": "/var/aqi/exports",
  "fileTypes": ".csv (or .xlsx)",
  "expiryDate": "2027-09-11T05:08:00.000Z"
}
```

There is **no separate approval step**. Registering the company *is* CIDCO's manual gate, so these
credentials work from the moment they are issued — and every transfer is still validated one by one.

## 2. Sending

On the architect's own server, any SFTP client will do:

```bash
sftp -P 2222 sftp_6d94ababfb@cidco.example.gov.in
sftp> put /var/aqi/exports/readings.csv /var/aqi/exports/
```

Connecting drops you straight into the registered file path, so a bare `put readings.csv` lands in
the right place.

The repo ships a ready-made sender that does this on a schedule:

```bash
SFTP_USER=sftp_6d94ababfb \
SFTP_PASSWORD=xQ8w… \
SFTP_DESIGNATED_IP=cidco.example.gov.in \
SFTP_FILE_PATH=/var/aqi/exports \
SFTP_EVERY_MINUTES=180 \
npx tsx scripts/architect-sender.ts
```

It takes the newest `.csv` from that path and sends it every three hours. Add `--once` for a single
run. Because it runs on the architect's own machine, the address CIDCO sees is the architect's real
server address — which is exactly what CIDCO validates.

### Sending by hand, from the portal

`/architect/sftp` has a WinSCP-style pair of panes: the architect's own files on the left (open a
folder, browse it), CIDCO on the right at the registered path. Drag a CSV across, or hit **Send →**.
They enter the same user id, password and designated IP CIDCO emailed.

That route is recorded as mode `PORTAL` rather than `DIRECT_SFTP` so an officer can tell the two
apart, and it goes through **exactly the same validation** — the address checked is the one the
architect's browser is connecting from.

---

## ✓ Validation, on every transfer

Each transfer presents three things, and CIDCO compares all three against the company record:

| Checked | Where it comes from |
|---------|---------------------|
| **Company id** | the registration behind the credentials the transfer authenticated with |
| **Server IP** | the address the connection actually came from |
| **File path** | the directory the file was written to |

If any one of them does not match, the file is **refused: nothing is parsed and no reading is
stored**. The transfer is still recorded, marked `REJECTED`, with the reason and the field that
failed, so an officer can see what happened.

A connection from an unregistered address never gets that far — it is refused at authentication.

The dashboard shows the comparison in full — incoming beside registered, with a tick or a cross per
field — above a preview of the file as it arrived. The architect sees the same result on their own
page.

When validation passes, the file is parsed and imported. **Rows are independent**: a row that fails
validation is recorded with its row number and reason while every other row still imports, so one
typo never costs the whole transfer.

| Status | Meaning |
|--------|---------|
| `PARSED` | validated; every row became a reading |
| `PARTIAL` | validated; some rows imported, some were rejected |
| `FAILED` | validated, but nothing could be imported (or the file could not be read) |
| `REJECTED` | **failed validation — nothing was stored** |
| `RECEIVED` | on disk, not processed yet |

---

## The file

Download a template from `/architect/sftp`, or `GET /api/architect/sftp/template` (add
`?format=xlsx` for Excel). **Row 1 is the header; every row after it is one reading.** The columns
are the same AQI parameters the API channel takes:

| Column | Notes |
|--------|-------|
| Project / Site ID | |
| Monitoring Station / Device ID | |
| OEM | |
| Model | |
| Site Name | falls back to the site/station id when blank |
| Location | |
| Date & Time of Reading | ISO 8601, or a real Excel date cell |
| AQI Value | **required**, whole number |
| PM2.5, PM10, NO2, SO2, CO, O3 | |
| Temperature, Humidity | |
| Other Parameters | free text, stored as a note |
| Data Source / Integration Method | defaults to "SFTP Excel upload" |

Common alternative spellings are accepted (`PM 2.5`, `NO₂`, `AQI`, `Timestamp`, `Site`, …), so a
sheet an architect already keeps will usually import as-is. Both `.csv` and `.xlsx` are read; CSV is
what the automated feed normally exports.

---

## Running the server

The SFTP server is a separate process from the Next.js app:

```bash
npm run sftp      # listens on SFTP_PORT (default 2222)
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `SFTP_PORT` | `2222` | port the SFTP server listens on |
| `SFTP_HOST` | `0.0.0.0` | interface it binds to |
| `SFTP_STORAGE_DIR` | `./storage/sftp` | received files and the SSH host key |
| `SFTP_PUBLIC_HOST` | request host | the **designated IP** shown to architects and emailed out |

The SSH host key is generated on first boot and kept under `SFTP_STORAGE_DIR`, so architects' clients
do not warn about a changed key on every restart. That directory is gitignored — it holds the host
key and every file received.

---

## HTTP endpoints behind the dashboards

Officer-only, session-authenticated — the transfer itself is SFTP, not HTTP.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/sftp/companies` | The register, with the credentials issued against each row |
| `POST` | `/api/admin/sftp/companies` | Register a company (step i) |
| `PATCH` | `/api/admin/sftp/companies/:id` | Correct a registration, or deactivate it |
| `GET` | `/api/admin/sftp/accounts` | Every SFTP user id and the company behind it |
| `POST` | `/api/admin/sftp/accounts` | Issue credentials against a registration (step 1) |
| `GET` | `/api/admin/sftp/uploads` | Every transfer, with its validation result |
| `GET` | `/api/admin/sftp/uploads/:id` | One transfer: the full comparison and a preview of the file |
| `GET` | `/api/admin/sftp/data` | The data table as a company / month / timestamp tree |
| `GET` | `/api/admin/sftp/data/:id/download` | One filed CSV, byte for byte as it arrived |

Architect:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/architect/sftp/me` | session | Their registration, where to send, and every transfer's result |
| `POST` | `/api/architect/sftp/transfer` | SFTP user id + password | The portal's drag-and-drop send |
| `GET` | `/api/architect/sftp/template` | — | The blank CSV (`?format=xlsx` for Excel) |

---

## End-to-end test

With both servers running (`npm start` and `npm run sftp`):

```bash
npx tsx scripts/sftp-e2e.ts
```

It registers a company, issues credentials against it, sends a CSV over a real SFTP client, and
checks the validation both ways — an accepted transfer that stores its rows, one written to the
wrong path that is refused with nothing stored, and a connection from an unregistered address that
never authenticates. `scripts/api-e2e.ts` does the same for the API channel.


---

## The Windows agent

Most architects will not run an SFTP client by hand. They install the **CIDCO AQI Agent** — a small
Windows program kept in [`karthikj30/CIDCO_WinEXE`](https://github.com/karthikj30/CIDCO_WinEXE) —
which watches their export folder and sends the newest CSV on a schedule.

It is the same channel and the same validation; only the sign-in differs.

### Two doors, one channel

The intake is reachable two ways, and they are the same channel throughout —
same credentials, same validation, same data table. Only the transport differs,
and CIDCO records which was used (`DIRECT_SFTP` or `PORTAL`).

| Door | Where | Who uses it |
| --- | --- | --- |
| SFTP | `SFTP_PORT`, default 2222 | The Windows agent by default, and any SFTP client |
| Portal | `POST /api/architect/sftp/transfer` on the web app | The browser drag-and-drop, and the Windows agent when its address starts `http://` |

The second exists because the portal's port is very often the one a site has
already opened. The SFTP intake is a separate process on its own port, and a
firewall that lets the portal through frequently does not let the intake
through. Rather than leave the architect unable to send anything, the agent can
hand the same file to the same intake over HTTP.

Both doors accept the shared CIDCO login. Over SFTP the company travels in the
upload path; over HTTP it travels as a `companyId` form field. Everything after
that is identical.

### One shared login, and the company in the path

Rather than a per-company SFTP user id, the agent signs in with a single login CIDCO publishes:

| | |
|---|---|
| User id | `SFTP_SHARED_USER`, default `cidco@example.com` |
| Password | `SFTP_SHARED_PASSWORD`, default `123456` |

That login says *an architect is calling*. It does not say **which** one — that comes from the
company id at the front of the upload path:

```
/<companyId>/<file>.csv
/ABCD123/ABCD123_21_09_2026_11-30-24_AQI.csv
```

The server reads the company id when the file is opened and looks it up in the master table. An
unregistered or deactivated id is refused there and then with `PERMISSION_DENIED` — the bytes are
never accepted.

A **registered** company whose IP or file path does not match is allowed to finish the upload, so
CIDCO can record exactly what it presented, and is then recorded as `REJECTED` with the reason. The
close is answered with `PERMISSION_DENIED`, so the upload **fails on the sender's side too**: the
architect has no view of this dashboard, so a refusal they never hear about would leave a
misconfigured agent reporting success indefinitely. Either way nothing is stored.

### The data table

An accepted file is written under `CIDCO_DATA_DIR` (default `./storage/cidco-data`) as

```
<companyId>/<Month>/<timestamp>/<file>.csv
ABCD123/2026-09-September/2026-09-18_Friday_07-02-17/readings.csv
```

and a `data_files` row records where it landed, how many rows it held, how many were stored, the
address it came from and when. The **Data** tab in `/cidco/sftp` walks that tree, showing each
company's master row above it, and every file can be downloaded exactly as it arrived.

So the two tables divide as CIDCO asked:

- **master** — `companies`, one row per registration: company id, name, architect server IP, file
  path, contact.
- **data** — `data_files`, the folder tree of everything accepted, underneath its company.

### The CSV

```
Project / Site ID, AQI Monitoring Station / Device ID, OEM / Model,
Date & Time of Reading, AQI Value, PM2.5, PM10, NO₂, SO₂, CO, O₃,
Temperature, Humidity, Other applicable environmental parameters,
Data Source / Integration Method, Data Receipt Timestamp
```

Headers are matched on their letters and digits alone, so `PM 2.5` and `PM2.5`, `NO₂` and `NO2`,
`Station/Device ID` and `AQI Monitoring Station / Device ID` all reach the same field. A column
CIDCO does not recognise is kept in the preview and otherwise ignored, so an architect never has to
rename an existing sheet to be accepted.
