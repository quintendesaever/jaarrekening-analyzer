#!/usr/bin/env bash
set -euo pipefail
APPLY_BIN="/data/deployments/jaarrekening-analyzer/bin/cd-apply.sh"
cmd="${SSH_ORIGINAL_COMMAND:-}"
[[ -n "$cmd" ]] || { echo "ERROR: interactive SSH denied" >&2; exit 1; }
cmd="${cmd//\'/}"
cmd="${cmd//\"/}"
sha_re='[0-9a-f]{40}'
bin_re='(/data/deployments/jaarrekening-analyzer/bin/cd-apply\.sh|[[:alnum:]_./-]*cd-apply\.sh)'
if [[ "$cmd" =~ ^${bin_re}[[:space:]]+(staging|production)[[:space:]]+(${sha_re})$ ]]; then
  exec "$APPLY_BIN" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
fi
if [[ "$cmd" =~ ^${bin_re}[[:space:]]+rollback[[:space:]]+(staging|production)[[:space:]]+(${sha_re})$ ]]; then
  exec "$APPLY_BIN" rollback "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
fi
if [[ "$cmd" =~ ^${bin_re}[[:space:]]+rollback[[:space:]]+(staging|production)$ ]]; then
  exec "$APPLY_BIN" rollback "${BASH_REMATCH[2]}"
fi
echo "ERROR: command not allowed: $cmd" >&2
exit 1
