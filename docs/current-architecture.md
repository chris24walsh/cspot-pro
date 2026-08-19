# Development environments

The repository has a hot-reload local stack, an isolated production-image
sandbox, and production deployments. The sandbox owns a separate Compose
project, database volume, storage volume, credentials, and localhost port.
Private remote access uses Tailscale Serve and never production data.


# Current Architecture

This document describes the current architecture of `cspot-pro` in a way
that should be readable by both humans and coding agents.

## High-Level Shape

The system is a modular monolith with three primary runtime pieces:

1. `frontend`: React + TypeScript + Vite
2. `backend`: FastAPI + SQLAlchemy + Alembic
3. `db`: PostgreSQL

Local development and portability are centered on Docker Compose.

## Architectural Goals

- one repo
- one backend deployable
- explicit domain modules
- container-friendly local development
- minimal setup overhead
- future extraction possible if a module genuinely outgrows the monolith

## Runtime Topology

```text
Browser
  |
  v
Frontend (React/Vite)
  |
  v
Backend API (FastAPI)
  |
  v
PostgreSQL
```

Optional supporting flows:

- file upload storage under `backend/storage`
- rendered slide image generation through LibreOffice + `pdftoppm`
- local browser-to-browser presenter sync through `BroadcastChannel` and
  `localStorage`
- cookie-based session authentication between browser and backend

## Repository Structure

```text
backend/
  app/
    api/
    core/
    modules/
    scripts/
  migrations/
  tests/

frontend/
  src/
    components/
    data/
  public/

docs/
docker/
scripts/
```

## Backend Architecture

### Module Strategy

The backend is partitioned by domain modules inside `backend/app/modules`.

Current modules:

- `identity`
- `planning`
- `music`
- `people`
- `library`
- `presentation`
- `communication`
- `imports`
- `sunday_school`

These modules share a common database and API process, but are intended to stay
conceptually separate.

### Data Flow

Typical request path:

```text
Route -> schema validation -> ORM/session work -> response schema
```

### Persistence

- PostgreSQL is the system of record.
- Alembic handles schema evolution.
- Demo data seeding currently bootstraps a usable local environment.

### Authentication and authorization

`identity` now owns:

- first-admin bootstrap
- password hashing
- cookie-backed login/logout/session lookup
- role-to-permission resolution
- backend permission checks on module routes

The app uses an RBAC-style ladder aimed at church operations:

- read-only access
- edit existing plans/songs/team data
- create/manage plans and songs
- full administration including user management

### Files and slide decks

Uploaded files are stored under backend-managed storage paths.

For slide decks:

1. file uploaded
2. file linked to a plan item
3. backend renders deck pages to PNGs
4. frontend requests rendered slide URLs
5. presenter surfaces display those images

### Current rendering pipeline

The deck-rendering path currently depends on:

- LibreOffice (`soffice` / `libreoffice`) for conversion
- `pdftoppm` for PDF-to-PNG rendering

This works operationally, but may still differ visually from PowerPoint.

### Sunday School lessons

`sunday_school` owns date-based lesson records for emergency cover and lesson
preparation. It stores structured lesson fields plus a lightweight resource
catalog for purchased/local lesson files. Resource import stores metadata,
classification, and file links rather than copying lesson packet body text into
the database.

## Frontend Architecture

### App shape

The frontend is currently a single SPA with module-based views. The product
direction now strongly favors the Present workflow as the main operational
surface.

### Key presenter components

- `PresentationView.tsx`
- `PresentationOutput.tsx`
- `presentation.ts`
- `ScaledSlideImage.tsx`

### Presenter state model

The presenter is built around:

- selected plan
- ordered sections
- derived slides
- current live slide index
- a separate output window synchronized through local browser messaging

On phones and tablets, every module uses the same compact context toolbar with
an immersive-view toggle at its right edge. Entering immersive view always hides
the application's primary navigation row. Supporting browsers are additionally
asked to enter native fullscreen and hide their own navigation UI; iPhone and
iPad Safari keep their browser chrome but still gain the space occupied by the
application navigation. Date/history/assignment controls, broadcast mode tabs,
and musician live controls share this toolbar rather than adding view-specific
rows.

### Presentation derivation

Slides are derived from plan items by content type:

- songs -> split into multiple worship slides
- readings -> single text slide based on passage text
- deck-backed items -> one rendered image slide per deck page
- generic sections -> single text slide

### Local presenter sync

The current live output model uses:

- `BroadcastChannel`
- `localStorage`

This keeps the control window and output window in sync inside one browser
environment without requiring a server push channel yet.

### Network TV output

