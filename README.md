# CIDCO AQI Agent — architect side (Windows)

The Windows program an architect installs once and then leaves running. It picks
up the AQI export from a folder on their own machine and sends it to CIDCO over
**SFTP** on a schedule. There is no API key and no web login here — this is the
SFTP channel only.

The architect never sees CIDCO's database. The agent's only job is to hand the
file over and show them what CIDCO answered.

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
                                                         └ 2026-09-18_Friday_07-25-06
                                                           └ readings.csv
```

Built with **C# on .NET 8**, WinForms for the two screens, **SQLite** for the
agent's own settings and history, and SSH.NET for the transfer.

## Download it

The built executable is committed, so there is nothing to build first:

```
dist\CIDCO_AQI_Agent.exe
```

Download that one file and run it. To rebuild it yourself, see **Building** below.

## One file, one install

`build.bat` produces a single **self-contained** executable at that same path.

Self-contained means the .NET runtime is inside it — the architect's PC needs
nothing installed first. That one file is both the installer and the program:

- **Run it the first time** → the setup wizard, which installs it properly:
  copies itself to `%LOCALAPPDATA%\Programs\CIDCO AQI Agent`, makes Start Menu
  and desktop shortcuts, and registers in **Apps & features** so it uninstalls
  like any other Windows program.
- **Run it afterwards** (Start Menu, desktop, or at sign-in) → the transfer
  window.

Everything is written under the user's own profile, so **no administrator prompt**
— an architect on a locked-down site PC can still install it.

| Flag | What it does |
| --- | --- |
| *(none)* | Setup on first run, the agent afterwards |
| `--setup` | Re-runs the wizard to change the folder or the schedule |
| `--uninstall` | What Apps & features calls; removes shortcuts, the sign-in entry and the listing |

## Building

On a Windows machine with the [.NET 8 SDK](https://dot.net) or newer:

```bat
build.bat
```

It restores, runs the tests, refuses to build if any fail, and publishes to
`dist\`. The result is around 72 MB, which is the cost of carrying the runtime
so that nothing has to be installed alongside it.

## 1. Installing

Double-click `CIDCO_AQI_Agent.exe`. A small dialog walks through four steps.

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

**Step 4 — Install.** Review the summary, tick whether you want a desktop
shortcut and whether it should start when you sign in to Windows, then install.

## 2. Sending

The agent looks like WinSCP: local files on the left, what has gone to CIDCO on
the right, and a transfer log underneath.

Fill in the connection bar with what CIDCO emailed:

| Field | Value |
| --- | --- |
| Designated IP | CIDCO's server address — the one in the email, e.g. `13.207.123.12`, or `http://13.207.123.12:8010` to use their web portal |
| User ID | `cidco@example.com` |
| Password | `123456` |
| Company ID | `ABCD123` |
| File path | prefilled from the installer, e.g. `C:\CIDCO\exports` |
| Private key | Leave blank for CIDCO. Needed for a server that will not take a password — see below |

There is no port to fill in. CIDCO's intake is on port 2222, and that is the
only port the agent will try on a guess — deliberately. Port 22 is the operating
system's own SSH service on most servers, and presenting CIDCO credentials there
proves nothing while being exactly what fail2ban bans; the ban would land on the
architect's address and lock them out of the real intake on the same host.

If CIDCO ever does put an instance somewhere non-standard, type it after a
colon and the agent takes you at your word and tries only that:

```
13.207.123.12:8010
```

Press **Connect**. Then either **Send now** for a one-off, pick a file and use
**Send selected →** (or double-click it), or press **Start automatic sending** to
run on the schedule chosen at install.

Every transfer is written to the log **and to the agent's own database**, with
CIDCO's own answer. A rejection names the field CIDCO disagreed with, so a
misconfigured agent is visible rather than silent — and because the history is
in SQLite, last night's failures are still on screen this morning.

The password is kept only for the running session. It is never written to the
database — `DatabaseLifecycleTests` reads the raw file back to prove it.

## Two ways to reach CIDCO

The same file, the same credentials and the same checks — two different doors,
and the address says which:

| What you type | Where it goes |
| --- | --- |
| `13.207.123.12` | CIDCO's **SFTP intake**, port 2222 |
| `13.207.123.12:8010` | The SFTP intake on a port CIDCO named |
| `http://13.207.123.12:8010` | CIDCO's **web portal**, over HTTP |
| `https://cidco.example.gov.in` | The portal over HTTPS |
| `13.207.123.12:22/home/ubuntu/uploads` | An **ordinary SFTP server** — the file goes straight into that folder |

The portal door exists because its port is very often the one already open. The
SFTP intake is a separate service on its own port, and a firewall that lets the
portal through frequently does not let the intake through. Rather than leave an
architect unable to send anything, the agent can hand the same file to the same
intake over HTTP — CIDCO validates it identically and files it in the same
place, recording only that it arrived by the portal rather than by SFTP.

