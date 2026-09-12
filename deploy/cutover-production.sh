#!/usr/bin/env bash
# Attended Jaarrekening production cutover: live apps → CD production.
# Reuses live data path. Default dry-run; --apply stops live then deploys.
set -euo pipefail

APPS="/data/apps/jaarrekening-analyzer"
PROD="/data/deployments/jaarrekening-analyzer/production"
BIN="/data/deployments/jaarrekening-analyzer/bin/deploy.sh"
HEALTH_URL="${JAAR_PUBLIC_HEALTH_URL:-http://100.66.108.109/api/health}"

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[jaar-cutover] $*"; }

SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "usage: $0 <40-hex-sha> [--apply]"
APPLY=0
[[ "${2:-}" == "--apply" ]] && APPLY=1

[[ -d "$APPS" ]] || die "missing $APPS"
[[ -x "$BIN" ]] || die "missing $BIN"
[[ -f "$PROD/.env" ]] || die "missing $PROD/.env"
[[ -d "$APPS/data" ]] || die "missing live data $APPS/data"

echo "=== Jaarrekening production CD cutover ==="
echo "Live: $APPS"
echo "CD:   $PROD"
echo "SHA:  $SHA"
echo "Data: $APPS/data (shared intentionally at cutover)"
echo "Health: $HEALTH_URL"
echo

if [[ "$APPLY" -ne 1 ]]; then
  echo "Dry-run only. Re-run with --apply (brief Tailscale :80 downtime)."
  exit 0
fi

# Point CD production at live data (never wipe)
printf '%s\n' "$APPS/data" >"$PROD/data-path"
chmod 600 "$PROD/data-path"

live_up() {
  docker compose --project-directory "$APPS" -f "$APPS/docker-compose.yml" up -d --remove-orphans
}
live_down() {
  docker compose --project-directory "$APPS" -f "$APPS/docker-compose.yml" stop
}
prod_down() {
  # shellcheck disable=SC1091
  set -a
  # compose needs .image; may be missing before first deploy
  [[ -f "$PROD/.image" ]] || return 0
  docker compose --project-directory "$PROD" \
    --env-file "$PROD/.env" \
    --env-file "$PROD/.image" \
    -f "$PROD/docker-compose.yml" \
    -f "$PROD/docker-compose.production.yml" \
    --profile tunnel \
    down --remove-orphans || true
}

verify() {
  local i body
  for i in $(seq 1 30); do
    if body="$(curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null)"; then
      if [[ "$body" == *'"status":"ok"'* || "$body" == *'"status": "ok"'* ]]; then
        log "health OK: $body"
        return 0
      fi
    fi
    log "attempt $i: waiting for $HEALTH_URL"
    sleep 5
  done
  return 1
}

log "pre-pull images for $SHA"
docker pull "ghcr.io/quintendesaever/jaarrekening-analyzer:${SHA}"
docker pull "ghcr.io/quintendesaever/jaarrekening-analyzer-caddy:${SHA}"

log "stopping live stack"
live_down

revert_live() {
  log "REVERT: CD production down; live up"
  prod_down
  live_up
  sleep 5
  curl -fsS -m 10 "$HEALTH_URL" || log "WARN: health still down after revert"
}

# deploy.sh production does not enable tunnel profile — start with profile after deploy
# Patch: call deploy then ensure tunnel profile up
if ! "$BIN" production "$SHA"; then
  revert_live
  die "CD production deploy failed; live restored"
fi

# Bring tunnel profile if defined (matches live public path)
docker compose --project-directory "$PROD" \
  --env-file "$PROD/.env" \
  --env-file "$PROD/.image" \
  -f "$PROD/docker-compose.yml" \
  -f "$PROD/docker-compose.production.yml" \
  --profile tunnel \
  up -d --remove-orphans || true

if ! verify; then
  revert_live
  die "health failed after cutover; live restored"
fi

log "cutover OK — live apps stack stopped; CD production on $HEALTH_URL"
