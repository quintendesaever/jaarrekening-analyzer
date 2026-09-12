#!/usr/bin/env bash
# Sync deploy artifacts from stdin tar, then deploy.
set -euo pipefail

ROOT="/data/deployments/jaarrekening-analyzer"
BIN="${ROOT}/bin"
DEPLOY_SH="${BIN}/deploy.sh"

die() { echo "ERROR: $*" >&2; exit 1; }
usage() { echo "Usage: cd-apply.sh <staging|production|rollback ...> <sha?>" >&2; exit 2; }

[[ $# -ge 1 ]] || usage
action="$1"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
[[ -t 0 ]] && die "stdin must be gzipped tar"
tar -xzf - -C "$tmp"
[[ -f "${tmp}/deploy.sh" && -f "${tmp}/cd-apply.sh" && -f "${tmp}/ssh-forced-command.sh" ]] || die "incomplete bundle"
[[ -f "${tmp}/compose/docker-compose.yml" ]] || die "missing compose"

mkdir -p "${BIN}" "${ROOT}/staging/state" "${ROOT}/staging/data" "${ROOT}/production/state" "${ROOT}/production/data"
install -m 755 "${tmp}/deploy.sh" "${DEPLOY_SH}"
install -m 755 "${tmp}/cd-apply.sh" "${BIN}/cd-apply.sh"
install -m 755 "${tmp}/ssh-forced-command.sh" "${BIN}/ssh-forced-command.sh"
install -m 644 "${tmp}/compose/docker-compose.yml" "${ROOT}/staging/docker-compose.yml"
install -m 644 "${tmp}/compose/docker-compose.staging.yml" "${ROOT}/staging/docker-compose.staging.yml"
install -m 644 "${tmp}/compose/docker-compose.yml" "${ROOT}/production/docker-compose.yml"
install -m 644 "${tmp}/compose/docker-compose.production.yml" "${ROOT}/production/docker-compose.production.yml"
echo "Synced Jaarrekening deploy artifacts → ${ROOT}"

case "$action" in
  staging|production)
    [[ $# -eq 2 ]] || usage
    exec "${DEPLOY_SH}" "$action" "$2"
    ;;
  rollback)
    [[ $# -ge 2 && $# -le 3 ]] || usage
    if [[ $# -eq 3 ]]; then exec "${DEPLOY_SH}" rollback "$2" "$3"; fi
    exec "${DEPLOY_SH}" rollback "$2"
    ;;
  *) usage ;;
esac
