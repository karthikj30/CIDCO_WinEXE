@echo off
REM ---------------------------------------------------------------------------
REM  Builds the two Windows executables:
REM
REM     dist\CIDCO_Setup.exe   the installer dialog
REM     dist\CIDCO_Agent.exe   the transfer window the architect runs every day
REM
REM  Run this on Windows with Python 3.10+ on PATH. It is only needed to
REM  produce the .exe files; day to day the architect just runs CIDCO_Setup.exe.
REM ---------------------------------------------------------------------------
setlocal

echo.
echo  CIDCO AQI agent - build
echo  =======================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo  Python was not found on PATH. Install Python 3.10 or newer first.
    exit /b 1
)

echo  [1/3] Installing build dependencies...
python -m pip install --disable-pip-version-check -q -r requirements-build.txt
if errorlevel 1 (
    echo  Could not install the build dependencies.
    exit /b 1
)

echo  [2/3] Building CIDCO_Setup.exe...
python -m PyInstaller --noconfirm --clean --onefile --windowed ^
    --name CIDCO_Setup ^
    --hidden-import paramiko ^
    setup_main.py
if errorlevel 1 exit /b 1

echo  [3/3] Building CIDCO_Agent.exe...
python -m PyInstaller --noconfirm --clean --onefile --windowed ^
    --name CIDCO_Agent ^
    --hidden-import paramiko ^
    agent_main.py
if errorlevel 1 exit /b 1

echo.
echo  Done. The executables are in the dist folder:
echo      dist\CIDCO_Setup.exe
echo      dist\CIDCO_Agent.exe
echo.
endlocal
