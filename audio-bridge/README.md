# CSpot Audio Bridge

CSpot Audio Bridge exposes several physical audio inputs as independent HTTP
MP3 streams. Capture starts when the first consumer connects, is shared by
simultaneous livestream and recording consumers, and stops after the configured
idle timeout. It runs natively on Windows with DirectShow and supports ALSA for
a later Raspberry Pi deployment.

## Windows setup

Install the .NET 8 runtime and FFmpeg, then open PowerShell in the repository:

```powershell
winget install Microsoft.DotNet.SDK.8
winget install Gyan.FFmpeg
Set-ExecutionPolicy -Scope Process Bypass
.\audio-bridge\list-windows-devices.ps1
```

Copy the exact DirectShow names into `audio-bridge/appsettings.json`. Give each
source a stable ID such as `room-mic` or `desk`. Then open PowerShell as
Administrator and install it for the current Windows user:

```powershell
.\audio-bridge\install-windows.ps1
notepad "$env:LOCALAPPDATA\CSpotAudioBridge\appsettings.Production.json"
Start-ScheduledTask -TaskName "CSpot Audio Bridge"
```

The installer creates a random access token in the installed production
configuration and limits the Windows firewall rule to private networks.

The scheduled task runs at user logon. This is intentional: Windows audio
capture devices are tied to an interactive user session and are less reliable
from a service running as `SYSTEM`.

Test locally:

```powershell
curl.exe http://localhost:8091/health
ffplay "http://localhost:8091/audio/room-mic.mp3?token=YOUR_TOKEN"
ffplay "http://localhost:8091/audio/desk.mp3?token=YOUR_TOKEN"
ffplay "http://localhost:8091/audio/pc-media.mp3?token=YOUR_TOKEN"
```

Use a private-LAN or tailnet address, never expose the bridge directly to the
public internet. In **CSpot → Broadcast → Settings**, select **Independent audio
stream** and enter one of these URLs:

```text
http://CHURCH-DESKTOP:8091/audio/room-mic.mp3?token=YOUR_TOKEN
http://CHURCH-DESKTOP:8091/audio/desk.mp3?token=YOUR_TOKEN
http://CHURCH-DESKTOP:8091/audio/pc-media.mp3?token=YOUR_TOKEN
```

For direct church-PC playback, enable Windows **Stereo Mix** (sometimes named
**What U Hear**) in Sound settings, use its exact DirectShow device name for a
`pc-media` bridge source, and mark that source as **Church PC media** in CSpot.
During a service, choose that source in the viewer's **Audio** control when the
desk is off. Selecting it directly replaces the desk feed rather than mixing
the two, avoiding doubled or echoed media. Switch back to the desk explicitly
when it is available again. If the PC's audio driver does not expose a loopback
device, install a virtual audio cable and configure its recording endpoint as
the bridge device.

For a musicians' pre-service rehearsal, the livestream operator can also set
**PC line-out** to **Muted during rehearsal**. This mutes pre-service playback
only on the church presentation output, so it does not enter the desk or room
speakers; remote viewers continue receiving pre-service audio. Restore the
line-out before it is needed in the room. For arbitrary desktop apps whose
audio must be streamed while the physical line-out remains silent, use a
virtual audio cable: send the app to the cable, capture the cable in the bridge,
and do not monitor it to the physical output.

The hostname must be reachable from the CSpot API host. The URL is relayed by
CSpot, so browsers do not need direct access to the Windows machine.

## Source options

- `Backend`: `dshow` on Windows or `alsa` on Linux/Raspberry Pi OS.
- `Device`: exact DirectShow device name, or an ALSA identifier such as
  `plughw:CARD=Device,DEV=0`.
- `Channels`: capture channels. Output is currently downmixed to mono.
- `BitrateKbps`: 64 is suitable for speech; 96 is useful for a music-heavy desk
  feed.
- `GainDb`: digital trim after capture. Prefer setting proper analogue gain at
  the desk/interface and use this only for small corrections.

Do not connect a desk line output to a microphone-only socket. Use a USB audio
interface with a genuine line input, start with the desk send low, and check for
clipping and ground-loop hum.

## Raspberry Pi later

Publish for a 64-bit Pi with:

```bash
dotnet publish audio-bridge/CSpot.AudioBridge.csproj -c Release \
  -r linux-arm64 --self-contained true -o cspot-audio-bridge-pi
```

Change each source to `Backend: "alsa"`, configure its ALSA device, and run the
binary under systemd with membership in the `audio` group. CSpot stream URLs do
not change except for the bridge hostname.
