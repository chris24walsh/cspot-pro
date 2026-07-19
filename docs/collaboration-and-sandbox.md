# Collaboration and remote sandbox workflow

This workflow keeps `main` releasable and gives contributors a safe place to
exercise complete features, including migrations, from a phone or remote device.
Sandbox data and storage are never shared with production.

## GitHub repository settings

Configure a branch ruleset for `main` in GitHub:

- require a pull request with at least one approval;
- require conversation resolution;
- require the `frontend` and `backend` status checks;
- require branches to be up to date before merge;
- block force pushes and branch deletion;
- allow squash merge and automatically delete merged branches;
- include administrators, while retaining an emergency bypass role.

Use short-lived branches named `feature/<topic>`, `fix/<topic>`, or
`docs/<topic>`. Prefer squash merge. Never develop directly against the
production checkout or database.

## One-time sandbox host setup

Use a Linux host or VM with Docker Compose, Git, and Tailscale. It may share a
physical machine with production only if it has a separate checkout, ports,
Compose project, volumes, credentials, and backup policy.

```bash
git clone https://github.com/chris24walsh/cspot-pro.git cspot-pro-sandbox
cd cspot-pro-sandbox
cp .env.sandbox.example .env.sandbox
```

Replace every placeholder and set the public URL variables to the Tailscale
HTTPS URL. Do not copy production secrets. Then:

```bash
git switch feature/example
scripts/sandbox.sh up
scripts/sandbox.sh url
sudo tailscale serve --bg --https=8443 http://127.0.0.1:18080
```

Open `https://<sandbox-machine>.<tailnet>.ts.net:8443` from a phone connected to
the same tailnet. The container port stays on localhost, making Tailscale the
access boundary. Do not use Tailscale Funnel for this environment.

Tailscale Serve configuration is host-wide. Use dedicated HTTP/HTTPS ports and
`COMPOSE_PROJECT_NAME` values for concurrent sandboxes, or deploy one branch at
a time to a shared integration sandbox.

## Daily feature workflow

```bash
git fetch origin
git switch feature/example
git pull --ff-only
scripts/sandbox.sh up
scripts/sandbox.sh logs web
```

`down` preserves data. To intentionally erase only this sandbox's volumes:

```bash
scripts/sandbox.sh reset --confirm-reset
```

After merging, deploy `main` through the normal production process. A passing
sandbox is review evidence, not authority to deploy automatically.

## Safety boundaries

- Use synthetic accounts and content only.
- Disable SMTP and external integrations by default.
- Never restore production data into a contributor-accessible sandbox.
- Never expose the development stack or PostgreSQL port to the internet.
- Review migrations and their production rollback impact.
