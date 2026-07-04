#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env
ensure_runtime_dir

backend_ok=0
next_ok=0
tunnel_ok=0
url_ok=0
unsafe=0

if backend_pid="$(read_role_pid backend 2>/dev/null)"; then
  if pid_matches_role backend "$backend_pid"; then
    backend_ok=1
  else
    unsafe=1
  fi
fi

if next_pid="$(read_role_pid next 2>/dev/null)"; then
  if pid_matches_role next "$next_pid"; then
    next_ok=1
  else
    unsafe=1
  fi
fi

if tunnel_pid="$(read_role_pid cloudflared 2>/dev/null)"; then
  if pid_matches_role cloudflared "$tunnel_pid"; then
    tunnel_ok=1
  else
    unsafe=1
  fi
fi

public_url=""
if public_url="$(read_public_url 2>/dev/null)"; then
  if is_valid_quick_tunnel_url "$public_url"; then
    url_ok=1
  else
    unsafe=1
  fi
fi

next_listeners="$(port_listener "$LOCAL_PORT")"
if [ -n "$next_listeners" ]; then
  if [ "$next_ok" -ne 1 ] ||
    ! listener_is_loopback "$LOCAL_HOST" "$LOCAL_PORT"; then
    unsafe=1
  fi
fi

backend_listeners="$(port_listener "$BACKEND_PORT")"
if [ -n "$backend_listeners" ]; then
  if [ "$backend_ok" -ne 1 ] ||
    ! listener_is_loopback "$BACKEND_HOST" "$BACKEND_PORT"; then
    unsafe=1
  fi
fi

matching_tunnels="$(matching_tunnel_processes)"
matching_next="$(matching_next_processes)"
matching_backend="$(matching_backend_processes)"
if [ -n "$matching_tunnels" ] && [ "$tunnel_ok" -ne 1 ]; then
  unsafe=1
fi
if [ -n "$matching_next" ] && [ "$next_ok" -ne 1 ]; then
  unsafe=1
fi
if [ -n "$matching_backend" ] && [ "$backend_ok" -ne 1 ]; then
  unsafe=1
fi

if [ "$unsafe" -eq 1 ]; then
  printf 'UNSAFE: process identity, public URL, or listener does not match deployment\n'
  exit 5
fi

if [ "$backend_ok" -eq 1 ] &&
  [ "$next_ok" -eq 1 ] &&
  [ "$tunnel_ok" -eq 1 ] &&
  [ "$url_ok" -eq 1 ] &&
  [ -n "$next_listeners" ] &&
  [ -n "$backend_listeners" ]; then
  printf 'RUNNING: %s -> %s -> %s\n' \
    "$public_url" "$(origin_url)" "$(backend_origin_url)"
  exit 0
fi

if [ "$backend_ok" -eq 0 ] &&
  [ "$next_ok" -eq 0 ] &&
  [ "$tunnel_ok" -eq 0 ] &&
  [ "$url_ok" -eq 0 ] &&
  [ -z "$next_listeners" ] &&
  [ -z "$backend_listeners" ] &&
  [ -z "$matching_tunnels" ] &&
  [ -z "$matching_next" ] &&
  [ -z "$matching_backend" ]; then
  printf 'STOPPED: no deployment process, URL, or listener is active\n'
  exit 3
fi

printf 'DEGRADED: only part of the deployment is active\n'
exit 4
