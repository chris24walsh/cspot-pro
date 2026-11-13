# Shared worship timing requirements

## Goal

Make live timing recoverable from any authorized controller without depending on
the responsiveness of the device producing audio. Slow readers must not rewind
the band, congregation, or shared clock.

This is the implementation contract. Automated validation is recorded below;
physical older-device and live-service rehearsal remain operational checks.

## Permissions and interaction

- Administrators and approved worship leaders may start shared timing in Worship
  Live and reseat it from Worship Live or Service.
- Musicians may follow timing, use private practice, and browse independently.
  Their navigation must not reseat or stop shared timing.
- Administrators may immediately stop shared timing from either view, without
  consent or acknowledgement from the playback owner.
- The playback owner may stop its own session normally. A worship leader must
  not gain the administrator's ability to stop another device's session.
- Remove the persistent Share timing toggle. Eligible controllers starting
  playback while participating in shared navigation publish automatically.
  Independent playback remains private; musicians' playback remains private.
- Keep Follow shared timing as a device preference. Keep Auto-scroll as a local
  viewport preference and Service Sync as the congregation-output coupling.
- With Band sync off and Service Sync off, browsing and playback remain local.
  Service Sync retains its existing priority over Band sync.
- Manual section clicks, current-section clicks, keyboard navigation and
  previous/next controls use the same reseat behavior. Automatic page changes,
  display changes and catch-up scrolling never request a reseat.
- A reseat normally takes effect at the next bar, with no additional count-in.
  Repeated song sections and partial-bar chord entry must remain supported.
- An administrator stop leaves the selected page and coupling intact and restores
  ordinary manual navigation. Late heartbeats, queued seeks, automatic page turns
  and reconnects cannot restart the stopped session.

## Authoritative state and protocol

- Use a server-owned, monotonically increasing revision for shared clock changes,
  including stop tombstones. Do not use client wall-clock timestamps for ordering.
- Keep one audio/playback owner internally, distinct from permission to reseat.
- A successful reseat changes the server's timeline immediately, with a scheduled
  effective time. Followers must not wait for acknowledgement from the owner.
- Until that effective time, followers use the preceding clock; afterwards they
  use the destination clock even if the owner is offline or slow.
- Derive the next boundary from the authoritative position and resolved bar
  durations. During a negative count-in or intro, use the next valid boundary.
  Reject an invalid destination explicitly rather than inventing a timeline.
- Timing must carry sufficient resolved musical information for clients to
  interpolate without per-frame network traffic, including variable bar lengths.
- Serialize competing changes transactionally. Validate the expected revision;
  return explicit conflicts and current state when applicable. A rejected stale
  write must not produce side effects.
- Commands must have stable request IDs so retrying the same action cannot apply
  it twice. A newer intentional reseat supersedes an older pending reseat.
- Heartbeats report owner health; they must not replace a newer server timeline
  or renew a stopped session. Starting again requires an explicit new session.
- A lost owner connection must not rewind or immediately destroy the accepted
  timeline. The clock may finish normally while owner health is shown separately.
- Validate the target song/item against the active worship/service relationship,
  including linked worship sets. Enforce all permissions on the server.
- Keep existing HTTP transport for this change. Avoid adding a message broker or
  requiring WebSockets. Share transport and position-resolution helpers where
  practical, rather than duplicating Worship Live and Service algorithms.

## Integration boundary

The backend and frontend implementers must agree on and publish the exact API
schema before integration. Prefer extending the existing music-timing read
endpoint and adding explicit command operations over overloading slide changes.
The contract must describe start, reseat, owner stop, administrator stop,
heartbeat, current revision, pending destination/effective time, owner health,
idempotency and stale-client behavior. Existing timestamp-only publishers must
not be able to resurrect a revised/stopped clock after deployment.

Service and Worship Live must resolve the same musical destination using a shared
frontend helper. Neither view may bypass the command path by publishing inferred
timing from an automatic slide update.

## Status and failure handling

- Show shared timing running, a scheduled reseat, disconnected/stale owner and
  actionable request errors without browser prompts.
- Do not clear a rejected reseat error merely because unrelated polling succeeds.
- On reconnect, fetch authoritative state instead of replaying obsolete actions.
- Administrative stop must remain discoverable even when the administrator is
  not following timing and is not the playback owner.
- Connected audio owners must stop on the server stop revision. A disconnected
  browser cannot be physically silenced remotely; communicate that limitation.
- Guard polling against overlap. Keep smooth animation local and avoid rebuilding
  song charts/timelines on every animation tick.

## Acceptance tests

1. Leader/admin reseats from both views while another device owns playback.
2. Clicking the already-active section schedules a fresh entry.
3. Five or more simulated readers, with one delayed/backgrounded reader, cannot
   publish older state over an accepted command.
4. Followers adopt a scheduled reseat without owner acknowledgement.
5. Delayed owner heartbeats and competing reseats cannot roll back revisions.
6. Retry of a command ID has no duplicate effect.
7. Musicians cannot reseat or stop via the API or UI; private practice still works.
8. Administrator stop wins against pending reseats and in-flight owner updates.
9. After stop, both views navigate manually and only a deliberate start restarts
   shared timing.
10. Independent browsing does not publish shared changes; coupling behavior stays
    consistent with the existing service-output rules.
11. Variable meter, repeated sections, intro/count-in and chord-entry behavior
    retain the existing musical semantics.
12. Reconnects, malformed targets and command failures have explicit outcomes.

## Delivery tasks

- Backend: authoritative protocol, transactional persistence, permission checks,
  backwards-safety behavior, and focused API/state-machine tests.
- Frontend: shared API/transport and destination helpers, both control surfaces,
  playback-owner integration, simplified controls, and focused multi-device tests.
- Integration: reconcile the contract, run targeted suites and production build,
  update user/architecture documentation, then commit, push and deploy only after
  the required behavior is verified.

## Validation

- `backend/.venv/bin/pytest backend/tests/test_worship_music_timing.py backend/tests/test_presentation_routes.py -q --tb=short`:
  75 passed.
- `npm test --workspace frontend -- --run src/components/useSharedMusicTiming src/components/MusicianLiveView.music.test.tsx src/components/LyricMusicControls.test.tsx src/components/useBandSync.test.tsx src/serviceMusicNavigation.test.ts src/serviceTiming.test.ts src/musicPractice.audio.test.ts`:
  68 passed across 11 files.
- `npm run build --workspace frontend`: passed; existing bundle-size warnings.
- `git diff --check`: passed.

The multi-client test uses five hook instances against a shared mocked service,
including delayed snapshots and stop/update races. This is not a five-device
browser or physical-device performance test. Playback tests cover late effective
times by skipping elapsed notes rather than replaying the destination from zero.
An already-finished destination stops local playback with an explicit error.

Existing timestamp-only timing sessions are not resumed after this upgrade.
Reload controller devices and deliberately start a new shared playback session.
