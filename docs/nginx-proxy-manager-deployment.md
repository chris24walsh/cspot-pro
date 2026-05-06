# Nginx Proxy Manager Deployment

This guide runs `cspot-pro` on a Docker host and exposes it through Nginx Proxy
Manager (NPM).

This is a good fit when:

- you already run Docker services on a Proxmox VM
- Nginx Proxy Manager is already handling your public HTTPS endpoints
- you want `cspot-pro` available over a normal domain/subdomain

## Architecture

- `web` serves the frontend and proxies `/api` internally to FastAPI
- `api` handles auth, plans, songs, presentation sync, and uploads
- `db` stores persistent app data
- Nginx Proxy Manager forwards external HTTPS traffic to the `web` container

Only the `web` port is exposed on the VM. `api` and `db` stay private on the
Docker network.

## Root Host vs Subpath

`cspot-pro` can now be deployed either:

- at the site root, such as `https://cspot.yourdomain.com/`
- or under a path, such as `https://apps.yourdomain.com/cspot/`

If you are using NPM **Custom Locations** under an existing shared hostname,
build the frontend with:

```yaml
args:
  VITE_API_BASE_URL: /api
  VITE_APP_BASE_PATH: /cspot/
```

That tells the frontend and bundled nginx config to serve the app under
`/cspot/`.

## 1. Prepare Environment

From the repo root:

```bash
cp .env.npm.example .env.npm
```

Edit `.env.npm` and set:

- `POSTGRES_PASSWORD`
- `AUTH_SECRET_KEY`
- `API_CORS_ORIGINS`

Example:

```env
APP_ENV=production
APP_NAME=cspot-pro
API_CORS_ORIGINS=https://cspot.yourdomain.com

POSTGRES_DB=cspot
POSTGRES_USER=cspot
POSTGRES_PASSWORD=replace-with-a-long-random-password
DATABASE_URL=postgresql+psycopg://cspot:replace-with-a-long-random-password@db:5432/cspot

AUTH_SECRET_KEY=replace-with-a-long-random-secret
SESSION_COOKIE_SECURE=true
```

## 2. Start the App

From the repo root:

```bash
docker compose -f docker-compose.npm.yml up -d --build
```

Check status:

```bash
docker compose -f docker-compose.npm.yml ps
docker compose -f docker-compose.npm.yml logs -f api web
```

The app will now be listening on:

```text
http://YOUR-VM-IP:8080
```

If you are deploying under `/cspot/`, make sure the `web` service build args
include:

```yaml
args:
  VITE_API_BASE_URL: /api
  VITE_APP_BASE_PATH: /cspot/
```

## 3. Configure Nginx Proxy Manager

Create a new Proxy Host:

- **Domain Names**: `cspot.yourdomain.com`
- **Scheme**: `http`
- **Forward Hostname / IP**: your Docker VM IP
- **Forward Port**: `8080`

Recommended options:

- Enable **Block Common Exploits**
- Enable **Websockets Support**

SSL tab:

- Request a new Let's Encrypt certificate
- Enable **Force SSL**
- Enable **HTTP/2 Support**

No custom locations should be required.

### If You Are Using a Shared Hostname

If your Funnel/NPM setup already uses a shared hostname such as
`apps.bee-gopher.ts.net`, then:

1. Keep the main proxy host pointed at Home Assistant (or whatever owns `/`)
2. Open the **Custom Locations** tab
3. Add:
   - **Location**: `/cspot`
   - **Scheme**: `http`
   - **Forward Hostname / IP**: your Docker VM IP
   - **Forward Port**: `8080`

The `cspot-pro` frontend must be built with `VITE_APP_BASE_PATH: /cspot/` for
this to work correctly.

## 4. First Login

Open:

```text
https://cspot.yourdomain.com
```

If there is no administrator yet, `cspot-pro` will show the first-admin
bootstrap flow. Create your real admin account there.

This deployment does **not** create the old demo admin user at startup.

## 5. Updating

```bash
git pull
docker compose -f docker-compose.npm.yml up -d --build
```

## 6. Stopping

```bash
docker compose -f docker-compose.npm.yml down
```

This keeps the database and file storage volumes intact.

## Merging Into an Existing Compose Stack

If you already have a compose file for other services on the same VM, you can
copy the `api`, `web`, and `db` services from `docker-compose.npm.yml` into
that file.

Key points:

- Keep `web` exposed on a single host port, for example `8080:80`
- Do **not** expose `api` or `db`
- Keep the named volumes for Postgres and storage
- Use an env file such as `.env.npm`

If one of your other services already uses port `8080`, change the `web` port
mapping to another free host port, such as `8081:80`, and point NPM at that
port instead.
