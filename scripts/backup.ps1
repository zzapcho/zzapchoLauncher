param(
    [string]$BackupName = "scheduled"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupRoot = Join-Path $ProjectRoot "Backups"
$SafeName = ($BackupName -replace '[^a-zA-Z0-9_-]', '_').Trim('_')
if ([string]::IsNullOrWhiteSpace($SafeName)) { $SafeName = "backup" }

$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$ArchiveName = "${Timestamp}_${SafeName}.zip"
$ArchivePath = Join-Path $BackupRoot $ArchiveName
$StagingRoot = Join-Path $env:TEMP "zzapchoLauncher-backup-$([guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
New-Item -ItemType Directory -Force -Path $StagingRoot | Out-Null

try {
    $ExcludedDirectories = @(".git", "node_modules", "dist", "target", "Backups")
    function Copy-ProjectTree([string]$Source, [string]$Destination) {
        Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
            if ($_.PSIsContainer) {
                if ($_.Name -notin $ExcludedDirectories) {
                    $ChildDestination = Join-Path $Destination $_.Name
                    New-Item -ItemType Directory -Force -Path $ChildDestination | Out-Null
                    Copy-ProjectTree -Source $_.FullName -Destination $ChildDestination
                }
            }
            else {
                Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Force
            }
        }
    }
    Copy-ProjectTree -Source $ProjectRoot -Destination $StagingRoot

    Compress-Archive -Path (Join-Path $StagingRoot "*") -DestinationPath $ArchivePath -CompressionLevel Optimal
    Write-Output "Backup created: $ArchivePath"
}
finally {
    if (Test-Path -LiteralPath $StagingRoot) {
        Remove-Item -LiteralPath $StagingRoot -Recurse -Force
    }
}
