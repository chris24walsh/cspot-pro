# Remote pastor contributions

Broadcast → Livestream → Remote speaker lets an operator invite a pastor who is
at home or travelling. The guest opens an expiring private link in Safari or
Chrome on an HTTPS connection, permits the camera and microphone, and taps Join.
No CSpot account or installed app is required. Test the actual device and network
before the service; mobile browsers can suspend capture when locked or backgrounded.
Keep the page visible, connect power, and use headphones.

## Operator workflow

1. Enter the speaker's name, invitation lifetime (2 hours to 7 days), and an
   optional existing church audio source for the return feed. Create the
   invitation and copy its private link. CSpot displays the secret link once;
   create a new invitation if it is lost. Share it only with the speaker.
2. The guest joins backstage. Open Preview, then Listen for an audio check.
   Preview starts muted. Listen affects only the operator's device. If the
   congregation needs to hear the pastor, route this monitor into the church
   sound system and ensure that the desk return sent to the pastor excludes
   their voice. Monitor sound is independent of the on-air selection.
3. Start the livestream as usual, then Bring on air. The guest temporarily
   replaces both camera video and program audio for viewers. This does not
   automatically start a public stream or grant the guest presentation control.
   Active sermon audio recording follows the same temporary source.
4. Take off air restores the configured church video/audio feeds. End invitation
   also invalidates the private link and closes its publisher.

The guest can mute their microphone, turn off video, switch between front and
rear cameras, leave, hear the assigned church return, and follow the current
church slide. Slide text and rendered deck/image previews follow the active
service item. Video items show a media-playing cue rather than playing a second
copy of church media; welcome montages/countdowns do not reproduce their full
animation in this confidence view. Private teaching notes and unrelated library
files are not shared.

Only one remote speaker can be on air at a time. Guest feeds do not enter camera
rotation while backstage. Inviting or joining alone never puts a guest on air.
A disconnected guest is taken off air immediately when their browser reports
failure, or after 25 seconds without a connected heartbeat. Church sources then
resume; the operator must bring a recovered guest back on air. If no church
camera/audio source is configured, the existing offline/empty-source behavior
applies. A speaker can reconnect automatically after a network interruption.

## Network configuration

`CAMERA_PROXY_UPSTREAM` must point to a go2rtc gateway supporting WHIP ingestion,
WHEP playback, and in-memory stream registration (verified with go2rtc 1.9.10).
Invitation creation is disabled until the gateway WebRTC endpoint responds.
A compatible version alone is insufficient: inspect go2rtc startup logs for ICE
listener failures, including stale IPv6 interfaces. Fix the listener configuration
with an explicit appropriate private interface, following the host’s change
approval process, before inviting a speaker.

On Frigate-managed gateways, put this setting in the durable Frigate configuration
(e.g. `/config/config.yml`), under `go2rtc.webrtc.listen`. The gateway at
`192.168.2.208` uses `192.168.2.208:8555`. Its supervisor regenerates
`/dev/shm/go2rtc.yaml` and strips non-HomeKit settings from
`/config/go2rtc_homekit.yml` on restart, so editing either generated file does not
persist the listener. Restart only the go2rtc service after an approved change.
Reconcile CSpot audio sources and restore any needed dynamic gateway registrations
that the supervisor clears; retain existing configured camera sources.

The gateway must have FFmpeg with H.264, AAC, and Opus encoders. Its WebRTC ICE
candidates must be reachable from the guest, directly or through a TURN relay.
Only CSpot's scoped signaling routes are public: do not expose go2rtc management
or configuration APIs to the internet.

Direct connectivity uses this default browser ICE configuration:

```dotenv
REMOTE_ICE_SERVERS_JSON=[{"urls":"stun:stun.l.google.com:19302"}]
```

For hotel Wi-Fi, mobile networks, and restrictive firewalls, supply a reachable
TURN relay. Prefer a relay offering TLS/TCP on port 443 as well as UDP. A coturn
REST-auth deployment can use:

```dotenv
REMOTE_TURN_URLS=turn:relay.example.org:3478,turns:relay.example.org:443?transport=tcp
REMOTE_TURN_SECRET=<coturn static-auth-secret>
```

The API issues two-hour HMAC credentials; the shared secret never goes to the
browser. Alternatively put provider-issued ICE server objects in
`REMOTE_ICE_SERVERS_JSON`, including `urls`, `username`, and `credential`. Only
operators and holders of a valid guest invitation receive ICE credentials.
Supply these variables in the API service environment and recreate that service.
The UI reports when no TURN relay is configured. A STUN server discovers NAT
addresses; it does not provide a relay or guarantee connectivity on restrictive
networks. No relay service is provisioned or paid for automatically.

Use a church return input with a hardware mix-minus if the pastor's audio is
being played into the room. CSpot sends the explicitly chosen original church
input to the guest, never its remote program override. It cannot subtract the
pastor from audio that the physical desk has already mixed into that input.
Headphones on the guest device reduce acoustic feedback at their end.

## Architecture and lifecycle

`broadcast/contributions.py` owns invitation and signaling routes;
`contribution_state.py` resolves the temporary program override. Invitation
records store SHA-256 token hashes, expiry, optional return source, publishing
lease, and connected heartbeat. Secrets stay in URL fragments and Authorization
headers, with no-store responses. Operator actions require `broadcast:use`.
Guest tokens authorize only their own publishing/return/cue and the current
presentation item's preview assets. They do not authorize normal CSpot APIs.

CSpot forwards SDP to go2rtc server-side. The browser publishes once via WHIP;
operator preview uses WHEP. Per-invitation `cspot-guest-*` streams are registered
in memory. A refused loopback placeholder establishes the WHIP destination before
the passive producer connects. FFmpeg normalizes broadcast output to H.264/AAC
for existing MSE/HLS viewer delivery, and return audio to Opus for WebRTC. Existing
viewer permissions and stream-source allowlists still apply. Only the on-air
normalized guest stream is added to the normal playback allowlist.

`BroadcastViewerSettings.remote_contribution_id` selects the temporary override.
Saved camera lists, rotation, desk program input, and hardware mixer scenes are
not rewritten. Viewer playback applies the override, and server recording inputs
resolve it separately. Source changes reconfigure active audio recording using
its existing segment mechanism. Heartbeats every five seconds keep a publisher
lease alive. A ten-second maintenance loop releases abandoned publishers,
clears stale overrides, and removes expired/revoked invitation streams. Gateway
session deletion treats already-closed publishers as successfully stopped.

The invitation is a bearer capability. Ending it prevents new signaling and
stops the publisher. go2rtc WHEP playback connections have no server-side session
DELETE handle in 1.9.10: an already-open church-return connection can persist
until the guest closes it or its transport fails, even after invitation expiry.
The supplied guest page closes peers when it detects expiry/revocation. Use an
appropriately limited church return feed; immediate forced revocation of an
already-connected hostile receiver would require a gateway with managed WHEP
sessions or an additional media relay.
