#!/usr/bin/env bash
set -euo pipefail

COMPOSE_BIN="${COMPOSE_BIN:-/home/chwalsh/.docker/cli-plugins/docker-compose}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -x "$COMPOSE_BIN" ]]; then
  echo "Compose v2 binary not found at $COMPOSE_BIN" >&2
  echo "Install it or set COMPOSE_BIN to the compose executable path." >&2
  exit 1
fi

cd "$PROJECT_ROOT"

"$COMPOSE_BIN" up --build -d
"$COMPOSE_BIN" ps
