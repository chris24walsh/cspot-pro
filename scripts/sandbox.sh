#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

if [[ ! -f .env.sandbox ]]; then
  echo "Missing .env.sandbox. Copy .env.sandbox.example and replace every placeholder." >&2
  exit 1
fi
if grep -q 'replace-with-' .env.sandbox; then
  echo ".env.sandbox still contains placeholder secrets." >&2
  exit 1
fi

branch="$(git branch --show-current 2>/dev/null || true)"
slug="$(printf '%s' "${branch:-detached}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-32)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-cspot-sandbox-${slug:-detached}}"
compose=(docker compose --env-file .env.sandbox -f docker-compose.sandbox.yml)
command="${1:-help}"

case "$command" in
  up) "${compose[@]}" up -d --build; "${compose[@]}" ps ;;
  down) "${compose[@]}" down ;;
  reset)
    echo "Refusing to erase sandbox data without --confirm-reset." >&2
    [[ "${2:-}" == "--confirm-reset" ]] || exit 1
    "${compose[@]}" down --volumes
    ;;
  logs)
    if [[ -n "${2:-}" ]]; then
      "${compose[@]}" logs -f --tail=200 "$2"
    else
      "${compose[@]}" logs -f --tail=200
    fi
    ;;
  ps|status) "${compose[@]}" ps ;;
  url)
    http_port="$(sed -n 's/^SANDBOX_HTTP_PORT=//p' .env.sandbox | tail -1)"
    https_port="$(sed -n 's/^SANDBOX_HTTPS_PORT=//p' .env.sandbox | tail -1)"
    echo "Host-only: http://127.0.0.1:${http_port:-18080}"
    echo "Tailscale: tailscale serve --bg --https=${https_port:-8443} http://127.0.0.1:${http_port:-18080}"
    ;;
  *) echo "Usage: scripts/sandbox.sh {up|down|reset --confirm-reset|logs [service]|status|url}" ;;
esac
