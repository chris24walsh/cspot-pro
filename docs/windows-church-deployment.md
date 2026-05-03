# Windows Church Deployment

This guide is the simplest supported deployment path for running `cspot-pro`
directly on the church Windows computer.

## Deployment Model

- Windows machine at church
- Docker Desktop
- Docker Compose
- Local PostgreSQL container with persistent named volume
- Local file storage volume for uploaded files and rendered slide images
- Frontend served through nginx on port 80
- Backend reachable internally through nginx at `/api`

This is intentionally simple and cheap:

- no cloud bill
- no separate managed database
- no object storage setup
- no authentication layer yet

## Install Prerequisites

1. Install Docker Desktop
2. Install Git for Windows
3. Clone this repository onto the church machine

## First-Time Setup

From the repo root:

1. Copy `.env.church.example` to `.env.church`
2. Change `POSTGRES_PASSWORD`
3. Make sure the matching password is also in `DATABASE_URL`

Example:

```powershell
Copy-Item .env.church.example .env.church
```

## Start The App

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-church.ps1
```

Then open:

```text
http://localhost
```

## Update To Latest GitHub Version

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-church.ps1
```

This does:

- `git pull --ff-only`
- rebuild containers
- restart the stack

## Stop The App

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-church.ps1
```

## Persistence

The deployment keeps state in Docker named volumes:

- Postgres data
- uploaded files
- rendered sermon/slide-deck images

That means new plans, users, songs, uploads, and rendered slides persist across
restarts and updates.

## Notes

- This setup is fine for internal use on the church machine.
- If you later expose it publicly, add authentication and a reverse-proxy/TLS
  layer first.
- If Windows blocks port 80, free that port or remap the `web` service in
  `docker-compose.church.yml`.
