# cspot-pro

Modern reimplementation of c-SPOT, the church service online planning tool.

This repository is intentionally separate from the legacy Laravel application in
`../cspot`. The old project remains the reference for behaviour, data model, and
migration planning; this project starts clean with a container-first stack.

## Stack

- Backend: Python, FastAPI, Pydantic settings
- Frontend: React, TypeScript, Vite
- Database: PostgreSQL
- Runtime: Docker Compose for local development
- Auth: cookie-based sessions with backend-enforced RBAC
- Tests: pytest for backend, browser tests to follow once flows exist

## Live audio

CSpot can take live and recorded service audio from the portable
[CSpot Audio Bridge](audio-bridge/README.md), with independent USB microphone
and mixing-desk inputs on Windows or Raspberry Pi. A Windows playback-loopback
or virtual-cable source can add church-PC media to the server-side source mix.
Five presentation-aware scenes keep Pastor, Congregation, and Worship on the
desk/room feeds while Media and Pre-service use the direct media feed as a
mix-minus, excluding the desk return and room microphone. That avoids sending
the same PC playback both directly and back through the desk, and makes the
media route independent of the desk's audio signal. The bridge only captures a
Windows endpoint: a browser or other designated player must still render audio
to that endpoint. Song backing tracks deliberately remain on the Worship/desk
route so the livestream keeps the live musicians and vocals and receives the
PC track once through the desk return; standalone video uses the direct Media
route.

Configured pre-service music remains a transitional remote-viewer player rather
than a server-mix input, particularly for YouTube sources. In remote-only mode,
the presentation-output copy stays muted so musicians can rehearse through the
desk without hearing the online pre-service track. The original
[single-input Pi/Icecast setup](docs/raspberry-pi-live-audio.md) remains
supported. Independent HTTP/MP3 inputs are normalized to AAC by go2rtc for the
same fragmented-MP4 MSE/HLS browser transport used by camera audio. Real
multi-input or gain-adjusted mixes use an authenticated 200 ms fragmented-AAC
stream with a bounded browser buffer and MP3 fallback; the raw relay remains
available for compatibility and recording.

## Network TV display

