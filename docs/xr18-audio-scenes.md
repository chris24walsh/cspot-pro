# Service-driven room and livestream audio

Pre-service opens mapped band (`worship`) inputs in the room at their saved
Worship levels while disabling their livestream bus sends. Pre-service media
remains stream-only in suggested presets. Migration 0077 updates existing band
presets without enabling livestream bus control or changing USB routing. Until
the isolated bus feed is connected and capture is verified, the legacy desk
feed cannot be assumed to exclude room rehearsal audio.

## Audio mixing retirement — 25 October 2026

Software source mixing is retired. The XR18 mixes locally and supplies one stereo
program feed at unity gain to livestream and recording. Broadcast → Mixer keeps
hardware controls and scene automation; software source faders and software scene
routing are archived in `archive/software-audio-mixer`. Existing source/scene JSON
is retained for recovery. Migration 0076 replaces a legacy mix with its unique
`desk` source; ambiguous mixes require operator selection. Viewers use the shared
go2rtc audio transport when configured, with single-feed API relay compatibility.
FFmpeg remains for capture, transport and recording encoding, without multi-input
mixing, software trims, limiting or ZMQ gain control. Room sound should use direct
desk outputs. Streaming/browser delay remains and requires on-site measurement.
This supersedes earlier software-mixer descriptions below.

The XR18 **Audio scenes** tab can follow the current service section and apply
separate channel levels for the room and livestream. It runs on the server;
leaving the mixer browser closed does not stop it. Hardware automation defaults
to **off**, and existing installations retain the software audio mixer.

## Prepare before Sunday

1. In Mixer → Audio scenes, map the actual inputs: pastor/reader, congregation,
   worship voice/instrument, PC media/backing tracks, and room ambience. Leave
   unused inputs untouched. Removing a mapping removes that input from the draft
   presets; save afterward.
2. Generate suggested presets and review every level. These are starting points,
   not calibrated mixes. They include media during Worship for backing tracks,
   exclude ambience from the room, and keep room media off during Pre-service.
   Adjust those choices for your church.
3. Edit each preset separately for Room and Stream, or use **Capture current
   mix** when connected. Capture reads mapped channels for the enabled outputs
   and preserves the other output's existing preset. Save with hardware control
   disabled until routing and listening checks are complete. Export setup for a
   local copy.
4. Set a section's **Audio scene** override where automatic type selection is
   insufficient. Child items inherit it unless they specify their own override.
   Pre-service and Post-service stages take priority. Custom section scene IDs
   can be added as hardware presets using **Add section scene**.

## Sunday connection and listening checks

Connect the XR18 USB-B port to the church PC using the USB A–B cable. Verify the
Windows driver and the actual stereo recording endpoint before changing the
bridge configuration. The provided DirectShow example requires an endpoint that
FFmpeg can capture as stereo; an ASIO-only endpoint is not sufficient for that
example. Do not replace the working bridge configuration until capture works.

Choose a genuinely unused adjacent bus pair (1/2, 3/4 or 5/6), link it for stereo,
and set every controlled channel's sends to **Pre fader**, with subgroup off.
Route the bus pair's post-fader outputs to the USB capture channels exposed by
the selected Windows stereo endpoint. The software verifies bus linking and
send taps before applying any scene, but USB routing, bus master level and
Windows capture routing still need a listening test. Existing monitor mixes
must keep their own buses. Main L/R continues to feed the room amplifier.

Route PC media playback into a chosen mixer input/USB return and include that
input in the scene mapping. Check both channels with a left/right test signal.
Keep capture monitoring out of that playback return to avoid a feedback loop.
Confirm room changes do not change livestream levels, and vice versa. Channel
Mute affects both mixes; a manual mute lasts until the next applied scene.

Copy settings from [the stereo bridge example](../audio-bridge/appsettings.XR18.example.json)
into the church PC bridge configuration, retaining its real token, URLs and
other sources. Replace the device placeholder with the verified capture name.
`OutputChannels: 2` opts into stereo; existing sources default to mono. Register
the bridge's XR18 program URL as a broadcast audio source. In Livestream
settings select **Digital mixer stereo program** and choose that source. This
pins both livestream and recording to the desk's program output at unity gain;
section scenes do not change the old software source gains. Software mixing is
still available for churches without a digital mixer.

