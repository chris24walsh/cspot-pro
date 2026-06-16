#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-plex}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/chris/plex}"
REMOTE_REPO="${REMOTE_REPO:-$REMOTE_ROOT/cspot-pro}"

ssh "$SSH_HOST" "
  set -euo pipefail
  cd '$REMOTE_REPO'
  git pull --ff-only
  cd '$REMOTE_ROOT'
  docker compose up -d --build cspot-api cspot-web
  docker compose ps cspot-api cspot-web cspot-db
"
