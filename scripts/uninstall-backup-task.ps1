$TaskName = "zzapchoLauncher Periodic Backup"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Output "Scheduled task removed: $TaskName"
