# Broadcast Viewer Direction

Last updated: 2026-07-03

## Current State

Broadcast is a remote service viewer with compact sermon recording.

- All eligible users land on Viewer by default.
- Trusted users can open Settings to configure the stream title and description,
  external camera/livestream URL, Raspberry Pi or desk audio stream, pre-service
  audio URL, lead time, and holding messages.
- The slideshow and camera appear only while CSpot has an active presentation heartbeat.
- Desktop uses two equal side-by-side media panels; mobile stacks the same panels vertically.
- Before the next planned service, a configurable starting-soon window can offer
  light worship audio or an external audio stream.
- At other times, both panels clearly show that no service is currently streaming.
- Moving from a non-sermon section into a sermon while the presentation output
  has a fresh live heartbeat automatically records mono Opus audio and timestamps
  slide changes. Opening on a sermon or moving between sermon slides does not
  restart a stopped recording. A paused recording resumes on the next sermon
  slide; leaving the sermon or closing the output always finalizes it.
- Presenters can opt into recording controls with the off-by-default Recording
  toggle, then start, pause, resume, or stop beneath the slide controls. Every
  service has an End slide, giving the presenter a deliberate finish action.
- Trusted users can open or permanently delete archived sermons from Broadcast
  settings. Archive playback synchronizes the retained audio with the original
  presentation slides, compensates for camera audio pipeline latency, and follows
  seeking correctly. Livestream camera audio requests unmuted playback by default;
  browsers that block audible autoplay show the existing start-audio action.

## Media Architecture

Viewer video is delivered through the configured stream or camera proxy. A
dedicated private live-audio source is relayed by the API. The API uses FFmpeg
during sermon recording to extract 48 kbps mono Opus audio;
it does not retain a large composite video. Recording files live in the durable
application storage volume and slide timing is stored in the database.

## Retired Direction

The former OBS WebSocket controls and virtual-camera controls remain retired.

## Possible Future Work

- Optional public/no-login viewer link with explicit access controls.
- Stream health checks and a friendly camera-unavailable state.
- Multiple service schedules or special-event starting-soon windows.
- A curated uploaded pre-service audio playlist with licensing metadata.
- Attendance telemetry that avoids collecting unnecessary personal data.
