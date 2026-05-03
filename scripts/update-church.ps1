$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Test-Path ".env.church")) {
    Write-Error ".env.church not found. Copy .env.church.example to .env.church first."
}

git pull --ff-only
docker compose -f docker-compose.church.yml --env-file .env.church up -d --build
docker compose -f docker-compose.church.yml --env-file .env.church ps
