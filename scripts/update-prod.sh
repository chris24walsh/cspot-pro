#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-auto}"

cd "$PROJECT_ROOT"

resolve_mode() {
  case "$MODE" in
    auto)
      if [[ -f ".env.npm" ]]; then
        echo "npm"
        return 0
      fi
      if [[ -f ".env.tailscale" ]]; then
        echo "tailscale"
        return 0
      fi
      echo ""
      return 0
      ;;
    npm|tailscale)
      echo "$MODE"
      return 0
      ;;
    *)
      echo "Unsupported mode: $MODE" >&2
      echo "Use: scripts/update-prod.sh [auto|npm|tailscale]" >&2
      exit 1
      ;;
  esac
}

ACTIVE_MODE="$(resolve_mode)"
if [[ -z "$ACTIVE_MODE" ]]; then
  echo "No production env file found." >&2
  echo "Expected one of: .env.npm or .env.tailscale" >&2
  echo "Run this script on the production host, or pass an explicit mode after creating the env file." >&2
  exit 1
fi

if [[ "$ACTIVE_MODE" == "npm" ]]; then
  COMPOSE_FILE="docker-compose.npm.yml"
  ENV_FILE=".env.npm"
else
  COMPOSE_FILE="docker-compose.tailscale.yml"
  ENV_FILE=".env.tailscale"
fi

echo "Updating production using $COMPOSE_FILE and $ENV_FILE"
git pull --ff-only
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
