# How the Windows `.exe` was built (Codespace) and run

This note records the path that produced `dist/CIDCO_AQI_Agent.exe` from a **Linux Codespace**, then how that same binary was launched on Windows.

`build.bat` is the Windows wrapper for the same three steps. On Linux it does not run, so the steps were executed by hand with `dotnet`. Cross-compiling with `-r win-x64` still emits a genuine Windows PE — the same binary `build.bat` would produce.

---

## Prerequisites (Codespace / Linux)

1. Open the repo in a GitHub Codespace (or any Linux environment with the SDK).
2. Install the **.NET 8 SDK** (or newer) if it is not already available:
   - https://dot.net
3. Confirm the toolchain:

```bash
dotnet --version
```

---

## Build steps (same as `build.bat`, run by hand)

From the repository root:

### 1. Restore packages

```bash
dotnet restore
```

### 2. Run the tests

```bash
dotnet test --nologo
```

Do not publish if tests fail. The Codespace run that shipped this binary had **84** tests passing.

### 3. Publish a self-contained Windows executable

```bash
dotnet publish src/Cidco.Agent -c Release -r win-x64 \
  --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:EnableCompressionInSingleFile=true \
  -p:DebugType=none \
  -o dist
```

### Result

```
dist/CIDCO_AQI_Agent.exe
```

- About **72 MB**
- **PE32+** executable (GUI), **x86-64**
- Self-contained (architect PCs do not need .NET installed)

On Windows you can do the same with one command from the repo root:

```bat
build.bat
```

---

## Get the binary onto a Windows PC

Either:

- Clone/pull the repo (the exe is committed under `dist/`), or
- Download `dist/CIDCO_AQI_Agent.exe` from the branch / a Release asset

Optional integrity check (PowerShell):

```powershell
Get-FileHash .\dist\CIDCO_AQI_Agent.exe -Algorithm SHA256
```

---

## Run / install on Windows

1. Double-click `dist\CIDCO_AQI_Agent.exe`.
2. If **SmartScreen** appears (unsigned binary): **More info** → **Run anyway**.
3. **First run** opens the setup wizard (**CIDCO AQI Agent 1.0 Setup**):
   - Log in as → **Architect**
   - Choose the CSV/export folder (e.g. `C:\CIDCO\exports`)
   - Pick the send schedule
   - Install (optional desktop shortcut + start at sign-in)
4. The wizard installs under:

   `%LOCALAPPDATA%\Programs\CIDCO AQI Agent`

   and adds Start Menu / desktop shortcuts and an **Apps & features** entry. No admin prompt.

5. **Later runs** open the transfer agent. Fill the connection bar from CIDCO’s email, **Connect**, then **Send now** or start automatic sending.

### Useful flags

| Flag | Effect |
| --- | --- |
| *(none)* | Setup on first run, agent afterwards |
| `--setup` | Re-run the wizard |
| `--uninstall` | Remove shortcuts, listing, and agent data |

---

## Smoke check done on this Windows machine

After cloning the repo with the shipped exe:

1. Confirmed the file is a valid **PE32+ / AMD64** GUI binary (~72 MB).
2. Launched `dist\CIDCO_AQI_Agent.exe` — process stayed up (no instant crash).
3. Visible window title: **CIDCO AQI Agent 1.0 Setup** (first-run wizard).

Full SFTP connect/send still needs your CIDCO credentials and export folder in the UI.

---

## Notes from the Linux-side verification

- **Wine** was used in the Codespace to exercise the Windows binary before handing it over. That caught WinForms layout and Windows CNG / Curve25519 issues that Linux unit tests alone would miss.
- One uninstall detail Wine cannot fully prove: deleting the program folder at the end of uninstall uses `ping` as a delay, which Wine lacks. Shortcuts, registry entry, and database removal still work.
- A ~72 MB blob in git history grows with every rebuild. Prefer a **GitHub Release** asset if you rebuild often.
