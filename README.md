# CIDCO AQI Agent — architect side (Windows)

The Windows program an architect installs once and then leaves running. It picks
up the AQI export from a folder on their own machine and sends it to CIDCO over
**SFTP** on a schedule. There is no API key and no web login here — this is the
SFTP channel only.

The architect never sees CIDCO's database. The agent's only job is to hand the
file over; CIDCO validates it and stores it on their side.

```
  architect's PC                              CIDCO
  ──────────────                              ─────
  C:\CIDCO\exports\readings.csv
        │
        │  SFTP, every <chosen interval>
        │  signs in as cidco@example.com
        ▼
  /ABCD123/C:/CIDCO/exports/readings.csv  ──►  validate company id + source IP
                                               + file path against the master row
                                                     │
                                                     ▼
                                          data table:  ABCD123
                                                       └ 2026-09-September
                                                         └ 2026-09-18_Friday_06-55-58
                                                           └ readings.csv
```

## What's in the repo

| File | What it is |
| --- | --- |
| `CIDCO_Setup.bat` | Runs the installer dialog straight from source |
| `run_agent.bat` | Opens the transfer window |
| `build.bat` | Builds `CIDCO_Setup.exe` and `CIDCO_Agent.exe` with PyInstaller |
| `cidco/installer.py` | The setup wizard (role → folder → schedule → install) |
| `cidco/agent.py` | The WinSCP-style transfer window |
| `cidco/sender.py` | The SFTP upload itself, and the CSV columns |
| `cidco/schedule.py` | The thirteen scheduler intervals |
| `cidco/config.py` | Where the installer's choices are saved |
| `sample/readings.csv` | A CSV with the exact columns CIDCO reads |
| `tests/test_core.py` | Headless tests for all of the above |

## Building the .exe

On a Windows machine with Python 3.10 or newer on `PATH`:

```bat
build.bat
```

That produces `dist\CIDCO_Setup.exe` and `dist\CIDCO_Agent.exe`. Hand
`CIDCO_Setup.exe` to the architect — nothing else needs to be installed on their
PC. If you'd rather not build anything, `CIDCO_Setup.bat` runs the same wizard
from source.

## 1. Installing

Double-click `CIDCO_Setup.exe`. A small dialog walks through four steps.

**Step 1 — Log in as.** Architect or Administrator. Administrator is a dead end
on purpose: CIDCO's side is the web portal, not this program, so the wizard says
so and closes. Everyone installing this picks **Architect**.

**Step 2 — CSV folder.** The folder the AQI export is written to, e.g.
`C:\CIDCO\exports`. Browse or type it; the wizard checks it exists before
letting you continue. The agent always sends the **newest** `.csv` (or `.xlsx`)
in that folder, so an export that overwrites the same file each time is fine.

**Step 3 — Schedule.** How often to send:

> every 5 seconds · 15 seconds · 30 seconds · 1 minute · 5 minutes · 10 minutes ·
> 15 minutes · 20 minutes · 30 minutes · 45 minutes · 1 hour · 2 hours · 3 hours

**Step 4 — Install.** The choices are written to
`%LOCALAPPDATA%\CIDCO-AQI-Agent\settings.json` and the wizard finishes.

## 2. Sending

Open the agent (`CIDCO_Agent.exe` or `run_agent.bat`). It looks like WinSCP:
local files on the left, what has gone to CIDCO on the right, and a transfer log
underneath.

Fill in the connection bar with what CIDCO emailed:

| Field | Value |
| --- | --- |
| Designated IP | CIDCO's server address — the one in the email |
| Port | `2222` |
| User ID | `cidco@example.com` |
| Password | `123456` |
| Company ID | `ABCD123` |
| File path | prefilled from the installer, e.g. `C:\CIDCO\exports` |

Press **Connect**. Then either **Send now** for a one-off, pick a file and use
**Send selected →**, or press **Start automatic sending** to run on the schedule
chosen at install. Every transfer is written to the log with CIDCO's own answer,
so a rejection tells you which field CIDCO disagreed with.

The password is kept only for the running session. It is never written to
`settings.json` — check `tests/test_core.py` if you want to see that asserted.

## 3. What CIDCO does with it

CIDCO revalidates **every single transfer**, not just the first one, against the
master row an officer created before any credentials were sent:

- the **company id** from the upload path,
- the **source IP** the connection actually came from,
- the **file path** the agent declared.

All three have to match. If they don't, the file is recorded as `REJECTED` with
the reason, and not one reading is stored. The transfer still shows up in
CIDCO's dashboard, so a misconfigured agent is visible rather than silent.

Accepted files land in the data table under
`<companyId>/<Month>/<timestamp>/<file>.csv`, e.g.
`ABCD123/2026-09-September/2026-09-18_Friday_06-55-58/readings.csv`.

## The CSV

Row 1 is the header. These are the columns CIDCO reads, in order — see
`sample/readings.csv`:

```
Project / Site ID, AQI Monitoring Station / Device ID, OEM / Model,
Date & Time of Reading, AQI Value, PM2.5, PM10, NO₂, SO₂, CO, O₃,
Temperature, Humidity, Other applicable environmental parameters,
Data Source / Integration Method, Data Receipt Timestamp
```

An existing sheet does not have to be renamed: CIDCO also accepts the everyday
spellings (`PM 2.5`, `NO2`, `O3`, `AQI`, `Timestamp`, `Station ID`, …), and
ignores columns it doesn't know.

## Tests

```bat
python -m unittest discover -s tests -v
```

Twenty tests covering the schedule table, the saved settings (including that the
password stays out of the file), the upload path CIDCO parses the company id
from, and picking the newest export. The two tkinter windows need a desktop and
so aren't tested here — every decision they make lives in the modules above.
