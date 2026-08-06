$ErrorActionPreference = "Stop"

$ffmpeg = if ($env:CSPOT_FFMPEG_PATH) { $env:CSPOT_FFMPEG_PATH } else { "ffmpeg.exe" }
Write-Host "DirectShow audio devices reported by FFmpeg:`n"
& $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 |
    Select-String '".*" \(audio\)' |
    ForEach-Object { $_.Line }

Write-Host "`nCopy the exact device names into appsettings.Production.json."
