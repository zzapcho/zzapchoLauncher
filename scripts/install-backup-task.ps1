param(
    [int]$IntervalHours = 6,
    [string]$BackupName = "auto"
)

$ErrorActionPreference = "Stop"
if ($IntervalHours -lt 1) { throw "IntervalHours must be at least 1." }

$BackupScript = Join-Path $PSScriptRoot "backup.ps1"
$TaskName = "zzapchoLauncher Periodic Backup"
$Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$BackupScript`" -BackupName `"$BackupName`""
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Arguments
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Periodic backup for zzapchoLauncher" -Force | Out-Null
Write-Output "Scheduled task installed: $TaskName (every $IntervalHours hour(s))"
