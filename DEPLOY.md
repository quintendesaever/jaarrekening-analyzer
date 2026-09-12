# Production deployment (Docker Compose)

Repository: `quintendesaever/jaarrekening-analyzer`
Production branch: `main`
Deployment unit: **exact Git commit SHA**

This document describes how to build and run the application from a single
checked-out commit using Docker Compose. It does **not** itself deploy any host.

## Architecture

### Default (local-only)

```text
Host loopback only
  ↓
127.0.0.1:80 → Caddy
  ├── /           → static Vite SPA
  └── /api/*      → FastAPI (uvicorn) on app:8000
        ↓
Docker volume `ratios-data` → /data (ratios.yaml, tables.yaml, history)
```

`docker compose up -d` starts **`app` + `caddy` only**. Nothing is published on the
LAN, and **no Cloudflare tunnel is started**.

### Optional Quick Tunnel profile

```text
Internet
  ↓
Cloudflare Quick Tunnel (*.trycloudflare.com)  ← opt-in profile `tunnel`
  ↓
Docker network → caddy:80
  ↓
app:8000
```

Quick Tunnel is **not** authentication, access control, or a security boundary.
Anyone who learns the rotating URL can reach unauthenticated analyze endpoints
(subject only to in-memory rate limits). Prefer a future named/authenticated
Cloudflare tunnel or other access control for anything beyond a short demo.

Pinned tunnel image (deliberate upgrades only):

```text
cloudflare/cloudflared:2026.9.0@sha256:ff69a2225ad7c6f85ed84fbd5f3087df46202426b2388ec60214098e0adf05e9
```

Changing this pin is a deployment-definition change and should be reviewed.

| Service | Role | Default? |
|---------|------|----------|
| `app` | FastAPI / pdfplumber (internal `:8000`, non-root) | yes |
| `caddy` | SPA + `/api` proxy; host bind `127.0.0.1:80` | yes |
| `cloudflared` | Quick Tunnel → `http://caddy:80` | **profile `tunnel` only** |

PDF upload body limit: **20 MB** (Caddy `request_body` + backend checks).

## Secrets (never commit)

Copy `.env.example` to `.env` next to `docker-compose.yml`:

```bash
ADMIN_TOKEN=<random-secret>
# optional:
# CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `ADMIN_TOKEN` | For config writes | Header `X-Admin-Token` for live ratio/table edits |
| `CORS_ORIGINS` | No | Defaults cover Vite; production SPA is same-origin via Caddy |

Do **not** commit `.env`, Cloudflare credentials/tokens, or `ratios-data` contents.

## Persistent data (`ratios-data`)

Compose mounts named volume `ratios-data` at `/data` in `app`:

- `RATIOS_CONFIG_PATH=/data/ratios.yaml`
- `TABLES_CONFIG_PATH=/data/tables.yaml`

On **first** start only, bundled `backend/config/*.yaml` is seeded into the
volume. Later rebuilds **must not** wipe the volume.

```bash
# Safe: rebuild app, keep volume
docker compose up -d --build

# Destructive: wipes saved ratios/tables/history — avoid unless intentional
# docker compose down -v
```

The backend entrypoint adjusts `/data` ownership for the non-root app user
(`uid/gid 10001`) when the container starts as root, then drops privileges.

## Deploy an exact commit (manual procedure)

Documentation only — do not run this against production unless explicitly
approved in a separate task.

```bash
git clone https://github.com/quintendesaever/jaarrekening-analyzer.git
cd jaarrekening-analyzer
git checkout <EXACT_COMMIT_SHA>

cp .env.example .env
# edit .env — set ADMIN_TOKEN

docker compose build
```

### Local / default (no public tunnel)

```bash
docker compose up -d
```

### ProBook / Quick Tunnel parity (explicit opt-in)

```bash
docker compose --profile tunnel up -d
```

### Health verification

```bash
# Backend via Caddy on host loopback
curl -s http://127.0.0.1/api/health
# expect: {"status":"ok"}

docker compose ps
```

Success criteria for a future agent:

1. `app` is healthy; `caddy` is running
2. `GET http://127.0.0.1/api/health` → HTTP 200 `{"status":"ok"}`
3. With profile `tunnel`, `cloudflared` is running; without it, `cloudflared` is absent
4. Deployment metadata records repository + commit SHA

### Public URL (only with `--profile tunnel`)

```bash
docker compose --profile tunnel logs -f cloudflared
```

Look for `https://….trycloudflare.com`. Restarting `cloudflared` issues a **new**
URL. The URL is **not** a security control.

## Rate limiting and client IP

Analyze/config write routes are limited to **10 requests / 60 seconds per client
IP** (in-memory, single uvicorn process).

The backend does **not** trust client-supplied `X-Forwarded-For`. It prefers
`CF-Connecting-IP` (Cloudflare), then `X-Real-IP` (set by Caddy from that header),
then the direct peer. Caddy strips inbound `X-Forwarded-For` toward the app.

## Stop

```bash
docker compose down
# keeps ratios-data volume
# if the tunnel profile was used:
docker compose --profile tunnel down
```

## Notes for automation

- Build from the Git work tree at the pinned SHA (Compose `build:` targets).
- Default compose must remain local-only; never enable `tunnel` unless requested.
- Pin/bump `cloudflared` deliberately; do not return to `:latest`.
- Application images are built on the deployment host; CI image publishing is later.
- Prefer SSH keys for host access; do not put passwords in this repository.
- Do not open router ports; host Caddy is loopback-only.
