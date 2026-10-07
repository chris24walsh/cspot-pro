# Tailscale Home Deployment

This guide runs `cspot-pro` on an always-on home machine and makes it available
privately over your Tailscale tailnet.

This is the recommended first real hosting mode for `cspot-pro`:

- persistent database and uploads
- multiple real users
- HTTPS access
- no router port forwarding
- not exposed to the public internet

## Recommended Host

Use a Linux box that is:

- always on
- already running Docker reliably
- able to run Tailscale

A general-purpose home server, mini PC, NUC, or Linux VM is a better fit than a
tightly managed appliance. If your Home Assistant machine is really a normal
Docker-capable Linux host, it can work well.

## What This Deployment Does

- Postgres runs in Docker and stores app state persistently.
- FastAPI runs in Docker and is not exposed directly on the LAN.
- The frontend is built and served by nginx in Docker.
- nginx is bound only to `127.0.0.1:8080` on the host.
- Tailscale Serve exposes that local web service privately to your tailnet.

The resulting user flow is:

1. User signs in to Tailscale.
2. User opens your `cspot-pro` Tailscale URL.
3. User signs in to `cspot-pro`.

## 1. Prepare Environment

From the repo root:

```bash
cp .env.tailscale.example .env.tailscale
```

Edit `.env.tailscale` and set:

- `POSTGRES_PASSWORD`
- `AUTH_SECRET_KEY`
- `API_CORS_ORIGINS`
- `PUBLIC_APP_URL`

Use a long random value for both secrets.

Example:

```env
APP_ENV=production
APP_NAME=cspot-pro
API_CORS_ORIGINS=https://your-hostname.your-tailnet.ts.net

POSTGRES_DB=cspot
POSTGRES_USER=cspot
POSTGRES_PASSWORD=replace-with-a-long-random-password
DATABASE_URL=postgresql+psycopg://cspot:replace-with-a-long-random-password@db:5432/cspot

AUTH_SECRET_KEY=replace-with-a-long-random-secret
SESSION_COOKIE_SECURE=true
```

If you want to import sermon decks directly from a shared Google Drive account,
also set:

```env
GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_DRIVE_PROJECT_NUMBER=your-google-cloud-project-number
```

Enable both the Google Drive API and YouTube Data API v3 for that Google Cloud
project. The connection requests read-only Drive and YouTube scopes. Reconnect
Google from Admin after upgrading an existing installation so the new YouTube
scope is granted.

The Google OAuth callback URL will be:

```text
https://your-hostname.your-tailnet.ts.net/api/v1/integrations/google-drive/callback
```

## 2. Start the App

From the repo root:

```bash
docker compose -f docker-compose.tailscale.yml up -d --build
```

Check that the containers are healthy:

```bash
docker compose -f docker-compose.tailscale.yml ps
docker compose -f docker-compose.tailscale.yml logs -f api web
```

The web app should now be reachable only on the host itself:

```text
http://127.0.0.1:8080
```

## 3. Put Tailscale in Front

Install and sign in to Tailscale on the host machine first.

Then publish the app privately to your tailnet:

```bash
sudo tailscale serve --bg http://127.0.0.1:8080
```

Check status:

```bash
tailscale serve status
```

You should get a private Tailscale HTTPS URL that looks like:

```text
https://your-hostname.your-tailnet.ts.net
```

## 4. First Login

Open the Tailscale URL in a browser on a device that is logged in to your
tailnet.

If there is no existing administrator, `cspot-pro` will offer the first-admin
bootstrap screen. Create your real admin account there.

Unlike the church demo deployment, this home/Tailscale deployment does **not**
create a demo admin user on startup.

## 5. Invite Other Church Users

You have two layers of access:

1. Tailscale access to the service
2. `cspot-pro` user accounts and roles

Recommended rollout:

1. Invite trusted church users to Tailscale first.
2. Create `cspot-pro` accounts for them.
3. Give them the lowest useful role in the app.

## Updating

From the repo root:

```bash
git pull
docker compose -f docker-compose.tailscale.yml up -d --build
```

## Stopping

```bash
docker compose -f docker-compose.tailscale.yml down
```

This keeps your database volume intact.

If you also want to stop publishing through Tailscale:

```bash
tailscale serve off
```

## Notes

- This is a **private** deployment. It is meant for Tailscale users only.
- This is safer than exposing the app directly on the public internet.
- If you later want public hosting, harden the auth/session story further and
  then consider a public reverse proxy, cloud host, or Tailscale Funnel.

## Production ONVIF access to the church

`apps-host` accepts Tailscale subnet routes (`sudo tailscale set --accept-routes=true`).
The church PC `DESKTOP-F8JCJEV` advertises `192.168.4.0/24`; it must remain online
for the API to reach the Imou at `192.168.4.14:80`. ONVIF authentication and
continuous-pan discovery were verified from the production API container.

The home LAN is also advertised by another Tailscale peer. To keep local camera
relay traffic direct, `/etc/systemd/system/cspot-local-lan-routing.service` installs
priority-5200 rules looking up the main routing table for the local IPv4 subnet
and IPv6 prefix, ahead of Tailscale's priority-5270 rule. The service is enabled
at boot; its source is `deploy/network/cspot-local-lan-routing.service`.

Verify with `ip route get 192.168.4.14` (Tailscale) and
`ip route get 192.168.2.208` (eth0). To undo, first run
`sudo tailscale set --accept-routes=false`, then
`sudo systemctl disable --now cspot-local-lan-routing.service`.
