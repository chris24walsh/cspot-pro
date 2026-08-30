# CSpot Audio Bridge

CSpot Audio Bridge exposes physical audio inputs and the Windows playback mix as
independent HTTP MP3 streams. Capture starts when the first consumer connects,
is shared by simultaneous livestream and recording consumers, and stops after
the configured idle timeout. It uses DirectShow for Windows input devices,
WASAPI loopback for a Windows render endpoint, and ALSA for a later Raspberry Pi
deployment.

The bridge is capture-only. It does not play a song, start pre-service music, or
route an application to a Windows device. A `pc-media` source using
`wasapi-loopback` captures whatever Windows is rendering to the configured
output. Set `Device` to `default` for the default multimedia output, or use an
active render endpoint's exact friendly name.

## Windows setup

Install the .NET 8 runtime and FFmpeg, then open PowerShell in the repository:

```powershell
winget install Microsoft.DotNet.SDK.8
winget install Gyan.FFmpeg
Set-ExecutionPolicy -Scope Process Bypass
.\audio-bridge\list-windows-devices.ps1
```

Copy the exact DirectShow names for physical capture inputs into
`audio-bridge/appsettings.json`. Give each source a stable ID such as `room-mic`
or `desk`. The sample `pc-media` source already uses WASAPI loopback on the
default Windows playback output. Then open PowerShell as Administrator and
install it for the current Windows user:

```powershell
.\audio-bridge\install-windows.ps1
notepad "$env:LOCALAPPDATA\CSpotAudioBridge\appsettings.Production.json"
Start-ScheduledTask -TaskName "CSpot Audio Bridge"
```

The installer creates a random access token in the installed production
configuration and limits the Windows firewall rule to private networks.

The installer creates a current-user logon task. This remains the portable
default because some Windows/DirectShow devices are available only, or are more
reliable, in an interactive session. Do not replace it with a `SYSTEM` service
without proving every capture device after a reboot.

### Optional headless boot task

The current church desktop has also been verified with the bridge running before
login. This is an optional, driver-dependent deployment pattern rather than the
installer default. Its tested shape is:

- application files and production configuration under
  `C:\ProgramData\CSpotAudioBridge`
- an **At startup** scheduled-task trigger
- a named local-user principal with **S4U** logon and **Limited** run level
- execution in Session 0, with no interactive user signed in
- 20 automatic restarts at one-minute intervals
- the original logon task disabled to prevent two processes competing for port
  8091

Create or change this task only from an elevated PowerShell session. Restrict
the production configuration, including its access token, to administrators and
the task identity. S4U does not store the user's password and is sufficient here
because the process captures local devices and accepts inbound HTTP connections;
it should not be used if the bridge must access a remote network share.

After configuring it, reboot without signing in and verify all of the following:

```powershell
Get-ScheduledTask -TaskName "CSpot Audio Bridge Headless"
Get-Process -Name "CSpot.AudioBridge" | Select-Object Id, SessionId
curl.exe http://localhost:8091/health
ffplay "http://localhost:8091/audio/room-mic.mp3?token=YOUR_TOKEN"
ffplay "http://localhost:8091/audio/desk.mp3?token=YOUR_TOKEN"
ffplay "http://localhost:8091/audio/pc-media.mp3?token=YOUR_TOKEN"
```

A healthy capture task still does not provide headless program playback. If the
media player normally runs only after desktop login, `pc-media` will carry
silence until that player starts and renders to the selected output. The church
desktop has produced continuous streams from both DirectShow inputs and the
default-output WASAPI loopback in Session 0. Recheck every source after an output
device or driver change, including a short non-silent media test for loopback.

### Remote access before Windows logon

The camera subnet route and remote administration must not depend on the
interactive desktop session. On the church PC, run PowerShell as Administrator
and configure Tailscale for unattended operation while preserving the camera
subnet route:

```powershell
tailscale up --unattended --advertise-routes=192.168.4.0/24
Set-Service sshd -StartupType Automatic
Start-Service sshd
```

After a reboot, verify SSH and both camera feeds before anyone logs into the
desktop. With the default installation, the audio bridge starts at user logon;
with the separately verified headless pattern, include all bridge sources in
the same pre-login check.

Test locally:

```powershell
curl.exe http://localhost:8091/health
ffplay "http://localhost:8091/audio/room-mic.mp3?token=YOUR_TOKEN"
ffplay "http://localhost:8091/audio/desk.mp3?token=YOUR_TOKEN"
ffplay "http://localhost:8091/audio/pc-media.mp3?token=YOUR_TOKEN"
```

