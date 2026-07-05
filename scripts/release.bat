@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0.."

set "VERSION=%~1"

if "%VERSION%"=="" (
  for /f "usebackq delims=" %%V in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$pkg=Get-Content package.json -Raw | ConvertFrom-Json; $parts=$pkg.version.Split('.'); if ($parts.Count -lt 3) { throw 'package.json version must be semver, like 0.3.1' }; '{0}.{1}.{2}' -f $parts[0],$parts[1],([int]$parts[2]+1)"`) do set "VERSION=%%V"
)

if "%VERSION%"=="" (
  echo Failed to resolve release version.
  exit /b 1
)

echo.
echo zzapcho Launcher release helper
echo Version: %VERSION%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$v='%VERSION%'; $files=@('package.json','src-tauri/tauri.conf.json'); foreach($file in $files){ $json=Get-Content $file -Raw | ConvertFrom-Json; $json.version=$v; $json | ConvertTo-Json -Depth 32 | Set-Content $file -Encoding UTF8 }; $section='src/components/SectionPanel.tsx'; if(Test-Path $section){ $text=Get-Content $section -Raw; $text=$text -replace 'zzapcho Launcher [0-9]+\.[0-9]+\.[0-9]+', ('zzapcho Launcher '+$v); Set-Content $section $text -Encoding UTF8 }"

if errorlevel 1 (
  echo Failed to update version files.
  exit /b 1
)

echo Updated package.json, tauri.conf.json, and settings display if present.
echo.

npm install
if errorlevel 1 exit /b 1

npm run tauri:build
if errorlevel 1 exit /b 1

echo.
echo Build complete for v%VERSION%.
echo Bundles are under src-tauri\target\release\bundle
