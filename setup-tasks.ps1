# Market Alert Agent -- Windows Task Scheduler Setup
# Run this script ONCE to install all scheduled tasks.

$NodePath  = (Get-Command node).Source
$AgentDir  = "D:\Claude Code\market-agent"

Write-Host "Setting up Market Alert Agent tasks..." -ForegroundColor Cyan

# 1. Morning Briefing at 7:30 AM daily
$briefingAction = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "src\morning-briefing.js" `
    -WorkingDirectory $AgentDir

$briefingTrigger = New-ScheduledTaskTrigger -Daily -At "07:30AM"

$briefingSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName  "MarketAgent_MorningBriefing" `
    -Action    $briefingAction `
    -Trigger   $briefingTrigger `
    -Settings  $briefingSettings `
    -RunLevel  Limited `
    -Force | Out-Null

Write-Host "[OK] Morning Briefing  -> Every day at 7:30 AM IST" -ForegroundColor Green

# 2. Price Alert Monitor every 3 min, Mon-Fri 9:00-15:35
$monitorAction = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "src\monitor.js" `
    -WorkingDirectory $AgentDir

$monitorTrigger = New-ScheduledTaskTrigger `
    -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday `
    -At "09:00AM"

$monitorTrigger.Repetition.Interval         = "PT3M"
$monitorTrigger.Repetition.Duration         = "PT6H35M"
$monitorTrigger.Repetition.StopAtDurationEnd = $true

$monitorSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName  "MarketAgent_PriceMonitor" `
    -Action    $monitorAction `
    -Trigger   $monitorTrigger `
    -Settings  $monitorSettings `
    -RunLevel  Limited `
    -Force | Out-Null

Write-Host "[OK] Price Monitor     -> Every 3 min, Mon-Fri 9:00-15:35 IST" -ForegroundColor Green

# 3. Daily Alert Reset at 9:00 AM (re-arms triggered alerts)
$resetAction = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "src\monitor.js --reset" `
    -WorkingDirectory $AgentDir

$resetTrigger = New-ScheduledTaskTrigger `
    -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday `
    -At "09:00AM"

Register-ScheduledTask `
    -TaskName  "MarketAgent_DailyReset" `
    -Action    $resetAction `
    -Trigger   $resetTrigger `
    -Settings  (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1)) `
    -RunLevel  Limited `
    -Force | Out-Null

Write-Host "[OK] Daily Reset       -> Mon-Fri at 9:00 AM IST (re-arms alerts)" -ForegroundColor Green
Write-Host ""
Write-Host "All tasks registered! Check Task Scheduler for MarketAgent_* entries." -ForegroundColor Cyan
Write-Host "ACTION NEEDED: Add your CallMeBot API key to config\settings.json" -ForegroundColor Yellow
