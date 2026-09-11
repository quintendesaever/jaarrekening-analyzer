# Production deployment (Docker Compose)

Repository: `quintendesaever/jaarrekening-analyzer`
Production branch: `main`
Deployment unit: **exact Git commit SHA**

This document describes how to build and run the application from a single
checked-out commit using Docker Compose. It mirrors the architecture that has
been running on the home ProBook host. It does **not** itself deploy to that
host.

## Architecture

```text
Internet
  ↓
Cloudflare Quick Tunnel (cloudflared, outbound-only)
  ↓
Caddy (:80)
  ├── /           → static Vite SPA
  └── /api/*      → FastAPI (uvicorn) on app:8000
        ↓
Docker volume `ratios-data` → /data (ratios.yaml, tables.yaml, history)
```

| Service | Role |
|---------|------|
| `app` | FastAPI / pdfplumber analysis (internal `:8000`) |
| `caddy` | Static SPA + `/api` reverse proxy; host publishes `:80` |
| `cloudflared` | Quick Tunnel → `http://caddy:80` (URL rotates on restart) |

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

Do **not** commit:

- `.env`
- Cloudflare tunnel tokens / credentials
- contents of the `ratios-data` volume

Cloudflare Quick Tunnel here uses `cloudflared tunnel --url` (no token file in
this repo). A future named tunnel would keep credentials **outside** Git.

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

Live edits in the UI (**Ratio-configuratie** / **Tabellen configuratie** →
**Opslaan**) update the volume only; they do not require a Git change.

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
docker compose up -d
```

### Health verification

```bash
# Backend via Caddy (preferred on the host)
curl -s http://127.0.0.1/api/health
# expect: {"status":"ok"}

# Containers
docker compose ps
```

A future deployment agent should treat success as:

1. `docker compose ps` shows `app`, `caddy`, and `cloudflared` running
2. `GET /api/health` returns HTTP 200 with `{"status":"ok"}`
3. Recorded deployment metadata includes repository + commit SHA

### Public URL (Quick Tunnel)

```bash
docker compose logs -f cloudflared
```

Look for `https://….trycloudflare.com`. Restarting `cloudflared` issues a **new** URL.

## Rate limiting

`POST /api/analyze`, `POST /api/ratios/parse`, `PUT /api/ratios`, reset and
history restore are limited to **10 requests / 60 seconds per client IP**
(in-memory, single uvicorn process).

## Stop

```bash
docker compose down
# keeps ratios-data volume
```

## Notes for automation

- Build from the Git work tree at the pinned SHA (Compose `build:` targets).
- Do not rely on unversioned copies of source on the server.
- Application images are built on the deployment host; CI image publishing is a later improvement.
- Prefer SSH keys for host access; do not put passwords in this repository.
- Do not open router ports for this stack; the tunnel is outbound-only.
