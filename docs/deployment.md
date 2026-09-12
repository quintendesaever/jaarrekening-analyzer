# Jaarrekening Continuous Delivery

Same Dev Flow as Clippy: CI → GHCR SHA images → Tailscale SSH → ai-server compose.

| Item | Value |
| --- | --- |
| App image | `ghcr.io/quintendesaever/jaarrekening-analyzer:<sha>` |
| Caddy image | `ghcr.io/quintendesaever/jaarrekening-analyzer-caddy:<sha>` |
| Staging data | `/data/deployments/jaarrekening-analyzer/staging/data` (isolated) |
| Production data | `/data/deployments/jaarrekening-analyzer/production/data` until cutover |
| Live today | `/data/apps/jaarrekening-analyzer` (untouched by CD until cutover) |
| Staging URL | `http://<JAAR_STAGING_BIND>:8080` (Tailscale only) |
| Health | `GET /api/health` → `{"status":"ok"}` |

## Secrets

| Secret | Where |
| --- | --- |
| `TS_OAUTH_*` | GitHub Actions (same Tailscale OAuth as Clippy once created) |
| `DEPLOY_SSH_KEY` | Jaarrekening-specific key (`jaarrekening-deploy-ssh-key`) |
| `ADMIN_TOKEN` | Host `.env` per environment (not production copy for staging) |

## Safety

- Staging never mounts `/data/apps/jaarrekening-analyzer/data`
- Deploy script refuses that collision
- No `docker compose down -v` in deploy path
- Production Environment should require approval (configure in GitHub UI)

## Operator unblock

Shared Tailscale OAuth still missing — see `/data/docs/history/CLIPPY_CD_OPERATOR_UNBLOCK_2026-09-12.md`.
Once set on both repos, CD can deploy.
