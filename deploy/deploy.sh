#!/usr/bin/env bash
# Jaarrekening immutable-image deploy with health gate and automatic rollback.
set -euo pipefail

DEPLOYMENTS_ROOT="${JAAR_DEPLOYMENTS_ROOT:-/data/deployments/jaarrekening-analyzer}"
APP_PREFIX="ghcr.io/quintendesaever/jaarrekening-analyzer"
CADDY_PREFIX="ghcr.io/quintendesaever/jaarrekening-analyzer-caddy"

die() { echo "ERROR: $*" >&2; exit 1; }
usage() {
  cat >&2 <<'EOF'
Usage:
  deploy.sh <staging|production> <40-hex-sha>
  deploy.sh rollback <staging|production> [40-hex-sha]
EOF
  exit 2
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "need 40-hex sha, got: $1"
}

env_dir() { echo "${DEPLOYMENTS_ROOT}/$1"; }
state_dir() { echo "$(env_dir "$1")/state"; }

read_state() {
  if [[ -f "$1" ]]; then tr -d '[:space:]' <"$1"; else echo ""; fi
}

write_state() {
  local file="$1" value="$2" tmp
  tmp="${file}.tmp.$$"
  printf '%s\n' "$value" >"$tmp"
  mv -f "$tmp" "$file"
}

write_image_env() {
  local dir="$1" sha="$2" data_path="$3"
  cat >"${dir}/.image" <<EOF
JAAR_APP_IMAGE=${APP_PREFIX}:${sha}
JAAR_CADDY_IMAGE=${CADDY_PREFIX}:${sha}
JAAR_DATA_PATH=${data_path}
EOF
}

compose() {
  local environment="$1"; shift
  local dir secrets_env image_env
  dir="$(env_dir "$environment")"
  secrets_env="${dir}/.env"
  image_env="${dir}/.image"
  [[ -f "$image_env" ]] || die "missing $image_env"
  [[ -f "$secrets_env" ]] || die "missing $secrets_env"
  docker compose --project-directory "$dir" \
    --env-file "$secrets_env" \
    --env-file "$image_env" \
    -f "${dir}/docker-compose.yml" \
    -f "${dir}/docker-compose.${environment}.yml" \
    "$@"
}

wait_healthy() {
  local environment="$1"
  local retries="${HEALTH_RETRIES:-30}" sleep_s="${HEALTH_SLEEP_SECS:-5}" i body
  echo "Waiting for health (retries=${retries})…"
  for ((i = 1; i <= retries; i++)); do
    if body="$(compose "$environment" exec -T app python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).read().decode())" 2>/dev/null)"; then
      if [[ "$body" == *'"status":"ok"'* || "$body" == *'"status": "ok"'* ]]; then
        echo "Health OK on attempt ${i}: ${body}"
        return 0
      fi
      echo "Attempt ${i}: unexpected body: ${body}"
    else
      echo "Attempt ${i}: health unreachable"
    fi
    sleep "$sleep_s"
  done
  compose "$environment" ps >&2 || true
  compose "$environment" logs --tail 80 app >&2 || true
  return 1
}

pull_pair() {
  local sha="$1"
  local app="${APP_PREFIX}:${sha}" caddy="${CADDY_PREFIX}:${sha}"
  if ! docker pull "$app"; then
    docker image inspect "$app" >/dev/null 2>&1 || die "app image unavailable: $app"
    echo "WARN: using local $app"
  fi
  if ! docker pull "$caddy"; then
    docker image inspect "$caddy" >/dev/null 2>&1 || die "caddy image unavailable: $caddy"
    echo "WARN: using local $caddy"
  fi
}

