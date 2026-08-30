# Broadcast Viewer Direction

Last updated: 2026-08-30

## Current State

Broadcast is a remote service viewer with compact sermon recording.

Admin controls are separated into Recordings, Livestream, and Audio Mixer tabs.
The mixer tab records a shared desk profile and can launch a desk web interface
or OSC/MIDI bridge. Native musician monitor faders remain deliberately
model-specific: the desk model, allowed buses, and mute/gain safety boundaries
must be known before adding a protocol adapter.

The server-side source mixer accepts room, sound-desk return, and direct
church-PC media feeds. Its five presentation-aware scenes are Pastor,
Congregation, Worship, Media, and Pre-service. Pastor, Congregation, and Worship
exclude direct PC media; Media and Pre-service exclude desk and room feeds and
use direct PC media. This mix-minus prevents PC line-out audio returning through
the desk USB feed from being mixed with the same direct playback a second time.

- All eligible users land on Viewer by default.
- Trusted users can configure up to eight named camera sources, put a source on
  air with a cross-fade, or enable synchronized timed rotation. Audio can follow
  either camera, use one independent source, or use the shared room/desk/media
  mix. The Viewer uses one sound toggle instead of native audio controls; trusted
  users also get a compact live desk for camera fades, rotation, timing status,
  scenes, and configuration.
- Camera video prefers low-latency MSE over the camera gateway WebSocket. Both
  the video and selected camera audio reconnect automatically after a stall;
  video switches to HLS when MSE negotiates a codec the browser cannot play or
  does not produce playable media promptly. The camera proxy has a dedicated
  WebSocket route so upstream tunnels cannot strip the MSE upgrade handshake.
- Server-side multi-source audio mixes use authenticated 200 ms fragmented AAC
  with a bounded MediaSource queue, a shared camera/audio 250 ms live-edge
  target, and the existing MP3 relay as a compatibility fallback. Separate
  camera and audio timelines remain near one another but are not sample-locked.
- Slide updates are sampled every 500 ms and have a configurable delay for
  alignment with the measured camera pipeline latency.
- The slideshow and camera appear only while CSpot has an active presentation heartbeat.
- Desktop uses two equal side-by-side media panels; mobile stacks the same panels vertically.
- Before the next planned service, a configurable starting-soon window can offer
  light worship audio or an external audio stream. This pre-service track is
  still rendered directly by each remote viewer rather than by the server mix.
  Its presentation-output copy remains muted during remote-only playback, and
  the Pre-service scene excludes desk/room rehearsal audio.
- At other times, both panels clearly show that no service is currently streaming.
- Moving from a non-sermon section into a sermon while the presentation output
  has a fresh live heartbeat automatically records mono Opus audio and timestamps
  slide changes. Opening on a sermon or moving between sermon slides does not
  restart a stopped recording. A paused recording resumes on the next sermon
  slide. Leaving the sermon, reaching End, or closing output starts a configurable
  stop countdown; blanking does not affect recording. Returning to the sermon
  cancels the countdown without splitting the file. Expiry trims the retained
  audio back to the departure point and annotates the archive with the stop reason.
  Automatic captures under 30 seconds are discarded after an automatic departure,
  while a deliberate stop made on the sermon retains a short recording. Broadcast
  settings provide a persistent auto-record toggle; disabling it skips automatic
  source probes and recorder startup while keeping manual recording available.
- Recorder timestamps are generated from actual audio samples. Finalization
  compares the playable file with the expected duration and repairs timestamp
  gaps caused by pausing a live source before publishing the archive entry.
- Presenters can opt into recording controls with the off-by-default Recording
  toggle, then start, pause, resume, or stop beneath the slide controls. Every
  service has an End slide, giving the presenter a deliberate finish action.
- Trusted users can open or permanently delete archived sermons from Broadcast
  settings. Archive playback synchronizes the retained audio with the original
  presentation slides, compensates for camera audio pipeline latency, and follows
  seeking correctly. Livestream camera audio requests unmuted playback by default;
  browsers that block audible autoplay show the existing start-audio action.

## Media Architecture

Viewer video is delivered through the configured stream or camera proxy. Named
sources remain connected while live so fades do not wait for camera startup.
Private room, desk, and media sources are relayed and mixed by the API. Source
roles provide safe defaults when all five saved scenes are created or when a new
source is added to existing scenes. Standalone video playback selects Media and
remains there across slide navigation until playback is paused, stopped,
finished, or leaves the section. A song backing track remains in Worship so its
desk return still contains the live musicians and vocals and carries the PC
track only once.

When the selected live route already contains either the desk program or an
explicit media-role source, the viewer suppresses its local YouTube backing
iframe to prevent an echo with captured PC playback. The local iframe remains
as a compatibility fallback when neither program path is routed.

A Windows audio bridge may run interactively or, where the installed DirectShow
drivers have been verified, in a limited S4U boot task. The bridge only captures
an endpoint; a browser or another designated process must render program audio
to that endpoint. A healthy headless bridge therefore does not by itself provide
headless media playback.

With the present stereo desk record-out, CSpot cannot subtract only the PC track
while retaining live desk microphones. If a future workflow needs live
musicians from the desk plus a simultaneous direct PC-media leg, the desk must
provide an aux/matrix mix-minus output that excludes its PC input. The current
song-backing rule instead uses the complete desk return once.

The API uses FFmpeg during sermon recording to extract 48 kbps mono Opus audio;
it does not retain a large composite video. Recording files live in the durable
application storage volume and slide timing is stored in the database.

## Retired Direction

The former OBS WebSocket controls and virtual-camera controls remain retired.

## Possible Future Work

- Optional public/no-login viewer link with explicit access controls.
- Multiple service schedules or special-event starting-soon windows.
- A server-owned program-audio source that replaces the transitional
  browser-local pre-service player and can feed both the source mix and an
  independently controlled room output. A curated uploaded playlist should
  include licensing metadata.
- Graceful server-mix continuation when a configured HTTP source disappears,
  rather than merely becoming silent while its endpoint remains reachable.
- Attendance telemetry that avoids collecting unnecessary personal data.