The live slideshow can run directly in a
[church TV's native browser](docs/tv-browser-display.md), following a presenter
over the server without an HDMI cable or extended desktop. Use the short
`/app/tv` production route; public HTTP visits are upgraded to HTTPS. Once the
presenter selects **Start**, the TV output remains active until a presenter
stops it or starts another service. Only one service can be live system-wide,
and unclosed past-service sessions are expired by the following day.

## Local Development

Copy the environment file:

```bash
cp .env.example .env
```

Start the stack:

```bash
docker compose up --build
```

If your Docker install uses the older standalone Compose command, use:

```bash
docker-compose up --build
```

Older `docker-compose` 1.x can throw a Python `KeyError: 'id'` from its attached
log watcher even while the containers keep running normally. If you see that,
use detached mode and follow logs separately:

```bash
docker-compose up --build -d
docker-compose logs -f api web
```

`docker-compose` 1.x can also throw `KeyError: 'ContainerConfig'` when recreating
containers with newer Docker image metadata. The best fix is to install/use
Compose v2 (`docker compose`). If you must stay on Compose v1, recreate the app
containers without deleting volumes:

```bash
sudo docker-compose up --build --force-recreate
```

Avoid `docker-compose down -v` unless you intentionally want to delete the local
database volume.

If Compose v2 is installed as a user-level plugin but your user cannot access
the Docker socket yet, start the app with:

```bash
sudo ./scripts/start-app.sh
```

This runs `up --build -d` and does not delete volumes.

On startup, the API container runs database migrations, seeds reference data, and then
starts FastAPI.

Fresh installs now use first-admin bootstrap instead of a shared demo password.
Open the web app, create the first administrator account, and then invite the
rest of the team from the Admin screen.

For the current frontend wireframe only:

```bash
npm install
npm run dev
```

Services:

- API: http://localhost:8000
- API docs: http://localhost:8000/docs
- Web app: http://localhost:5173
- Postgres: localhost:5432

## Church Windows Deployment

For the simplest real-world deployment right now, run `cspot-pro` directly on
the church Windows PC with Docker Desktop.

See:

- [docs/windows-church-deployment.md](docs/windows-church-deployment.md)

Key files:

- `docker-compose.church.yml`
- `.env.church.example`
- `scripts/start-church.ps1`
- `scripts/update-church.ps1`
- `scripts/stop-church.ps1`

## Home Tailscale Deployment

For the best first shared-host setup, run `cspot-pro` on an always-on home
machine and publish it privately with Tailscale Serve.

See:

- [docs/tailscale-home-deployment.md](docs/tailscale-home-deployment.md)

Key files:

- `docker-compose.tailscale.yml`
- `.env.tailscale.example`

## Nginx Proxy Manager Deployment

If you already run a Docker VM and expose apps through Nginx Proxy Manager,
`cspot-pro` can also be deployed that way behind your normal domain/subdomain.

See:

- [docs/nginx-proxy-manager-deployment.md](docs/nginx-proxy-manager-deployment.md)

Key files:

- `docker-compose.npm.yml`
- `.env.npm.example`

## Public Website

The Listowel Christian Fellowship public website is kept in a separate private
repository so church-specific content and images do not have to live in this
open-source app repository.

Private website repo:

- <https://github.com/chris24walsh/lcf-website>

`cspot-pro` still exposes the generic site-content API used by the private site
for logged-in admin editing:

- `GET /api/v1/site/content`
- `GET /api/v1/site/content/admin`
- `PATCH /api/v1/site/content/{key}`

When building the member app, set `VITE_PUBLIC_WEBSITE_URL` to the public site
URL if the Website shortcut should link back there, for example:

```bash
VITE_PUBLIC_WEBSITE_URL=https://lcf.walsh.qzz.io
```

Pull requests are checked automatically. For production-like testing from a
remote device, use the isolated Tailscale sandbox described in
[docs/collaboration-and-sandbox.md](docs/collaboration-and-sandbox.md).

Run the checks:

```bash
npm run check
docker compose run --rm api pytest
```

## Project Layout

```text
backend/     FastAPI app, domain modules, backend tests
frontend/    React app
docs/        decision records and architecture notes
docker/      shared container/database setup
```

## Current Build Shape

The first scaffold covers the major legacy c-SPOT domains:

- `identity`: users, roles, permissions, social login records
- `planning`: plans, running-order items, defaults, notes, history, caches
- `music`: songs, lyrics, chords, song parts, OnSong sections
- `people`: instruments, team assignments, availability/confirmation
- `library`: resources, files, file categories, Bible data
- `presentation`: presenter sessions and sync position
- `communication`: message threads, participants, reminders/notifications
- `imports`: review-first content and lyrics import workflows
- `sunday_school`: date-based lesson preparation for Sunday School cover

See [docs/legacy-feature-map.md](docs/legacy-feature-map.md) for the rebuild
coverage map. For durable product and architecture context, also see:

- [docs/project-context.md](docs/project-context.md)
- [docs/current-architecture.md](docs/current-architecture.md)
- [docs/security-todo.md](docs/security-todo.md)
- [AGENTS.md](AGENTS.md)

The first persistent slice is now in place for:

- plan types
- plans
- running-order plan items
- songs
- song parts
- users and roles
- team assignments and instruments
- resources and plan resource assignments
- messages and replies
- manual lyrics import
- Bible version/book/passage lookup

The frontend reads those live API endpoints when FastAPI is available and falls
back to the static wireframe data when it is not.

## Working Screens

- Service: use an endlessly extending, month-grouped all-days timeline (or switch to a compact Sunday-only timeline), and use the adjacent arrows to move between actual planned-service dates rather than fixed weekly offsets. Every selected date opens immediately as an empty durable plan: Sundays default to Sunday Service and other days to Midweek Meeting. The applicable outline is added only with the first explicit set, deck, or content item. Archiving preserves the date slot by replacing its content with a fresh empty plan, with Undo still available. The compact type control on an existing service can correct its type while preserving content and adding missing sections. Administrators manage service types in the dedicated Service templates tab, including nested default items and one automated template start. Template items and direct service editors share visual, timing, overlay, scene, and destination settings; administrator-only controls can promote reusable defaults. A section can auto-contract its items or end the service after its final timed slide. Outline sections are compact colour-coded containers which can contain several named, locally reorderable items such as sermon decks, announcement images, videos, or decks; groups reorder only among groups. Each child item is independently expandable in the rail and sorter. Section and item pencils open scoped native editors: section images act as fallback content only while no children exist, songs route to the song editor, Welcome/Open time support timed overlays and montage controls, Announcements store structured event details, and sermon decks expose presentation-safe fit/transition controls. One group-level add button opens the item dialog, defaults Sermon and Announcements to Slide Deck, and includes an Images tab for creating one sortable item from one or more uploaded images. Presenters cannot move or remove template outline groups. The seeded Sunday template runs a 25-minute Welcome montage and five-minute countdown before selecting Please be seated, with no separate automation clock for each cue. Its Post-service montage selects a room-enabled ambiance scene. Administrators can use the Start menu to rehearse or stop the service flow on demand.
- Edit history uses the same interaction in Service, Worship, and Sunday School: selecting the body of a version restores that complete point in time after confirmation, while the separate Undo change action reverses only that entry and preserves unrelated later edits. Song edits store field-level snapshots for per-change undo; archive actions offer an immediate restore.
- Worship and Sunday School: Sunday cards show compact plan/lesson summaries and use capacity-aware leader rotations for current and future dates, while historical assignments remain unchanged; assignment and upcoming-Sunday swaps stay behind the compact Leader control, and the `cspot_tablet` account remains available for manual worship assignment but is excluded from automatic rotation
- Songs: create/edit/archive songs, import and clean lyrics, edit details/chords, and prepare song slides
- Broadcast: viewer-first remote service page plus admin tabs for sermon recordings, low-latency multi-camera livestream settings, and shared mixer-desk integration; admins can blend independent audio sources with per-feed trim/mute controls and presentation-aware Pastor, Congregation, Worship, Media, and Pre-service scenes shared by livestream and recording, start a public or admin-only test livestream, and operate synchronized slides, service-aware weighted camera pacing, automatic stream recovery, holding messages, and pre-service audio. An open TV or livestream viewer activates scheduled pre-service at 10:30 without starting the main slideshow; starting or stopping the slideshow keeps the currently selected slide visible rather than blanking the output.
- Admin: share an optional self-registration link/QR code, approve or reject inactive registration requests, invite users, send password resets, manage grouped roles and rotation eligibility, configure Google Drive, and test SMTP email

## Access Control

`cspot-pro` now supports:

- first-admin bootstrap for empty installs
- password login
- invite-based account setup with one-time links
- forgot-password email reset links
- cookie-backed sessions that work with presenter/live-output windows
- backend-enforced permissions for read, edit, create, and admin actions

Public hosting should still set a strong `AUTH_SECRET_KEY`, run behind HTTPS,
turn on secure cookies, and configure `PUBLIC_APP_URL` so invite/reset links
point back to the correct host. SMTP is optional but recommended; Brevo,
Mailtrap, or any normal SMTP relay can be used.

## Reference Project

Legacy clone:

```text
../cspot
```

Current legacy stack summary:

- Laravel/PHP application
- Blade-rendered views
- MySQL/MariaDB data store
- Bootstrap-era frontend
- Existing Dockerfile based on Ubuntu 16.04/LAMP
- Core domains: users, roles, plans, plan items, songs, teams, resources, files,
  Bible passages, messages, presentation sync, and OnSong support

## Initial Product Goals

- Plan church services, events, running orders, teams, resources, songs, notes,
  lyrics, chords, files, and presentation views.
- Keep the system portable through containers and reproducible local
  development.
- Make future features easy to add through clear module boundaries.
- Improve visual design, responsiveness, accessibility, and perceived
  performance.
- Support safe import workflows for song metadata and lyrics, with source
  provenance and licensing/status recorded alongside imported content.
