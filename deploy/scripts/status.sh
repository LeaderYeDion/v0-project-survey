#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env
ensure_runtime_dir

next_ok=0
tunnel_ok=0
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

listeners="$(port_listener)"
if [ -n "$listeners" ]; then
  if ! [[ "$listeners" == *"$LOCAL_HOST:$LOCAL_PORT"* ]] ||
    [[ "$listeners" == *"*:$LOCAL_PORT"* ]] ||
    [[ "$listeners" == *"0.0.0.0:$LOCAL_PORT"* ]] ||
    [[ "$listeners" == *"[::]:$LOCAL_PORT"* ]]; then
    unsafe=1
  fi
fi

if [ "$unsafe" -eq 1 ]; then
  printf 'UNSAFE: process identity or listener binding does not match deployment\n'
  exit 5
fi

if [ "$next_ok" -eq 1 ] && [ "$tunnel_ok" -eq 1 ] && [ -n "$listeners" ]; then
  printf 'RUNNING: https://%s -> http://%s:%s\n' \
    "$PUBLIC_HOSTNAME" "$LOCAL_HOST" "$LOCAL_PORT"
  exit 0
fi

if [ "$next_ok" -eq 0 ] && [ "$tunnel_ok" -eq 0 ] && [ -z "$listeners" ]; then
  printf 'STOPPED: no deployment process or listener is active\n'
  exit 3
fi

printf 'DEGRADED: only part of the deployment is active\n'
exit 4
