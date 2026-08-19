# Broadcast Viewer Direction

Last updated: 2026-08-05

## Current State

Broadcast is a remote service viewer with compact sermon recording.

Admin controls are separated into Recordings, Livestream, and Audio Mixer tabs.
The mixer tab records a shared desk profile and can launch a desk web interface
or OSC/MIDI bridge. Native musician monitor faders remain deliberately
model-specific: the desk model, allowed buses, and mute/gain safety boundaries
must be known before adding a protocol adapter.

- All eligible users land on Viewer by default.
- Trusted users can configure up to eight named camera sources, put a source on
  air with a cross-fade, or enable synchronized timed rotation. Audio can follow
  either camera or use an independent Raspberry Pi/desk stream. The Viewer uses
  one sound toggle instead of native audio controls; trusted users also get a
  compact live desk for camera fades, rotation, timing status, and configuration.
- Camera video prefers low-latency MSE over the camera gateway WebSocket. Both
  the video and selected camera audio reconnect automatically after a stall;
  video switches to HLS when MSE negotiates a codec the browser cannot play or
  does not produce playable media promptly. The camera proxy has a dedicated
  WebSocket route so upstream tunnels cannot strip the MSE upgrade handshake.
- Slide updates are sampled every 500 ms and have a configurable delay for
  alignment with the measured camera pipeline latency.
- The slideshow and camera appear only while CSpot has an active presentation heartbeat.
- Desktop uses two equal side-by-side media panels; mobile stacks the same panels vertically.
- Before the next planned service, a configurable starting-soon window can offer
  light worship audio or an external audio stream.
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
sources remain connected while live so fades do not wait for camera startup. A
dedicated private live-audio source is relayed by the API. The API uses FFmpeg
during sermon recording to extract 48 kbps mono Opus audio;
it does not retain a large composite video. Recording files live in the durable
application storage volume and slide timing is stored in the database.

## Retired Direction

The former OBS WebSocket controls and virtual-camera controls remain retired.

## Possible Future Work

- Optional public/no-login viewer link with explicit access controls.
- Multiple service schedules or special-event starting-soon windows.
- A curated uploaded pre-service audio playlist with licensing metadata.
- Attendance telemetry that avoids collecting unnecessary personal data.
