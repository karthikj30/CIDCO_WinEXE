@echo off
REM ---------------------------------------------------------------------------
REM  Builds the CIDCO AQI Agent into a single Windows executable:
REM
REM      dist\CIDCO_AQI_Agent.exe
REM
REM  It is self-contained, so the architect's PC does not need .NET installed.
REM  Run it once and it installs itself; run it afterwards and it is the agent.
REM
REM  Needs the .NET 8 SDK (or newer) on PATH. Download: https://dot.net
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo.
echo  CIDCO AQI Agent - build
echo  =======================
echo.

where dotnet >nul 2>nul
if errorlevel 1 (
    echo  The .NET SDK was not found on PATH.
    echo  Install .NET 8 or newer from https://dot.net and run this again.
    exit /b 1
)

echo  [1/3] Restoring packages...
dotnet restore
if errorlevel 1 exit /b 1

echo.
echo  [2/3] Running the tests...
dotnet test --nologo
if errorlevel 1 (
    echo.
    echo  Tests failed - not building. Fix them first.
    exit /b 1
)

echo.
echo  [3/3] Publishing the executable...
dotnet publish src\Cidco.Agent -c Release -r win-x64 ^
    --self-contained true ^
    -p:PublishSingleFile=true ^
    -p:IncludeNativeLibrariesForSelfExtract=true ^
    -p:EnableCompressionInSingleFile=true ^
    -p:DebugType=none ^
    -o dist
if errorlevel 1 exit /b 1

echo.
echo  Done.
echo.
echo      dist\CIDCO_AQI_Agent.exe
echo.
echo  Hand that one file to the architect. Nothing else needs installing.
echo.
endlocal