Use a private-LAN or tailnet address, never expose the bridge directly to the
public internet. In **CSpot → Broadcast → Livestream**, add the sources with
stable CSpot roles: **Room microphone**, **Sound desk**, and **Church PC media**.
Use one bridge URL for each role:

```text
http://CHURCH-DESKTOP:8091/audio/room-mic.mp3?token=YOUR_TOKEN
http://CHURCH-DESKTOP:8091/audio/desk.mp3?token=YOUR_TOKEN
http://CHURCH-DESKTOP:8091/audio/pc-media.mp3?token=YOUR_TOKEN
```

For direct church-PC playback, configure `pc-media` with backend
`wasapi-loopback` and device `default`. This captures the Windows render mix sent
to the default physical output; Stereo Mix and a virtual-cable producer are not
required. To pin capture to a non-default physical output, put that active
render endpoint's exact friendly name in `Device`. The endpoint is resolved when
the first listener starts the source, so a later Windows default-device change
takes effect after the bridge source next goes idle and restarts.

A virtual cable remains useful when one application's livestream audio must be
independent of the physical line-out. Send that application to the cable's
**playback/render** endpoint and configure `wasapi-loopback` with that render
endpoint's friendly name. Do not configure the cable's DirectShow recording
endpoint for this backend.

The normal room path is PC line-out → sound desk → desk USB return. That desk
return already contains PC playback, while `pc-media` exposes the same program
audio directly. CSpot's five default scenes keep those paths mix-minus:

| Scene | Room | Desk return | PC media |
| --- | --- | --- | --- |
| Pastor | On | On | Off |
| Congregation | On | On | Off |
| Worship | On | On | Off |
| Media | Off | Off | On |
| Pre-service | Off | Off | On |

Media playback can therefore use the direct path without also mixing the delayed
desk return. It also does not depend on an audible signal from the desk. This is
not full endpoint failover: if a configured HTTP source disappears altogether
while FFmpeg is opening or relaying the mix, continuity is not yet guaranteed.
Song backing tracks are the deliberate exception: they remain on CSpot's
Worship scene, with direct `pc-media` excluded, so the complete desk return
carries the track once alongside live musicians and vocals. If those live desk
channels ever need to be combined with the direct PC leg instead, the desk must
provide an aux/matrix mix-minus output that excludes its PC input; software
cannot reliably remove that component from the stereo record-out.

Configured pre-service music is currently a transitional remote-viewer player,
not a bridge input. During a musicians' rehearsal, its presentation-output copy
must remain muted so it does not enter the PC line-out, desk, or room speakers;
remote viewers continue rendering the track directly. The Pre-service scene
also excludes desk and room sources, so rehearsal audio is not added to the
online program. For another desktop application that must be streamed while the
physical line-out remains silent, send that application to a virtual cable and
capture the cable's render endpoint without monitoring it to the physical
output.

The hostname must be reachable from the CSpot API host. The URL is relayed by
CSpot, so browsers do not need direct access to the Windows machine.

### Latency and silence

WASAPI loopback does not deliver capture packets while the selected output is
silent. The bridge therefore clocks raw PCM into FFmpeg every 20 ms and inserts
digital silence whenever no render packets are available. It caps queued raw
audio at 500 ms, dropping stale whole packets if the capture producer falls too
far ahead. This keeps the MP3 response continuous and prevents a silent Windows
endpoint from making CSpot's FFmpeg input terminate.

The render endpoint's WASAPI buffer and MP3/browser buffering still add latency.
Do not mix `pc-media` with a desk return containing the same PC playback: the
different hardware paths will produce echo or comb filtering even if their
average delay is tuned. The Media scene's mix-minus routing avoids that duplicate
path; camera/audio synchronization should then be calibrated against the one
audio path actually selected.

## Source options

- `Backend`: `dshow` for Windows capture inputs, `wasapi-loopback` for a
  Windows playback/render endpoint, or `alsa` on Linux/Raspberry Pi OS.
- `Device`: an exact DirectShow input name; `default` or an exact active Windows
  render-endpoint friendly name for `wasapi-loopback`; or an ALSA identifier such
  as `plughw:CARD=Device,DEV=0`.
- `Channels`: requested capture channels for DirectShow/ALSA. WASAPI detects the
  render endpoint's mix format automatically. MP3 output is currently downmixed
  to mono for every backend.
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
