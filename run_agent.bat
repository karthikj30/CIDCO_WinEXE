@echo off
REM  Opens the CIDCO transfer window (the WinSCP-style screen).
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo  Python 3.10 or newer is required. Install it from python.org, then run this again.
    pause
    exit /b 1
)

python agent_main.py
endlocal
