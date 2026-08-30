$ErrorActionPreference = "Stop"

$ffmpeg = if ($env:CSPOT_FFMPEG_PATH) { $env:CSPOT_FFMPEG_PATH } else { "ffmpeg.exe" }
Write-Host "DirectShow capture devices reported by FFmpeg:`n"
& $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 |
    Select-String '".*" \(audio\)' |
    ForEach-Object { $_.Line }

Write-Host "`nCopy physical-input names into appsettings.Production.json."
Write-Host "For PC playback, use Backend 'wasapi-loopback' and Device 'default',"
Write-Host "or copy an active output endpoint's exact friendly name from Windows Sound settings."
