# XR18 local mixer control

Open **Broadcast → Mixer** for the XR18 desk. The existing broadcast audio mixer
continues below it and controls cspot's recording/listening mix separately.

The installed XR18V2 was discovered on 17 October 2026 at `192.168.2.141`, firmware
`1.19`. Reserve its DHCP address on the router. The XR18 network switch must be
in Ethernet mode. Connect using its LAN IPv4 address; discovery accepts a private
`/24` or smaller subnet and runs from the API host, not the browser.

## Local architecture

`app.modules.mixer` owns one asynchronous UDP session per API process. Browsers
use authenticated HTTP commands and a 20 Hz SSE stream of changed parameters
and meter values. The API talks directly to UDP port 10024, renews `/xremote`
and `/meters/1` every three seconds, and sends read-only identity probes every
two seconds. There is no cloud protocol service, CDN dependency, or external
controller application in this control path. For LAN-only operation, open the
LAN-hosted cspot instance; a public reverse proxy adds a network round trip.

One API worker is required because the live transport and cache are in-process.
The existing production Uvicorn configuration uses one worker. Broadcast control
permission (`broadcast:use`) gates every endpoint, including discovery and events.
The mixer itself has no OSC authentication; keep UDP 10024 inside the trusted LAN.
Docker bridge mode supports direct unicast control; subnet discovery works even
where UDP broadcast does not cross the bridge. No extra published UDP port is needed.

Connection and snapshot configuration persist in PostgreSQL through migration
`0072_xr18_mixer`. Opening the dashboard starts the saved connection. Connecting,
reconnecting and synchronizing only read mixer parameters. No initial template,
scene, fader, routing or phantom setting is applied automatically.

## Controls

- Inputs 1–16, stereo aux, four stereo FX returns, six buses, four FX sends,
  four DCAs and main LR, with live pre-fader meters (main meters are post-fader).
- Faders, channel mute, input solo, pan, names, colors, analog/USB input source,
  physical headamp gain and individually confirmed 48V phantom power.
- Channel high-pass, polarity, four-band EQ, gate, compressor, key filters,
  inserts, automix, DCA and mute-group assignments.
- Bus/main six-band parametric and 31-band graphic EQ, dynamics and inserts.
- Ten sends per input/return with send tap/group settings; sends-on-faders
  changes the send levels while the channel mute remains a whole-channel mute.
- Aux output, USB, Ultranet/P16, main and headphone routing; stereo links,
  monitor source/trim/dim/solo mode and mute groups.
- Four FX algorithms and active parameter controls. Continuous FX parameters
  use normalized values; switches and enumerations preserve integer OSC types.
  Common reverbs and delays have named parameters. Less common algorithms use
  parameter indices, requiring the X AIR effect reference for their meaning.

Unavailable parameters remain disabled. Synchronization is paced at 250 queries/s
and takes around 12 seconds; valid controls become available as replies arrive.
The client keeps one HTTP command batch in flight, coalescing queued movements to
the latest value per parameter. Idle continuous gestures use a 35 ms coalescing
window; slow connections never accumulate a replay of intermediate fader positions. Hardware
readback, not a browser-only value, confirms a change. Unacknowledged commands
retry twice and report failure rather than silently treating a UDP send as success.
Changes from another controller arrive through `/xremote`. Loss of connection
clears cached controls and disables writes; reconnection reads the desk again.

## Snapshots

Snapshots save the parameters cspot has successfully read, with name, timestamp
and device identity. They are local cspot snapshots, separate from the mixer's
internal scene slots. Saving requires synchronization to finish. Recall requires
an in-app confirmation and preserves physical preamp gain and phantom power.
FX algorithms are applied before their parameters. Recall blocks other dashboard
writes while running, and pending hardware confirmations remain visible afterward.
Snapshot recall is a sequence of UDP changes, not an atomic desk operation.

## Protocol references and validation

- [Music Tribe X AIR/M AIR remote control protocol](https://mediadl.musictribe.com/download/software/midas/M-AIR/M%20AIR%20Remote%20Control%20Protocol.pdf)
- [Patrick-Gilles Maillot and Ken Mitchell X AIR scene parameter tables](https://github.com/pmaillot/X32-Behringer/blob/master/XAirSetScene.h)
- [X AIR effect parameter conversions](https://github.com/pmaillot/X32-Behringer/blob/master/XAir_fxparse1.c)
- [xair-api-python author implementation](https://github.com/onyx-and-iris/xair-api-python)

OSC strings/types are big endian and four-byte aligned. Meter blob contents are
little endian: an int32 count followed by signed int16 values in 1/256 dBFS.
Unused FX parameters return NaN and are excluded from state and snapshots.
Tests cover the codec, meter layout, validation, simulated UDP session, read-only
synchronization, hardware confirmation, external changes, offline writes and FX
integer types; frontend tests cover the physical-unit conversion curves.

## Desktop, tablet and phone layout

The desk measures its available container width with `ResizeObserver`, including
space used by app navigation. Automatic banks show 2, 4, 8 or 16 strips while
keeping Main LR pinned. Previous/next bank buttons switch channels without
sending mixer commands. The All bank retains horizontal browsing.

A roughly 10-inch tablet is the primary touch target. Landscape generally fits
eight channels; portrait generally fits four. Touch and hybrid devices use
44-pixel minimum action targets and 16-pixel text inputs to avoid iOS input zoom.
Faders use independent pointer capture and relative dragging, so touching a rail
does not jump the level. Separate fingers can control separate faders. Arrow keys
adjust a fader, Shift gives fine adjustment, Page Up/Down makes larger changes,
and Home/End select the extremes. Meter updates preserve control focus and drag state.

Connection setup collapses once an address is configured. The channel editor
starts collapsed below 1100 pixels of available width; tap a channel name or
Edit channel to open it. Explicit open/collapse choices persist during rotation
for the current visit. Phone navigation uses a view selector. Expand fills the
browser viewport with the XR18 desk, hiding the rest of the app visually; Restore
or Escape returns to the normal app. This works without requiring browser
fullscreen permission. Short landscape viewports use shorter fader tracks.

Automated interaction checks cover bank sizing and rotation, paging, collapsible
panels, expanded view cleanup, keyboard/fine control, relative touch movement,
pointer cancellation and simultaneous fader drags. Actual tablet-browser visual
and physical touch testing remains necessary; DOM tests do not emulate rendering
or the device's touch hardware.


## Streaming through the public website

The public route includes the website's Next.js rewrite, an outer nginx gateway
and Cloudflare. Event responses explicitly set `Cache-Control: private, no-store,
no-transform`, `Content-Encoding: identity` and `X-Accel-Buffering: no`. Cspot nginx
disables gzip/buffering for the event endpoint and forwards the buffering header
to later proxies. Without these directives, gzip in the website proxy buffers the
live stream even while ordinary commands and state reads remain fast. Validate
with normal browser compression headers through the public URL, not just the API
or cspot's internal nginx, and read complete HTTP chunks rather than timing
byte-at-a-time JSON parsing in the measurement client.

Visible clients reconnect after three seconds without events. Returning from a
background tab opens a fresh stream and full snapshot automatically. A delayed
initial state request cannot overwrite newer streamed values. Local control
feedback is immediate, but remains marked as pending until hardware readback;
failed commands restore the authoritative value. Batched commands validate all
parameters and phantom confirmations before writing any of them to the mixer.