Start a rehearsal presentation with audio scene automation enabled. Review the
saved presets, enable hardware control, choose the desired room/stream outputs,
and save. Watch for hardware confirmation and listen through each section.
**Apply & hold** auditions a saved preset and pauses service following;
**Resume service cues** restores it. **Pause changes** disables further automatic
writes and leaves the desk at its current levels.

## Runtime behavior

Each scene applies once; manual fader adjustments remain until the next scene.
Room on/off controls the channel's Main L/R assignment rather than global Mute,
so room exclusion does not remove that channel from the independent stream bus.
Stream on/off controls bus send levels. Scenes do not touch preamps, phantom
power, Solo, EQ, dynamics, bus masters or Main L/R master. Existing
channel and bus processing remains available in the normal mixer view.

Service cues require a recent live presentation and the existing global audio
scene automation switch. Stopping a service selects Post-service; its hardware
cue remains eligible for two hours. No old cue sequence is replayed after a
network outage: once readbacks and routing are ready, only the current scene is
applied. Scene changes wake the worker immediately, with a one-second fallback
poll. Missing readbacks block the complete scene before writes begin. Status
reports confirmation, operator adjustments and unconfirmed changes.

Mixing moves into the XR18 DSP. USB capture, compression, streaming and recording
still need the bridge/FFmpeg transport and encoding; this does not eliminate all
latency. The physical USB, stereo routing and end-to-end listening checks must
be completed on site before this mode is ready for Sunday use.

On every cspot API startup, the saved mixer connection starts without requiring
an open browser. All 16 inputs, stereo aux and four FX returns are muted as their
readbacks arrive. Controls and automatic scenes wait until all 21 mute states
are confirmed. Startup also holds scene following until an operator explicitly
applies a scene, enables/resumes hardware control, or unmutes a channel. This also silences an ongoing service if the API restarts. Ordinary
network reconnects do not reapply a completed startup mute. If startup muting
was incomplete when the connection dropped, all channels are verified again.

For XR18 power-on protection before cspot connects, enable **X AIR Edit → Setup
→ Audio/MIDI → Safe Levels → Mute outputs at power cycle** on the desk. This
native output setting must be enabled and power-cycle tested locally; cspot has
not changed it remotely. Output muting and channel muting are separate: release
any native output mute separately when ready. Hardware startup protection cannot
be guaranteed by cspot while the mixer is unreachable.

Explicit source-mixer scene buttons temporarily apply the matching configured
XR18 preset when hardware control is enabled, including outside a live service.
The next presenter item/section cue restores following; only Apply & hold
creates a persistent hold.
Disabled hardware keeps the original software-only behavior. Missing or empty
hardware presets show an error rather than claiming to apply a desk mix. An explicit persistent hold can be released with **Resume service cues**. The
hardware preset dropdown is labelled **Edit preset**; selecting it edits the
preset, while **Apply & hold** sends it.

Scenes open a mapped channel if either controlled mix needs it, after setting
routing and levels. They globally mute a mapped channel when none of the enabled, configured
mixes needs it. Room-only scenes therefore mute unused microphones too.
Channel mute affects every output, including any monitor sends. This allows scene application to release startup channel mutes while
keeping room-only and stream-only inputs independent. Startup still waits for
all mute acknowledgements and explicit operator release before scene audio
can open. Input mapping and nonempty saved presets remain necessary; the
application does not infer physical microphone assignments.

Input mapping distinguishes a service leader/opening mic (`leader`) from the
pastor/message mic. Draft generation adds a separate `service_leader` preset
when a leader input is mapped; installations without one retain the standard
six drafts. Use a matching named broadcast scene to expose it in source buttons
and section Audio scene overrides. Generating drafts still requires review and
does not enable hardware control.

Presenter selection drives enabled hardware scene following even without an
active slideshow output. Ready presentation selections qualify for 30 minutes
from the latest item navigation; ended sessions remain excluded except recent
Post-service. Software-only scene following keeps its existing live-output
behavior. Startup scene hold is released by an explicit presenter navigation,
not by simply loading the saved selection. Item and inherited section Audio
scene overrides take precedence over type inference. Source buttons provide a
temporary override until the next cue, while Apply & hold remains persistent.
