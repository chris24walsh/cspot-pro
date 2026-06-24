# Broadcast Viewer Direction

Last updated: 2026-06-24

## Current State

Broadcast is a remote service viewer, not an OBS controller or media recorder.

- All eligible users land on Viewer by default.
- Trusted users can open Settings to configure the stream title and description,
  external camera/livestream URL, pre-service audio URL, lead time, and holding messages.
- The slideshow and camera appear only while CSpot has an active presentation heartbeat.
- Desktop uses two equal side-by-side media panels; mobile stacks the same panels vertically.
- Before the next planned service, a configurable starting-soon window can offer
  light worship audio or an external audio stream.
- At other times, both panels clearly show that no service is currently streaming.

## Media Architecture

Camera and audio URLs are loaded directly by each viewer browser. CSpot stores
configuration and supplies live presentation state, but it does not proxy or
transcode the external media. The configured provider therefore owns bandwidth,
availability, access control, and browser-compatible stream delivery.

## Retired Direction

The former OBS WebSocket controls, recording library, virtual-camera controls,
and related server configuration are no longer part of the active product.
Historical database recording rows may remain for data preservation, but no
current UI or API workflow depends on them.

## Possible Future Work

- Optional public/no-login viewer link with explicit access controls.
- Stream health checks and a friendly camera-unavailable state.
- Multiple service schedules or special-event starting-soon windows.
- A curated uploaded pre-service audio playlist with licensing metadata.
- Attendance telemetry that avoids collecting unnecessary personal data.
