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
    if (![Text.RegularExpressions.Regex]::IsMatch($content, $Pattern)) {
        throw "Could not find version field in $Path"
    }
    $updated = [Text.RegularExpressions.Regex]::Replace($content, $Pattern, $Replacement, 1)
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

$RollbackPaths = @(
    (Join-Path $ProjectRoot "package.json"),
    (Join-Path $ProjectRoot "package-lock.json"),
    $ConfigPath,
    $CargoPath,
    (Join-Path $ProjectRoot "src-tauri\Cargo.lock"),
    (Join-Path $ProjectRoot "src\components\SectionPanel.tsx")
)
$OriginalFiles = @{}
foreach ($path in $RollbackPaths) {
    if (Test-Path -LiteralPath $path) { $OriginalFiles[$path] = [IO.File]::ReadAllBytes($path) }
}
$VersionCommitted = $false

try {

Write-Step "Updating version to $Version"
Invoke-Checked $Npm @("version", $Version, "--no-git-tag-version", "--allow-same-version")
Set-TextVersion $ConfigPath '("version"\s*:\s*")[^"]+("\s*,)' "`${1}$Version`${2}"
Set-TextVersion $CargoPath '(?m)^(version\s*=\s*")[^"]+("\s*)$' "`${1}$Version`${2}"
$SectionPath = Join-Path $ProjectRoot "src\components\SectionPanel.tsx"
if (Test-Path -LiteralPath $SectionPath) {
    $section = [IO.File]::ReadAllText($SectionPath)
    $section = [Text.RegularExpressions.Regex]::Replace($section, 'zzapcho Launcher \d+\.\d+\.\d+', "zzapcho Launcher $Version")
    [IO.File]::WriteAllText($SectionPath, $section, [Text.UTF8Encoding]::new($false))
}

Write-Step "Installing dependencies and running checks"
Invoke-Checked $Npm @("install")
Invoke-Checked $Npm @("run", "build")
Invoke-Checked $Cargo @("fmt", "--manifest-path", "src-tauri\Cargo.toml", "--", "--check")
Invoke-Checked $Cargo @("check", "--manifest-path", "src-tauri\Cargo.toml")

Write-Step "Creating source backup"
Invoke-Checked "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\backup.ps1", "-BackupName", "release-v$Version")

Write-Step "Building signed Windows installers"
$BuiltExecutable = Join-Path $ProjectRoot "src-tauri\target\release\zzapcho-launcher.exe"
Get-Process -Name "zzapcho-launcher" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $BuiltExecutable } |
    Stop-Process -Force
$BundleRoot = Join-Path $ProjectRoot "src-tauri\target\release\bundle"
if (Test-Path -LiteralPath $BundleRoot) {
    Get-ChildItem -LiteralPath $BundleRoot -Recurse -File |
        Where-Object { $_.Name -like "*${Version}*" -or $_.Name -eq "latest.json" } |
        Remove-Item -Force -ErrorAction Stop
}
$BuildConfigPath = Join-Path $env:TEMP "zzapchoLauncher-release-$([guid]::NewGuid().ToString('N')).json"
[IO.File]::WriteAllText($BuildConfigPath, '{"bundle":{"createUpdaterArtifacts":false}}', [Text.UTF8Encoding]::new($false))
try {
    Invoke-Checked $Npm @("run", "tauri:build", "--", "--config", $BuildConfigPath)
}
finally {
    Remove-Item -LiteralPath $BuildConfigPath -Force -ErrorAction SilentlyContinue
}

$Nsis = Get-ChildItem -LiteralPath (Join-Path $BundleRoot "nsis") -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
$Msi = Get-ChildItem -LiteralPath (Join-Path $BundleRoot "msi") -Filter "*_${Version}_x64_*.msi" | Select-Object -First 1
if (!$Nsis) { throw "NSIS installer was not created for v$Version." }
if (!$Msi) { throw "MSI installer was not created for v$Version." }

$SignaturePath = "$($Nsis.FullName).sig"
Write-Step "Signing updater installer"
$PreviousSigningPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$SigningPassword = $PreviousSigningPassword
if ([string]::IsNullOrEmpty($SigningPassword)) {
    $SecureSigningPassword = Read-Host "Updater signing key password" -AsSecureString
    $SigningCredential = [PSCredential]::new("updater-signing-key", $SecureSigningPassword)
    $SigningPassword = $SigningCredential.GetNetworkCredential().Password
}

try {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $SigningPassword
    Invoke-Checked $Npm @("exec", "tauri", "signer", "sign", "--", "-f", $KeyPath, $Nsis.FullName)
}
finally {
    if ($null -eq $PreviousSigningPassword) {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
    else {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $PreviousSigningPassword
    }
    $SigningPassword = $null
    $SigningCredential = $null
    $SecureSigningPassword = $null
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
$PendingChanges = & $Git status --porcelain
if ($PendingChanges) {
    Invoke-Checked $Git @("add", "--all")
    Invoke-Checked $Git @("commit", "-m", "Release v$Version")
}
else {
    Write-Host "No new files to commit. Continuing the existing v$Version release."
}
$VersionCommitted = $true
Invoke-Checked $Git @("push", "origin", $Branch)

Write-Step "Publishing GitHub Release $Tag"
$releaseExists = $false
try {
    & $Gh release view $Tag --repo $Repository 2>$null | Out-Null
    $releaseExists = $LASTEXITCODE -eq 0
}
catch {
    $releaseExists = $false
}
if ($releaseExists) {
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
}
catch {
    if (!$VersionCommitted) {
        Write-Host "`nRelease failed before commit. Restoring version files..." -ForegroundColor Yellow
        foreach ($path in $OriginalFiles.Keys) {
            [IO.File]::WriteAllBytes($path, $OriginalFiles[$path])
        }
    }
    throw
}
