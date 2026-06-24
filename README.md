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

- Service: choose/create/archive services, build the running order, add songs, Bible passages, and slide decks, and control the live output
- Songs: create/edit/archive songs, import and clean lyrics, edit details/chords, and prepare song slides
- Broadcast: viewer-first remote service page with live slides and an external camera feed; trusted users configure stream details, holding messages, and pre-service audio
- Admin: invite users, send password resets, deactivate/reactivate accounts, assign roles, and test SMTP email

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