The choice is always written, never guessed. An agent that silently changed
protocol because something unexpected answered would be impossible to reason
about the first time it surprised somebody. The status line says which door is
in use: *Connected · ABCD123 → 13.207.123.12:8010 (web portal)*.

### Signing in with a key instead of a password

Most cloud servers will not take a password at all. An AWS image ships with
`PasswordAuthentication no` and its default account (`ubuntu`, `ec2-user`) has
no password set, so **no password is the right password** — and from the agent
that looks exactly like bad credentials.

Put the key file in the **Private key** box, or pick it with **Browse**. PuTTY's
`.ppk` and OpenSSH's `.pem` both work, in either format version, and the Password
box is then the key's passphrase if it has one — leave it empty if it does not.
Only the path is remembered; the key stays where it is and the passphrase is
never written down.

### Testing against your own server

Name a folder in the address and the agent behaves like any other SFTP client:
it signs in with **that server's own login** — not CIDCO's — and writes the file
straight into the folder, with none of CIDCO's `/<companyId>/<path>/` layout.

```
13.207.123.12:22/home/ubuntu/uploads
```

That is how you prove a file really moves before CIDCO's side exists. It is
emphatically **not** a compliance submission: no company is checked, no address,
no file path, and nothing is filed against a registration. Every line says so —
the status line reads *(plain SFTP — not CIDCO)* and each send ends *"plain
SFTP, so CIDCO has not validated or stored anything."* A green line that looked
like a real submission would be worse than a red one.

## Staying connected

The agent is meant to be left running for months on a site PC, so it does not
treat "connected" as something switched on once. A three-hourly schedule will
meet a rebooted server, a dropped link and a changed address, and nobody will be
watching to press **Connect** afterwards.

What it does depends on what actually failed:

| What happened | What the agent does |
| --- | --- |
| Lost the network, or CIDCO is down | Keeps trying, backing off 5s → 15s → 45s → 2m → 5m → 15m, and resumes the moment CIDCO answers |
| CIDCO rejected the password | Stops and says so. Retrying cannot fix a password, and hammering their server with a rejected credential is rude |
| CIDCO refused the transfer | Stops and says which field they disagreed with. The link is fine; the registration does not match |
| No CSV in the folder yet | Nothing. Not a failure — the next tick looks again |

While the link is down the agent retries on the **backoff**, not the schedule,
so a three-hourly sender notices CIDCO is back in seconds rather than hours. The
status line says which of those it is in — *Connected*, *Lost CIDCO —
reconnecting (attempt 2, next in 15s)*, or *Needs attention* — and an outage is
logged once rather than once per attempt.

Nothing is lost while CIDCO is away: the agent sends the newest export when it
gets back in, and every attempt, successful or not, is in the local history.

## 3. What CIDCO does with it

CIDCO revalidates **every single transfer**, not just the first one, against the
master row an officer created before any credentials were sent:

- the **company id** from the upload path,
- the **source IP** the connection actually came from,
- the **file path** the agent declared.

All three have to match. If they don't, the upload itself fails — the agent says
so — and CIDCO records it as `REJECTED` with the reason, with not one reading
stored.

Accepted files land in the data table under
`<companyId>/<Month>/<timestamp>/<file>.csv`, e.g.
`ABCD123/2026-09-September/2026-09-18_Friday_07-25-06/readings.csv`.

## The CSV

Row 1 is the header. These are the columns CIDCO reads, in order — see
`sample/readings.csv`:

```
Project / Site ID, AQI Monitoring Station / Device ID, OEM / Model,
Date & Time of Reading, AQI Value, PM2.5, PM10, NO₂, SO₂, CO, O₃,
Temperature, Humidity, Other applicable environmental parameters,
Data Source / Integration Method, Data Receipt Timestamp
```

An existing sheet does not have to be renamed: CIDCO matches headers on their
letters and digits alone, so `PM 2.5`, `NO2`, `O3` and `Station/Device ID` all
land on the right field, and columns it doesn't know are ignored.

## What's in the repo

```
src/Cidco.Core/        the logic, with no window attached — and all of the tests
  Schedule.cs            the thirteen intervals
  Database.cs            SQLite: settings, and the transfer history
  Settings.cs            what the installer chose, and what the agent remembers
  SetupFlow.cs           which wizard step comes next, and the folder check
  CidcoSender.cs         the SFTP transfer itself
  RemotePath.cs          /<companyId>/<folder>/<file>.csv, mirroring the server
  ExportPicker.cs        finding the newest export
  AqiCsv.cs              the columns CIDCO reads
src/Cidco.Agent/       the two WinForms screens, and the install itself
  SetupWizard.cs         the four-step dialog
  AgentWindow.cs         the WinSCP-style transfer window
  Installer.cs           copying itself into place
  Program.cs             which face to show, and --uninstall
src/Shared/            small files both the wizard and the agent use
tests/Cidco.Core.Tests/
sample/readings.csv
build.bat
```

