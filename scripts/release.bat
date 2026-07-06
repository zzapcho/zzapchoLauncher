@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

title zzapcho Launcher - GitHub Release
echo.
echo  zzapcho Launcher GitHub release
echo  --------------------------------
echo.

set "LOCAL_VERSION=unknown"
for /f "usebackq delims=" %%V in (`powershell.exe -NoProfile -Command "try { (Get-Content -Raw 'src-tauri\tauri.conf.json' | ConvertFrom-Json).version } catch { 'unknown' }"`) do set "LOCAL_VERSION=%%V"

set "LATEST_VERSION=unavailable"
for /f "usebackq delims=" %%V in (`powershell.exe -NoProfile -Command "try { (Invoke-RestMethod -Headers @{'User-Agent'='zzapchoLauncher-release-script'} -Uri 'https://api.github.com/repos/zzapcho/zzapchoLauncher/releases/latest' -TimeoutSec 8 -ErrorAction Stop).tag_name } catch { 'unavailable' }"`) do set "LATEST_VERSION=%%V"

echo  Current project version : v%LOCAL_VERSION%
echo  Latest GitHub release   : %LATEST_VERSION%
echo.

set "RELEASE_ARGS=%*"
if "%~1"=="" (
  set /p "RELEASE_VERSION=Version number without v (example: 0.4.0, blank = automatic): "
  if /i "!RELEASE_VERSION:~0,1!"=="v" set "RELEASE_VERSION=!RELEASE_VERSION:~1!"
  if defined RELEASE_VERSION set "RELEASE_ARGS=-Version !RELEASE_VERSION!"
  echo.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-release.ps1" %RELEASE_ARGS%
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo  Release failed. Check the message above.
) else (
  echo  Release completed successfully.
)
echo.
if not defined ZZAPCHO_NO_PAUSE pause
exit /b %EXIT_CODE%
