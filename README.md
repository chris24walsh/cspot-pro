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

On startup, the API container runs database migrations, seeds demo data, and then
starts FastAPI.

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

- Plans: create/edit/archive plans, add/edit/remove running-order items, link songs
- Songs: create/edit/archive songs, edit lyrics/chords
- Team: assign/remove people to plans, set role, instrument, and status
- Library: create/edit/remove resources, attach/remove resources on plans, look up Scripture
- Present: dark projector-style plan preview with previous/next controls
- Messages: create/delete threads and send replies
- Imports: paste/review/save lyrics into new or existing songs
- Admin: create/edit/deactivate users and assign roles

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
