param(
    [string]$InstallDirectory = "$env:LOCALAPPDATA\CSpotAudioBridge",
    [int]$Port = 8091
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$publishDirectory = Join-Path $env:TEMP "cspot-audio-bridge-publish"

if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
    throw "FFmpeg is not available. Install it with 'winget install Gyan.FFmpeg', then open a new PowerShell window."
}

dotnet publish (Join-Path $PSScriptRoot "CSpot.AudioBridge.csproj") `
    -c Release -r win-x64 --self-contained false -o $publishDirectory

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
Copy-Item "$publishDirectory\*" $InstallDirectory -Force -Recurse

$productionConfig = Join-Path $InstallDirectory "appsettings.Production.json"
if (-not (Test-Path $productionConfig)) {
    Copy-Item (Join-Path $PSScriptRoot "appsettings.json") $productionConfig
    $config = Get-Content $productionConfig -Raw | ConvertFrom-Json
    $config.AudioBridge.AccessToken = [Convert]::ToHexString(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    ).ToLowerInvariant()
    $config | ConvertTo-Json -Depth 8 | Set-Content $productionConfig -Encoding UTF8
}

$executable = Join-Path $InstallDirectory "CSpot.AudioBridge.exe"
$action = New-ScheduledTaskAction -Execute $executable -WorkingDirectory $InstallDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "CSpot Audio Bridge" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

try {
    New-NetFirewallRule -DisplayName "CSpot Audio Bridge" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -ErrorAction Stop | Out-Null
} catch {
    Write-Warning "Could not add the private-network firewall rule. Re-run this installer as Administrator."
}

Write-Host "Installed CSpot Audio Bridge in $InstallDirectory"
Write-Host "Edit $productionConfig with the exact device names and a random access token."
Write-Host "Then start it with: Start-ScheduledTask -TaskName 'CSpot Audio Bridge'"
