@echo off
REM  Runs the installer dialog straight from the source, without building an
REM  .exe first. Useful on a machine that already has Python.
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo  Python 3.10 or newer is required. Install it from python.org, then run this again.
    pause
    exit /b 1
)

python -m pip install --disable-pip-version-check -q -r requirements.txt
python setup_main.py
endlocal
