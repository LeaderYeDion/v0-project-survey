#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env
ensure_runtime_dir

next_ok=0
tunnel_ok=0
url_ok=0
unsafe=0

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

listeners="$(port_listener)"
if [ -n "$listeners" ]; then
  if [ "$next_ok" -ne 1 ] ||
    ! [[ "$listeners" == *"$LOCAL_HOST:$LOCAL_PORT"* ]] ||
    [[ "$listeners" == *"*:$LOCAL_PORT"* ]] ||
    [[ "$listeners" == *"0.0.0.0:$LOCAL_PORT"* ]] ||
    [[ "$listeners" == *"[::]:$LOCAL_PORT"* ]]; then
    unsafe=1
  fi
fi

matching_tunnels="$(matching_tunnel_processes)"
matching_next="$(matching_next_processes)"
if [ -n "$matching_tunnels" ] && [ "$tunnel_ok" -ne 1 ]; then
  unsafe=1
fi
if [ -n "$matching_next" ] && [ "$next_ok" -ne 1 ]; then
  unsafe=1
fi

if [ "$unsafe" -eq 1 ]; then
  printf 'UNSAFE: process identity, public URL, or listener does not match deployment\n'
  exit 5
fi

if [ "$next_ok" -eq 1 ] &&
  [ "$tunnel_ok" -eq 1 ] &&
  [ "$url_ok" -eq 1 ] &&
  [ -n "$listeners" ]; then
  printf 'RUNNING: %s -> %s\n' "$public_url" "$(origin_url)"
  exit 0
fi

if [ "$next_ok" -eq 0 ] &&
  [ "$tunnel_ok" -eq 0 ] &&
  [ "$url_ok" -eq 0 ] &&
  [ -z "$listeners" ] &&
  [ -z "$matching_tunnels" ] &&
  [ -z "$matching_next" ]; then
  printf 'STOPPED: no deployment process, URL, or listener is active\n'
  exit 3
fi

printf 'DEGRADED: only part of the deployment is active\n'
exit 4
