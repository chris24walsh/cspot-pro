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
When the presenter selects **Start TV**, the
presenter control page owns and refreshes the server-authoritative output
heartbeat while the TV discovers the active service and polls its live slide
state. This avoids external-monitor wiring and allows multiple passive displays
without output-ownership conflicts. The TV uses a remembered, least-privilege
viewer session; browser fullscreen and autoplay still require interaction on
the television itself.

Identity accounts have a unique, lowercase username in addition to email.
Sign-in accepts either identifier, and remembered sessions include both
`Max-Age` and `Expires` for compatibility with older embedded browsers.

### Remote service viewer

The Broadcast area is viewer-first. Eligible users land on the viewer even when
they can edit its settings. A current slideshow output heartbeat is the gate for:

- the active service slideshow
- one externally configured camera or stream URL
- an optional dedicated Raspberry Pi or desk audio stream

When the heartbeat is absent, both panels remain disabled. During the configured
window before the next planned service, the page shows a starting-soon state and
can offer configured worship audio. Outside that window it clearly shows that no
service is streaming.

Viewer settings are stored in the database and edited from Broadcast Settings.
The camera and optional pre-service audio are loaded directly by the browser.
Dedicated live audio is relayed through the API so a private Pi/Icecast source
can be used from an HTTPS deployment. Video is not proxied, keeping the heavier
streaming load away from the core service planning process.

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
  while the output heartbeat is live; it does not restart a manually stopped
  recording on later sermon slides. A paused recording resumes on the next sermon
  slide, and leaving the sermon or closing output always stops it. Recording
  controls are hidden behind an off-by-default presenter toggle.
- Every service receives a final End slide. Presenter controls can start, pause,
  resume, and stop recording; moving to a new slide resumes a paused recorder.
  Broadcast settings can permanently remove completed archive entries and files.
- Presentation output ownership is server-authoritative and polled by the service
  view. An authorized close works across devices and leaves a close marker so the
  former output cannot reclaim itself with a late heartbeat. Service-view `B`
  controls blanking and `F` toggles its locally opened output fullscreen.
- Worship-set suggestions are edited inline: an empty set is seeded with five
  songs, while populated sets replace only checked rows. Each row exposes its
  position, rotation age, and a one-song regenerate action.
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