data_path_for() {
  case "$1" in
    staging) echo "${DEPLOYMENTS_ROOT}/staging/data" ;;
    production)
      # Prefer CD production data; cutover may point at apps path via override file.
      if [[ -f "${DEPLOYMENTS_ROOT}/production/data-path" ]]; then
        tr -d '[:space:]' <"${DEPLOYMENTS_ROOT}/production/data-path"
      else
        echo "${DEPLOYMENTS_ROOT}/production/data"
      fi
      ;;
    *) die "bad env $1" ;;
  esac
}

deploy_sha() {
  local environment="$1" sha="$2"
  local dir sdir current previous data_path
  validate_sha "$sha"
  dir="$(env_dir "$environment")"
  sdir="$(state_dir "$environment")"
  data_path="$(data_path_for "$environment")"

  [[ -d "$dir" ]] || die "missing $dir"
  [[ -f "${dir}/docker-compose.yml" ]] || die "missing compose"
  [[ -f "${dir}/.env" ]] || die "missing .env"
  mkdir -p "$sdir" "$data_path"

  # Refuse staging/production data path collision with live apps path for staging.
  if [[ "$environment" == "staging" && "$data_path" == "/data/apps/jaarrekening-analyzer/data" ]]; then
    die "staging must not mount production data path"
  fi

  current="$(read_state "${sdir}/current")"
  previous="$(read_state "${sdir}/previous")"
  echo "Environment: $environment"
  echo "Target sha: $sha"
  echo "Data path: $data_path"
  echo "Current: ${current:-<none>} Previous: ${previous:-<none>}"

  if [[ -n "$current" && "$current" == "$sha" ]]; then
    if wait_healthy "$environment"; then
      echo "Already deployed and healthy: $sha"
      return 0
    fi
    echo "Current unhealthy; redeploying"
  fi

  pull_pair "$sha"
  write_image_env "$dir" "$sha" "$data_path"
  compose "$environment" up -d --pull never --remove-orphans

  if wait_healthy "$environment"; then
    if [[ -n "$current" && "$current" != "$sha" ]]; then
      write_state "${sdir}/previous" "$current"
    fi
    write_state "${sdir}/current" "$sha"
    echo "Deploy succeeded: $environment → $sha"
    return 0
  fi

  echo "Health failed; rolling back" >&2
  local rollback_to=""
  if [[ -n "$current" && "$current" != "$sha" ]]; then
    rollback_to="$current"
  elif [[ -n "$previous" ]]; then
    rollback_to="$previous"
  fi
  [[ -n "$rollback_to" ]] || die "no known-good sha to restore"
  pull_pair "$rollback_to"
  write_image_env "$dir" "$rollback_to" "$data_path"
  compose "$environment" up -d --pull never --remove-orphans
  if wait_healthy "$environment"; then
    write_state "${sdir}/current" "$rollback_to"
    die "deploy failed; rolled back to $rollback_to"
  fi
  die "deploy failed; rollback also failed"
}

main() {
  command -v docker >/dev/null || die "docker missing"
  [[ $# -ge 1 ]] || usage
  local action="$1" lock_env=""
  case "$action" in
    staging|production) [[ $# -eq 2 ]] || usage; lock_env="$action" ;;
    rollback)
      [[ $# -ge 2 && $# -le 3 ]] || usage
      lock_env="$2"
      [[ "$lock_env" == "staging" || "$lock_env" == "production" ]] || die "bad env"
      ;;
    *) usage ;;
  esac
  local sdir lock_file
  sdir="$(state_dir "$lock_env")"
  mkdir -p "$sdir"
  lock_file="${sdir}/lock"
  exec 9>"${lock_file}"
  flock -n 9 || die "deploy already in progress for $lock_env"

  case "$action" in
    staging|production) deploy_sha "$action" "$2" ;;
    rollback)
      local sha="${3:-}"
      if [[ -z "$sha" ]]; then
        sha="$(read_state "$(state_dir "$lock_env")/previous")"
        [[ -n "$sha" ]] || die "no previous sha"
      fi
      deploy_sha "$lock_env" "$sha"
      ;;
  esac
}

main "$@"
