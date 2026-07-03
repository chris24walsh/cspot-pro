# Broadcast Viewer Direction

Last updated: 2026-07-03

## Current State

Broadcast is a remote service viewer with compact sermon recording.

- All eligible users land on Viewer by default.
- Trusted users can open Settings to configure the stream title and description,
  external camera/livestream URL, pre-service audio URL, lead time, and holding messages.
- The slideshow and camera appear only while CSpot has an active presentation heartbeat.
- Desktop uses two equal side-by-side media panels; mobile stacks the same panels vertically.
- Before the next planned service, a configurable starting-soon window can offer
  light worship audio or an external audio stream.
- At other times, both panels clearly show that no service is currently streaming.
- Entering a sermon section while the presentation output has a fresh live
  heartbeat automatically records mono Opus audio from the configured camera
  stream and timestamps slide changes. Selecting sermon slides without a live
  output does not record. Leaving the sermon or closing the output finalizes it.
- Presenters can start, pause, resume, or stop the recording beneath the slide
  controls. A paused recording resumes on the next slide change. Every service
  has an End slide, giving the presenter a deliberate way to finish the sermon.
- Trusted users can open or permanently delete archived sermons from Broadcast
  settings. Archive playback synchronizes the retained audio with the original
  presentation slides and follows seeking correctly.

## Media Architecture

Viewer media is delivered through the configured stream or camera proxy. The
API uses FFmpeg only during sermon recording to extract 48 kbps mono Opus audio;
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
