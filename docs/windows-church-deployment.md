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
- built-in cookie-based user authentication and RBAC

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

## Optional live-audio bridge

Use the [CSpot Audio Bridge](../audio-bridge/README.md) when this computer also
provides room-microphone, desk-return, or direct PC-media feeds to livestream and
recording. Configure all three as separate CSpot sources with the matching
`room`, `desk`, and `media` roles. The scene mixer then keeps normal speech and
worship on desk/room inputs and uses direct PC media as a mix-minus for Media and
Pre-service.

The standard bridge installer creates a current-user logon task. That is the
recommended starting point because DirectShow behavior varies by driver. A
limited S4U boot task using `C:\ProgramData\CSpotAudioBridge` has been verified
on the current church desktop and is documented as an optional pattern in the
bridge guide. Adopt it only after a no-login reboot test proves every configured
source. Do not treat a healthy headless capture process as a media player: a
designated browser or other process must still render program audio to the
default physical Windows output captured by WASAPI loopback, or to an
intentionally isolated virtual-cable render endpoint.

## Notes

- This setup is fine for internal use on the church machine.
- If you later expose it publicly, set a strong `AUTH_SECRET_KEY`, enable
  HTTPS, and set the session cookie to secure mode.
- If Windows blocks port 80, free that port or remap the `web` service in
  `docker-compose.church.yml`.
