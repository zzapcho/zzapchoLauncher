param(
    [string]$Version = "",
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectRoot "src-tauri\tauri.conf.json"
$CargoPath = Join-Path $ProjectRoot "src-tauri\Cargo.toml"
$KeyPath = Join-Path $HOME ".tauri\zzapchoLauncher-updater.key"
$Repository = "zzapcho/zzapchoLauncher"

Set-Location $ProjectRoot
$env:PATH = "$(Join-Path $HOME '.cargo\bin');$env:PATH"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Program $($Arguments -join ' ')"
    }
}

function Get-Tool([string]$Name, [string]$Fallback = "") {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    if ($Fallback -and (Test-Path -LiteralPath $Fallback)) { return $Fallback }
    throw "$Name is not installed or is not available in PATH."
}

function Get-NextPatchVersion([string]$CurrentVersion) {
    $parsed = [version]$CurrentVersion
    return "$($parsed.Major).$($parsed.Minor).$($parsed.Build + 1)"
}

function Set-TextVersion([string]$Path, [string]$Pattern, [string]$Replacement) {
    $content = [IO.File]::ReadAllText($Path)
    $updated = [Text.RegularExpressions.Regex]::Replace($content, $Pattern, $Replacement, 1)
    if ($updated -eq $content) { throw "Could not update version in $Path" }
    [IO.File]::WriteAllText($Path, $updated, [Text.UTF8Encoding]::new($false))
}

Write-Step "Checking release tools"
$Git = Get-Tool "git"
$Npm = Get-Tool "npm.cmd"
$Cargo = Get-Tool "cargo"
$Gh = Get-Tool "gh" "C:\Program Files\GitHub CLI\gh.exe"

if (!(Test-Path -LiteralPath $KeyPath)) {
    throw "Updater signing key is missing: $KeyPath"
}

Invoke-Checked $Gh @("auth", "status", "--hostname", "github.com")
$Branch = (& $Git branch --show-current).Trim()
if (!$Branch) { throw "A named Git branch must be checked out." }

$status = & $Git status --porcelain
if ($status) { Write-Host "Local changes will be included in this release." -ForegroundColor Yellow }

if (!$ValidateOnly) {
    Write-Step "Synchronizing with GitHub"
    Invoke-Checked $Git @("pull", "--rebase", "--autostash", "origin", $Branch)
}

$currentVersion = (Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json).version
if (!$Version) {
    $Version = Get-NextPatchVersion $currentVersion
}
if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
    throw "Invalid semantic version: $Version"
}

Write-Host "Repository : $Repository"
Write-Host "Branch     : $Branch"
Write-Host "Current    : $currentVersion"
Write-Host "Release    : $Version"
Write-Host "Signing key: $KeyPath"

if ($ValidateOnly) {
    Write-Host "`nValidation passed. No files, commits, builds, or releases were created." -ForegroundColor Green
    exit 0
}

Write-Step "Updating version to $Version"
Invoke-Checked $Npm @("version", $Version, "--no-git-tag-version")
Set-TextVersion $ConfigPath '("version"\s*:\s*")[^"]+("\s*,)' "`${1}$Version`${2}"
Set-TextVersion $CargoPath '(?m)^(version\s*=\s*")[^"]+("\s*)$' "`${1}$Version`${2}"
$SectionPath = Join-Path $ProjectRoot "src\components\SectionPanel.tsx"
if (Test-Path -LiteralPath $SectionPath) {
    $section = [IO.File]::ReadAllText($SectionPath)
    $section = [Text.RegularExpressions.Regex]::Replace($section, 'zzapcho Launcher \d+\.\d+\.\d+', "zzapcho Launcher $Version")
    [IO.File]::WriteAllText($SectionPath, $section, [Text.UTF8Encoding]::new($false))
}

Write-Step "Installing dependencies and running checks"
Invoke-Checked $Npm @("ci")
Invoke-Checked $Npm @("run", "build")
Invoke-Checked $Cargo @("fmt", "--manifest-path", "src-tauri\Cargo.toml", "--", "--check")
Invoke-Checked $Cargo @("check", "--manifest-path", "src-tauri\Cargo.toml")