The stable `/tv` display route (with `?presentation=tv` retained for
compatibility) is a passive, authenticated slideshow renderer for a television
browser. Public HTTP requests are upgraded by the browser bootstrap using the
client-visible URL, which avoids ambiguity across nested TLS-terminating proxies.
When the presenter selects **Start Slideshow**, the presenter control page
creates a server-authoritative output session. On a desktop it also opens the
local slideshow window; on a phone or tablet it only enables the network output.
The session remains active if controller tabs, local output windows, or TV
browsers close or become suspended. Another presenter can reconnect and stop it
explicitly, which causes open desktop output windows to close and TV browsers to
return to waiting. This avoids external-monitor wiring and allows multiple
passive displays without output-ownership conflicts. The TV uses a remembered,
least-privilege viewer session; browser fullscreen and autoplay still require
interaction on the television itself.

Identity accounts have a unique, lowercase username in addition to email.
Sign-in accepts either identifier, and remembered sessions include both
`Max-Age` and `Expires` for compatibility with older embedded browsers.

### Remote service viewer

The Broadcast area is viewer-first. Eligible users land on the viewer even when
they can edit its settings. An explicitly active slideshow output session normally
opens the gate for:

- the active service slideshow
- multiple named camera/stream sources with manual or synchronized weighted cross-fades; automatic pacing uses deterministic jitter and service-aware worship, prayer, sermon, and announcement profiles, with a lectern/pulpit bias
- audio from any configured camera, no audio, or a dedicated Raspberry Pi/desk stream

Administrators can also enable the camera and audio directly from the Livestream
tab without starting presentation output. They choose either a public stream,
visible to all eligible viewers, or an admin-only test stream. Manual mode persists
until an administrator stops it; admin-test state and live audio remain unavailable
to non-admin accounts. Without presentation output, the slide pane shows a live
holding card rather than inventing a slideshow state.

When neither presentation output nor a permitted manual stream is active, both panels remain disabled. During the configured
window before the next planned service, the page shows a starting-soon state and
can offer configured worship audio. Outside that window it clearly shows that no
service is streaming.

Viewer settings are stored in the database and edited from Broadcast Settings.
Camera sources are kept warm in layered players so switching uses an opacity
cross-fade instead of reconnecting. The camera gateway uses MSE over a proxied
WebSocket for low-latency playback, with native/HLS/MJPEG compatibility paths,
a stall watchdog, and automatic reconnection. Slide state is polled separately
at 500 ms and passes through a configurable delay so it can be aligned with the
camera pipeline.

Independent room-microphone and desk feeds can remain private HTTP MP3 inputs.
CSpot reconciles each configured input into go2rtc as an FFmpeg-backed AAC
stream, so viewers receive independent and camera audio through the same
fragmented-MP4 MSE path and HLS compatibility path. The source URL and any
listener token stay server-side. The authenticated raw API relay at
`/api/v1/broadcast/live-audio` remains available as a browser fallback; the
same raw upstream remains available to the sermon-recording pipeline. Raw MP3
is not the preferred desktop playback transport. The administrator's per-source
Listen preview uses the normalized transport as well when the gateway is
available.

Gateway entries owned by CSpot use opaque names in the reserved
`cspot-audio-*` namespace. Reconciliation creates or updates entries for the
currently configured independent sources and removes stale CSpot-owned entries.
It never treats the opaque name as a user-facing source ID and does not modify
operator-managed camera streams outside that namespace. Camera audio uses its
matching gateway source and stays independent of which camera is visible.
The public frontend proxy exposes only authenticated WebSocket and HLS playback
routes, checks requested source names against the configured camera/audio
allowlist, and returns 404 for go2rtc configuration, stream-inspection, log, and
restart endpoints. Independent input URLs are redacted from ordinary viewer
settings responses.
The optional CSpot Audio Bridge exposes multiple Windows DirectShow or Linux
ALSA inputs as on-demand, shared MP3 streams. Capture stops after the final
consumer disconnects, and the same bridge can move from a Windows church
desktop to a Raspberry Pi without changing the CSpot-side input protocol.
PTZ movement remains the camera's own patrol/tour responsibility; CSpot selects
and fades that moving view but does not store camera credentials or issue vendor-
specific movement commands.

Broadcast administration is divided into Recordings, Livestream, and Audio
Mixer tabs. Mixer settings store the shared desk identity, integration type,
control/bridge URL, and installation notes. Digital desks with their own web
interface can be opened directly; OSC/MIDI desks require a model-specific
bridge before native CSpot faders are exposed. An analogue desk can supply
audio through an aux/matrix output, class-compliant USB interface, and Raspberry
Pi, but its physical faders cannot be controlled digitally.

## Presenter Information Architecture

The current intended presenter layout has three roles:

### 1. Main preview

Shows the currently selected live slide and primary presentation controls.

### 2. Slide sorter

Shows thumbnails for slides and supports direct slide selection.

### 3. Section rail

Shows service structure and supports:

- section jump
- insert between sections
- reorder section
- remove section

## Search and Navigation

The presenter now includes search-driven insertion and Bible navigation.

### Search overlay

Hotkey: `s`

Search modes:

- Bible reference
- Bible keyword
- Songs
- Song lyrics are treated as canonical labelled parts. The presenter can expand
  slides from `Song.sequence`, so repeated choruses/verses do not need duplicated
  lyric text.
- Song saves canonicalize supported part labels, discard invalid or deprecated
  labels, and keep lyric and sequence verse numbers contiguous and aligned.
  Longer sequences retain their deliberate repeated-section arrangement, while
  shorter stale sequences are rebuilt from the current lyric structure.

### Keyboard behavior

- `Left` / `Right`: slide navigation
- `Up` / `Down`: slide navigation on normal slides
- `Up` / `Down` on reading slides: Bible verse navigation
- `F5`: start slideshow

## Architectural Strengths Right Now

- API startup repairs the required `Worship Set` reference plan type after
  migrations, protecting upgraded installations from incomplete seed data.
- Worship leader assignments are stored by service date independently of
  worship-set plans, allowing the calendar to schedule future leaders before
  any song set is created.
- Sermon recording stores compact Opus audio plus timestamped presentation
  transitions. Automatic start is edge-triggered by a non-sermon-to-sermon move
  while the output session is active; it does not restart a manually stopped
  recording on later sermon slides. A paused recording resumes on the next sermon
  slide. Leaving the sermon, reaching End, or closing output starts a persisted,
  configurable stop countdown (60 seconds by default); blanking never starts it.
  Returning to a sermon slide cancels the countdown and retains one continuous
  recording. If the countdown expires or End now is chosen, the grace audio is
  trimmed back to the departure point and the archive records the stop reason.
  Automatic captures shorter than 30 seconds are discarded after an automatic
  departure instead of being saved as false-positive sermon archives. A deliberate
  stop while still on the sermon retains even a short recording. Recorder transitions
  run on one background worker with a separate database session;
  stream probing and FFmpeg startup never block presenter API requests. Failed
  source probes enter a cooldown instead of retrying on every heartbeat. Automatic
  recording can be disabled persistently from Broadcast settings, preventing
  stream probes and recorder startup while leaving manual recording available.
  Audio timestamps are generated from emitted samples rather than the live
  source clock, so pausing FFmpeg cannot create an empty multi-hour seek range.
  Finalization probes the media duration and automatically rewrites discontinuous
  timestamps when it differs materially from the expected recording duration.
  Recording controls are hidden behind an off-by-default presenter toggle.
- Every service receives a final End slide. Presenter controls can start, pause,
  resume, and stop recording; moving to a new slide resumes a paused recorder.
  A visible presenter countdown protects brief worship/announcement detours and
  accidental slideshow closure without splitting the sermon archive.
  Broadcast settings can permanently remove completed archive entries and files.
- Presentation output ownership is server-authoritative and persists until an
  authorized presenter explicitly stops it. Stop works across devices, leaves a
  close marker so an older output client cannot reclaim the session, and is
  polled by desktop output windows so they close remotely. Legacy heartbeat-only
  sessions still expire during upgrades. Service-view `B` controls blanking and
  `F` toggles its locally opened output fullscreen.
- An empty worship set offers a five-song suggestion as its first list item.
  Populated rows expose a one-song swap action beside their edit, remove, and
  reorder controls; clicking the row expands or contracts its lyrics on mobile.
- Song-library and set rows show concise usage age and additive worship-slot
  tags. Opening, middle, and closing roles are learned only after the worship-set
  date has passed. Removing a learned role suppresses historical re-learning
  until the song later serves in that position again.
- General suggestions exclude Advent, Christmas, Lent, and Easter categories.
  The empty-set category selector can request themed or musical subsets, while
  recent swap rejections apply a decaying penalty to future suggestions.
- Changing a song's set key permanently transposes stored chord annotations;
  capo (0–5) changes display metadata only. Song saves stay in the editor with
  explicit Saved/Unsaved state, and song archiving requires confirmation.
- coherent modular monolith shape
- container-first local development
- real end-to-end vertical slices already exist
- presenter workflow is becoming product-centered instead of bolted on
- service content types are being differentiated more correctly

## Known Weaknesses Right Now

### 1. Slide-deck rendering fidelity

The current conversion path can disagree with PowerPoint in text placement,
alignment, or layout fidelity.

### 2. Presenter complexity in one component

`PresentationView.tsx` now holds a large amount of behavior and should likely be
split into smaller subcomponents once the presenter model stabilizes.

### 3. Mixed maturity across modules

Some modules are operational, while others are still scaffolds or partial
implementations.

## Near-Term Improvement Directions

1. Investigate higher-fidelity deck rendering options or stronger LibreOffice
   conversion settings.
2. Split presenter concerns into:
   - stage
   - section rail
   - slide sorter
   - insertion/search dialogs
   - Bible navigation/search
3. Continue converging planning and presenting into one service-builder
   experience.
4. Strengthen import workflows for songs, Bible data, and slide decks.
5. Add focused automated tests around presenter behavior and plan editing.
