#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env
ensure_runtime_dir

lock_held=0
if [ "${1:-}" = "--lock-held" ]; then
  lock_held=1
else
  acquire_lock
  trap release_lock EXIT
fi

unsafe=0
for role in cloudflared next; do
  pid_file="$(pid_file_for_role "$role")"
  if [ -f "$pid_file" ]; then
    pid="$(read_role_pid "$role")"
    if kill -0 "$pid" 2>/dev/null; then
      printf 'UNSAFE: %s is still running as PID %s\n' "$role" "$pid" >&2
      unsafe=1
    else
      printf 'UNSAFE: stale PID file remains: %s\n' "$pid_file" >&2
      unsafe=1
    fi
  fi
done

if [ -n "$(matching_tunnel_processes)" ]; then
  printf 'UNSAFE: a matching cloudflared process is still running\n' >&2
  unsafe=1
fi

if [ -n "$(matching_next_processes)" ]; then
  printf 'UNSAFE: a matching Next.js process is still running\n' >&2
  unsafe=1
fi

listeners="$(port_listener)"
if [ -n "$listeners" ]; then
  printf 'UNSAFE: TCP port %s is still listening:\n%s\n' \
    "$LOCAL_PORT" "$listeners" >&2
  unsafe=1
fi

[ "$unsafe" -eq 0 ] || exit 1

if [ "$lock_held" -eq 1 ]; then
  info "Deployment entry is closed: no project process or port remains"
else
  info "Verified stopped: no project process or port remains"
fi
