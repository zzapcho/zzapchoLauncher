@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

title zzapcho Launcher - GitHub Release
echo.
echo  zzapcho Launcher GitHub release
echo  --------------------------------
echo.

set "RELEASE_ARGS=%*"
if "%~1"=="" (
  set /p "RELEASE_VERSION=Version number (blank = automatic): "
  if defined RELEASE_VERSION set "RELEASE_ARGS=-Version %RELEASE_VERSION%"
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