The split is deliberate: **everything that makes a decision lives in
`Cidco.Core`**, which is plain .NET with no UI, so it can all be tested. The
WinForms files only draw.

## The agent's database

SQLite, at `%LOCALAPPDATA%\CIDCO-AQI-Agent\agent.db`:

| Table | What it holds |
| --- | --- |
| `settings` | The export folder, the schedule, the designated IP, the company id — never the password |
| `transfers` | Every attempt: file, remote path, size, accepted or refused, CIDCO's message, when |

This is the architect's own record, on their own PC. It is not CIDCO's database
and has no connection to it.

## Tests

```bat
dotnet test
```

84 tests over the schedule table, the database (including that the password
stays out of it), the wizard's step logic, the key exchange algorithms Windows
can actually do, the upload path and picking the newest export.

Seven of them talk to a **real CIDCO server** and skip when there isn't one. To
run those, start the server side and point the tests at it:

```bat
set CIDCO_TEST_HOST=127.0.0.1
dotnet test
```

| Variable | Default |
| --- | --- |
| `CIDCO_TEST_HOST` | *(unset — the live tests skip)* |
| `CIDCO_TEST_PORT` | `2222` |
| `CIDCO_TEST_USER` | `cidco@example.com` |
| `CIDCO_TEST_PASSWORD` | `123456` |
| `CIDCO_TEST_COMPANY` | `ABCD123` |
| `CIDCO_TEST_PATH` | `C:/CIDCO/exports` |

The two WinForms screens need Windows to run, which is why the logic they drive
was pulled out into `Cidco.Core` — the wizard's step order and folder check are
covered by `SetupFlowTests` rather than left to a click-through.

## When it will not connect

The transfer log names the cause. The three you are most likely to meet:

| What the log says | What it means |
| --- | --- |
| **Something is listening on *host:port*, but it is not an SFTP server** | The TCP connection worked, but whatever answered never sent an SSH greeting. Almost always the wrong port — the portal's rather than the SFTP intake's. Leave the port off the address entirely and the agent will look for the intake itself. |
| **Nothing is listening on *host:port*** | The port is closed. Either the SFTP service is not running on CIDCO's side, or a firewall is dropping it. |
| ***host:port* refused that username and password. That server is CIDCO's intake** | The address and port are right — you reached CIDCO. It is the user id or password they do not recognise. |
| ***host:port* refused that username and password, and it is not CIDCO's intake** | You reached a different SSH server, named in the message — usually the machine's own SSH service on port 22, which has never heard of a CIDCO user id, so no password would work. Ask CIDCO which port their intake is on. |

The agent can tell those two apart because every SSH server names itself before
anyone authenticates. CIDCO's intake identifies as `ssh2js`; a machine's own
service identifies as `OpenSSH`. Either way the agent stops rather than
re-presenting a rejected password until the account locks.

The **Result** column in the CIDCO pane says which of these each attempt was:
`Accepted`, `No answer` (could not reach CIDCO), `Refused` (CIDCO turned the
file away), or `Login refused`.

To check a port by hand from the architect's PC, in PowerShell:

```powershell
# Is anything there at all?
Test-NetConnection 13.207.123.12 -Port 2222

# Is it an SSH server? This should print something like "SSH-2.0-..."
$c = New-Object Net.Sockets.TcpClient('13.207.123.12', 2222)
(New-Object IO.StreamReader($c.GetStream())).ReadLine()
$c.Close()
```

If that second command prints nothing, or prints HTML, that port is not the SFTP
intake.

On CIDCO's side the intake is a separate process from the web app:

```bash
npm run sftp            # listens on SFTP_PORT, default 2222
SFTP_PORT=8010 npm run sftp   # or wherever the firewall is open
```

It binds `0.0.0.0`, so the remaining step is opening that port to the architect's
address — on AWS, an inbound rule in the instance's security group.

## A note on key exchange

.NET's cryptography sits on OpenSSL on Linux and on CNG on Windows, and the two
do not offer the same algorithms. SSH.NET prefers Curve25519, which CNG has no
ECDH for, so the agent never offers it — otherwise the handshake dies with *"The
specified curve 'Curve25519' or its parameters are not valid for this platform"*
before a byte of AQI data moves.

That leaves ECDH over the NIST curves, which normal Windows does fine. A machine
whose CNG is cut down — an old build, a locked-down or FIPS-restricted image —
answers those with `NTE_NOT_SUPPORTED` instead, and a failed key exchange is
fatal rather than something SSH renegotiates. So if the first handshake fails for
a reason that looks like missing crypto, the agent tries again with plain
Diffie-Hellman, which every Windows can do. `KeyExchangeTests` pins all of this
down.
