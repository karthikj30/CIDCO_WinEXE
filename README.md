# CIDCO WinEXE + Web

Two codebases in one repository:

| Folder | What it is |
|--------|------------|
| [`architect_WINexe/`](./architect_WINexe) | Windows `.exe` agent — picks up a local CSV, renames it to `companyId_timestamp_AQI.csv`, checks the remote path exists (does **not** create folders), and uploads |
| [`CIDCO_WEB/`](./CIDCO_WEB) | CIDCO web portal + SFTP intake + database — **poll1** files under `company/dd_mm_yyyy/hh-mm-ss.csv`, **poll2** runs the 10-step AQI ingestion and archives |

## Flow

```
Architect PC                         CIDCO server
────────────                         ────────────
readings.csv
   │  rename → ABCD123_21_09_2026_16-02-00_AQI.csv
   │  check destination path exists (else log "does not exist")
   ▼
SFTP / portal upload ─────────────►  storage/inbox/
                                          │
                                     poll1 (npm run poll)
                                          ▼
                            company/dd_mm_yyyy/hh-mm-ss.csv
                                          │
                                     poll2
                                          ▼
                               DB (master + data) + archive/
                               fileStatus = steps 1–10 or CORRECT
```

## Databases (CIDCO_WEB)

**Master** (`companies`): `companyId`, `publicKey`, `privateKey`, `userId` (plus name / IP / optional file path).

**Data** (`data_files`): `companyId`, `timestamp`, `aqiData`, `fileStatus`, poll status, folder indexes.

## Build / run

```bat
cd architect_WINexe
build.bat
```

```bash
cd CIDCO_WEB
npm install
npm run db:migrate
npm run sftp    # intake
npm run poll    # poll1 + poll2 worker
npm run dev     # portal
```

See each folder’s README for details.