Write-Step "Creating source backup"
Invoke-Checked "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\backup.ps1", "-BackupName", "release-v$Version")

Write-Step "Building signed Windows installers"
$env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($KeyPath)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
try {
    Invoke-Checked $Npm @("run", "tauri:build")
}
finally {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$BundleRoot = Join-Path $ProjectRoot "src-tauri\target\release\bundle"
$Nsis = Get-ChildItem -LiteralPath (Join-Path $BundleRoot "nsis") -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
$Msi = Get-ChildItem -LiteralPath (Join-Path $BundleRoot "msi") -Filter "*_${Version}_x64_*.msi" | Select-Object -First 1
if (!$Nsis) { throw "NSIS installer was not created for v$Version." }
if (!$Msi) { throw "MSI installer was not created for v$Version." }

$SignaturePath = "$($Nsis.FullName).sig"
if (!(Test-Path -LiteralPath $SignaturePath)) {
    Write-Step "Signing updater installer"
    Invoke-Checked $Npm @("exec", "tauri", "signer", "sign", "--", "-f", $KeyPath, "--password=", $Nsis.FullName)
}
if (!(Test-Path -LiteralPath $SignaturePath)) { throw "Updater signature was not created." }

$ReleaseInstaller = Join-Path $BundleRoot "zzapchoLauncher_${Version}_x64-setup.exe"
$ReleaseSignature = "$ReleaseInstaller.sig"
$ReleaseMsi = Join-Path $BundleRoot "zzapchoLauncher_${Version}_x64_en-US.msi"
Copy-Item -LiteralPath $Nsis.FullName -Destination $ReleaseInstaller -Force
Copy-Item -LiteralPath $SignaturePath -Destination $ReleaseSignature -Force
Copy-Item -LiteralPath $Msi.FullName -Destination $ReleaseMsi -Force

$Tag = "v$Version"
$InstallerUrl = "https://github.com/$Repository/releases/download/$Tag/$(Split-Path -Leaf $ReleaseInstaller)"
$ManifestPath = Join-Path $BundleRoot "latest.json"
$Manifest = [ordered]@{
    version = $Version
    notes = "zzapcho Launcher $Tag"
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = [IO.File]::ReadAllText($ReleaseSignature)
            url = $InstallerUrl
        }
    }
}
[IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

Write-Step "Committing and pushing release version"
Invoke-Checked $Git @("add", "--all")
Invoke-Checked $Git @("commit", "-m", "Release v$Version")
Invoke-Checked $Git @("push", "origin", $Branch)

Write-Step "Publishing GitHub Release $Tag"
& $Gh release view $Tag --repo $Repository *> $null
if ($LASTEXITCODE -eq 0) {
    Invoke-Checked $Gh @("release", "upload", $Tag, "--repo", $Repository, "--clobber", $ReleaseInstaller, $ReleaseSignature, $ReleaseMsi, $ManifestPath)
    Invoke-Checked $Gh @("release", "edit", $Tag, "--repo", $Repository, "--target", $Branch, "--title", "zzapcho Launcher $Tag", "--notes", "Windows installer and signed automatic update package.")
}
else {
    Invoke-Checked $Gh @("release", "create", $Tag, "--repo", $Repository, "--target", $Branch, "--title", "zzapcho Launcher $Tag", "--notes", "Windows installer and signed automatic update package.", $ReleaseInstaller, $ReleaseSignature, $ReleaseMsi, $ManifestPath)
}

Write-Step "Verifying published update manifest"
$PublishedManifest = Invoke-RestMethod "https://github.com/$Repository/releases/latest/download/latest.json"
if ($PublishedManifest.version -ne $Version -or !$PublishedManifest.platforms.'windows-x86_64'.signature) {
    throw "Published latest.json verification failed."
}

Write-Host "`nRelease completed: https://github.com/$Repository/releases/tag/$Tag" -ForegroundColor Green
Write-Host "Installer: $InstallerUrl" -ForegroundColor Green
