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
for role in cloudflared next backend; do
  pid_file="$(pid_file_for_role "$role")"
  if [ -f "$pid_file" ]; then
    pid="$(read_role_pid "$role")"
    if kill -0 "$pid" 2>/dev/null; then
      printf 'UNSAFE: %s is still running as PID %s\n' "$role" "$pid" >&2
    else
      printf 'UNSAFE: stale PID file remains: %s\n' "$pid_file" >&2
    fi
    unsafe=1
  fi
done

if [ -n "$(matching_tunnel_processes)" ]; then
  printf 'UNSAFE: a matching Quick Tunnel process is still running\n' >&2
  unsafe=1
fi

if [ -n "$(matching_next_processes)" ]; then
  printf 'UNSAFE: a matching Next.js process is still running\n' >&2
  unsafe=1
fi

if [ -n "$(matching_backend_processes)" ]; then
  printf 'UNSAFE: a matching FastAPI process is still running\n' >&2
  unsafe=1
fi

if [ -e "$(public_url_file)" ]; then
  printf 'UNSAFE: public URL state still exists: %s\n' \
    "$(public_url_file)" >&2
  unsafe=1
fi

next_listeners="$(port_listener "$LOCAL_PORT")"
if [ -n "$next_listeners" ]; then
  printf 'UNSAFE: TCP port %s is still listening:\n%s\n' \
    "$LOCAL_PORT" "$next_listeners" >&2
  unsafe=1
fi

backend_listeners="$(port_listener "$BACKEND_PORT")"
if [ -n "$backend_listeners" ]; then
  printf 'UNSAFE: TCP port %s is still listening:\n%s\n' \
    "$BACKEND_PORT" "$backend_listeners" >&2
  unsafe=1
fi

[ "$unsafe" -eq 0 ] || exit 1

if [ "$lock_held" -eq 1 ]; then
  info "Deployment entry is closed: no process, URL, or port remains"
else
  info "Verified stopped: no process, URL, or port remains"
fi
