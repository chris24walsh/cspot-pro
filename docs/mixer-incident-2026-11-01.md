# Live mixer instability — 1 November 2026

Status: unresolved; investigation and hardening required after the service.
Do not deploy, restart services, or change live mixer state during the service.
All times below are Europe/Dublin (UTC on this date).

## Operator reports

- During the live service, an unexpected scene change occurred alongside
  out-of-sync changes and increased master gain. Exact incident time, source and
  destination scenes, master control, and level changes are not yet established.
- By 11:42:57, the operator reported **another unexpected scene change**.
  This is the time the follow-up report was recorded, not a measured event time.
- The operator explicitly requested strong notes and hardening after the service.
  Recurrence means this must not be treated as a single accidental scene selection.

## Evidence collected read-only

- Production source revision: `a5471391`, matching the local checkout.
- Production API logs contain repeated SQLAlchemy connection-pool timeouts at
  10:46:50–10:46:56: pool size 5, overflow 10, timeout 5 seconds. Requests failed.
  This establishes server instability, but does not establish that those failures
  caused either reported scene change.
- `SceneAutomation.tick` in `backend/app/modules/mixer/automation.py` clears
  `applied_key` while the mixer is disconnected, syncing, or recalling. When it
  resumes, it can reapply the same scene's saved channel levels, replacing live
  manual adjustments. This is a code-supported failure mechanism, not a confirmed
  reconstruction of either incident.
- The application key includes the complete automation configuration and service
  identity. Investigate whether unrelated configuration or service changes can
  trigger a fresh application of an unchanged scene.
- Scene automation commands target input, aux, and FX-return channel routing,
  mute, faders, and livestream sends. They do not target the LR master fader.
  The source of the reported master increase remains unknown. Higher master level
  can compound the effect of recalled channel levels.
- Mixer synchronization queries desk values; it does not itself recall a scene.
  Distinguish a visible scene-label change, hardware preset reapplication, and an
  actual desk snapshot recall during the investigation.
- Existing logs examined do not provide a sufficient history of scene decisions,
  command values, or originating clients to attribute the incident.
- No live controls, configuration, containers, or deployments were changed during
  this investigation.

## After-service investigation and hardening

Live follow-up at 11:45:18: API, web, and database containers all report healthy;
API has been up for 10 hours, so this is not a container restart loop. Repeated
database-pool timeout failures recurred at 11:43:39, close to the second report.
Container health therefore does not imply reliable application requests.

1. Preserve available API/proxy logs and establish an incident timeline with the
   operator. Identify scenes before/after each event, approximate times, devices
   and tabs in use, service cues, reconnects, and the affected master control.
2. Trace all scene writers: presentation cues, automatic scene selection, manual
   scene controls, full configuration saves, stale tabs, and concurrent clients.
   Check for stale writes, delayed requests, and service-session selection changes.
3. Add durable scene and mixer-command audit records with timestamps, cause,
   previous/next scene, service and configuration revision, originating actor or
   client when available, and command origin/value. Record reconnect, resync,
   automation reset, retry, and master changes without logging secrets.
4. Preserve live manual adjustments across reconnect/resync. An unchanged scene
   must not silently reapply merely because connection state or unrelated settings
   changed. Define explicit behavior for recovery and partially confirmed scenes.
5. Check manual command retries against newer desk changes and scene transitions;
   prevent obsolete pending writes from restoring stale levels.
6. Investigate database-pool exhaustion, including long-lived event streams and
   session lifetimes. Fix ownership/lifetime problems before increasing limits.
7. Add meaningful regression coverage for reconnect/resync with manual adjustments,
   simultaneous clients, stale saves, delayed commands, repeated service cues,
   configuration changes, and database failures. Verify master controls remain
   independent of scene automation.
8. Review changes and validate recovery behavior after the service before following
   the normal commit, push, and production deployment workflow.

## Open questions

- Were the two events actual scene changes or reapplications of the same preset?
- Was Auto scenes enabled, and was a manual hold active?
- Did a presentation cue or another client change at the same time?
- Which master was raised, by how much, and from which controller?
- Did either incident coincide with database failures or a mixer reconnect?

## Operator follow-up: navigation-driven scene regressions

The operator reports that some devices appear to navigate the service back to
Pre-service, Welcome, Worship, Open time, or other earlier sections. This is a
specific new lead: shared presentation navigation may be causing backward audio
scene changes. It remains an observation to trace, not a proven device attribution.

Proposed product behavior for after-service implementation:

- Make automatic scene progression forward-only within a live service. Track the
  furthest intentionally activated section by stable section identity and service
  session, rather than ranking scene names (Worship and other scenes may recur).
- Navigation behind that progress point must not change the automatic audio scene.
  Returning to the progress point must not reapply its preset or erase manual levels.
- Loading a page, reconnecting, restoring stale local state, or browsing content on
  another device must not advance or rewind authoritative live-service progress.
  Inspect and separate local viewing position from explicit live presenter actions.
- An authorized mixer operator must retain an explicit way to select and hold an
  earlier scene. This is an intentional override, not an automatic backward cue.
- Define deliberate reset/new-service behavior and handle section reordering,
  deletion, forward skips, and repeated scene types without accidental recalls.
- Confirm which actions count as intentional live advancement before implementation;
  forward-only progression alone does not prevent an accidental forward jump.
- Test concurrent devices navigating backwards, stale navigation arriving late,
  reload/reconnect, return to the current section, and explicit manual overrides.

No runtime behavior has been changed during the service.

## First mitigation prepared

Implemented after the operator requested a first fix; deployment remains on hold
following their subsequent instruction to wait.

- Remove the presenter effect that published default/local state on mount and
  blank/theme changes. All operator changes already publish explicitly.
- Remote state application disarms local slide timers. Seeing an open slideshow
  on another device no longer arms a local timer by itself.
- Presenter, Worship Live, and output writes send `expected_updated_at`. The API
  serializes presenter writes and returns authoritative state when the supplied
  base no longer matches, even if the submitting device has a newer wall clock.
  Clients reconcile that response. This protection requires refreshed controllers;
  older clients remain compatible but do not send the new base timestamp.
- Omitted service stage/phase fields preserve current timing instead of defaulting
  a live service back to ready. This is especially relevant to Worship Live and
  output media callbacks.
- Mixer reconnect/resync retains the last applied scene key; only relevant scene
  commands, service identity, and explicit apply revisions trigger reapplication.
  Preview-to-live handoff and unrelated preset edits retain manual adjustments.
- Mixer permission transactions close before OSC work; state/stream config reads
  execute in a worker and release their connection before returning to the mixer
  loop. Blocking synchronous DB work in these async endpoints was a concrete
  event-loop hazard; its contribution to the observed pool failures is unproven.
- Add scene transitions, presenter cues/actors, hardware applications, and rejected
  stale writes to server logs. This is operational logging, not a durable audit DB.

Validation: 110 targeted backend tests and 52 frontend tests passed, including
new stale-base, omitted-stage, reconnect, preview handoff and DB-release regression
cases. Production frontend build passed. Local UDP tests required execution
outside the socket-restricted sandbox against a simulated localhost desk only.

Remaining limitations: a deliberate or accidental click from a device that has
current state is still accepted; this change does not impose a presenter lease,
forward-only progression, or navigation confirmation. Database failures need
post-deployment observation. The source of the master increase remains unknown.
No claim is made that either incident has been reconstructed or fully resolved.
