# Jaarrekening Continuous Delivery

CI → immutable GHCR SHA images → deploy to ai-server compose under `/data/deployments/jaarrekening-analyzer/`.

## Deploy transports

**Preferred:** GitHub Actions joins Tailscale (`tag:ci`) via OAuth or auth key, then SSH forced-command.

**Fallback (verified):** When Tailscale secrets are missing, Actions sets a pending commit status
`cd-host/jaarrekening-analyzer/{staging|production}` with description `deploy:<sha>`.
The ai-server **cd-host-agent** (`systemd --user`, `/data/ai-platform/scripts/cd-host-agent.sh`)
runs local `cd-apply` (compose stays Tailscale-bound). Rollback uses the same status context.

| Item | Value |
| --- | --- |
| App image | `ghcr.io/quintendesaever/jaarrekening-analyzer:<sha>` |
| Caddy image | `ghcr.io/quintendesaever/jaarrekening-analyzer-caddy:<sha>` |
| Staging data | `/data/deployments/jaarrekening-analyzer/staging/data` (isolated) |
| Production data | Live path after cutover: `/data/apps/jaarrekening-analyzer/data` (via `production/data-path`) |
| Staging bind | `JAAR_STAGING_BIND` = Tailscale **IP only** (compose adds `:8080:80`) |
| Production bind | `JAAR_PROD_BIND` = Tailscale **IP only** (compose adds `:80:80`) |
| Staging URL | `http://<tailscale-ip>:8080` |
| Health | `GET /api/health` → `{"status":"ok"}` |

## CD triggers

| Event | Staging | Production |
| --- | --- | --- |
| `workflow_run` after CI on `main` | Yes | **No** (attended only) |
| `workflow_dispatch` | Yes | Only if `skip_production=false` (default `true`) |
| Rollback workflow | `workflow_dispatch` env + SHA | same |

## Secrets

| Secret | Where | Required when |
| --- | --- | --- |
| `TAILSCALE_AUTHKEY` or `TS_OAUTH_*` | GitHub Actions | Preferred Tailscale SSH path |
| `DEPLOY_SSH_KEY` | Actions (`jaarrekening-deploy-ssh-key`) | **Only** for Tailscale SSH path — not for host-agent |
| `ADMIN_TOKEN` | Host `.env` per environment | Runtime; staging ≠ production |

Intake (optional Tailscale): `/data/ai-platform/scripts/cd-set-tailscale-authkey.sh` or `cd-set-tailscale-oauth.sh`.

## Cutover

Attended helper: `deploy/cutover-production.sh <40-hex-sha> [--apply]`

- Default dry-run; `--apply` stops `/data/apps/jaarrekening-analyzer`, deploys CD production, enables tunnel profile, verifies health
- On failure: stops CD production and restores live compose
- Does not wipe data volumes

## Safety

- Staging never mounts `/data/apps/jaarrekening-analyzer/data`
- Deploy script refuses that collision for staging
- No `docker compose down -v` in deploy path
- Production GitHub Environment requires approval for Actions production jobs
