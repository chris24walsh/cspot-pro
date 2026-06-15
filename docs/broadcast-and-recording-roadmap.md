# Broadcast and Recording Roadmap

Last updated: 2026-06-15

## Current State

CSpot now has an initial **Broadcast** tab that can control OBS over OBS WebSocket:

- Check OBS connection status.
- Start and stop recording.
- Start and stop streaming.
- Start and stop the OBS virtual camera.
- Register recordings in the app when OBS returns an output path.
- Scan a configured recordings folder.
- Play or download full recordings from the web app.
- Extract and serve MP3 audio from a recording using `ffmpeg`.

The Broadcast tab also has a lightweight remote-viewer proof of concept for
viewer-role users:

- It shows the live service slideshow from CSpot presentation state.
- It embeds one camera or stream URL configured by `VITE_SERVICE_CAMERA_URL`.
- It does not proxy camera/video media through the CSpot API, so viewer traffic
  can be handled by an IP camera, restreamer, CDN, or other separate service.

Relevant settings:

```env
OBS_WEBSOCKET_HOST=
OBS_WEBSOCKET_PORT=4455
OBS_WEBSOCKET_PASSWORD=
OBS_RECORDINGS_DIR=/app/storage/recordings
OBS_AUDIO_CACHE_DIR=/app/storage/recording-audio
FFMPEG_PATH=ffmpeg
VITE_SERVICE_CAMERA_URL=
```

The app currently assumes recording files are visible to the API container under `OBS_RECORDINGS_DIR`.

## Home Hosted App, Church OBS

Current deployment idea:

- CSpot is hosted on the home LAN / home server.
- The church computer opens CSpot through the hosted URL.
- OBS runs on the church computer.
- OBS control still happens from the CSpot API server, not directly from the browser.

That means the home-hosted API must be able to reach OBS WebSocket on the church computer.

Recommended route:

- Install Tailscale on the home CSpot server / VM.
- Install Tailscale on the church computer.
- Enable OBS WebSocket on the church computer.
- Set `OBS_WEBSOCKET_HOST` to the church computer's Tailscale IP or MagicDNS name.
- Keep OBS WebSocket password strong.

Example:

```env
OBS_WEBSOCKET_HOST=church-pc.tailnet-name.ts.net
OBS_WEBSOCKET_PORT=4455
OBS_WEBSOCKET_PASSWORD=change-me
```

## Recordings Across Sites

If OBS records on the church computer, the file is created there. CSpot can only list/play/download it if the API server can see it.

Possible solutions:

1. **Syncthing or Google Drive sync**
   - OBS records locally on the church computer.
   - The recording folder syncs back to the home server.
   - CSpot scans the synced folder.

2. **Tailscale shared folder / network mount**
   - Mount the church recordings folder onto the home CSpot server.
   - Point `OBS_RECORDINGS_DIR` at the mounted path inside the API container.

3. **Small church-side agent**
   - A future helper process runs on the church computer.
   - It talks to local OBS, uploads finished recordings to CSpot, and avoids exposing OBS directly to the home server.
   - This is probably the cleanest long-term architecture if the church computer is the real capture machine.

4. **Manual upload**
   - Add a simple upload button in Broadcast for sermon video/audio files.
   - Useful as a fallback even if automation exists.

## Next Implementation Ideas

### Recording Library Polish

- Attach recordings to a service plan and/or sermon item.
- Rename recording title from the app.
- Add sermon speaker, Bible text, date, and notes metadata.
- Add publish/unpublish state.
- Hide raw file paths from the UI.
- Add delete/archive with permission checks.
- Show duration once extracted via `ffprobe`.

### Audio Workflow

- Extract MP3 automatically when a recording is registered.
- Normalize sermon audio loudness.
- Trim silence from start/end.
- Optional sermon-only audio marker if recording starts before the sermon.

### Video and Livestream

- Keep OBS as the main broadcast engine initially.
- Replace Zoom gradually:
  - OBS can stream to YouTube, a private RTMP destination, or another streaming provider.
  - CSpot can expose the stream link/embed for remote viewers.
- The app should show live status, not become the video encoder itself unless there is a strong reason.

### Church Operator Role

Potential role: `operator`.

Should be able to:

- Advance slides.
- Add songs and Bible slides during a service.
- Start/stop OBS recording or stream if trusted.
- Remove only things they added during the current session.

Should not be able to:

- Add/remove sermon decks.
- Archive/delete services.
- Manage users.
- Perform broad destructive edits.

### Longer-Term Architecture

Best likely shape:

- CSpot web app: service planning, worship sets, presentation control, recording library.
- OBS: capture/stream/record engine on the church computer.
- Church-side agent: optional bridge for local OBS and local recording upload.
- Home server: app/database/media library.

This keeps the app simple while allowing the capture machine to stay physically close to the camera, mic, and display output.
