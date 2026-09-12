#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command curl
load_deploy_env

health_config=""
curl_pid=""
cleanup() {
  exit_code=$?
  trap - EXIT HUP INT TERM
  if [ -n "$curl_pid" ]; then
    kill -TERM "$curl_pid" 2>/dev/null || true
    wait "$curl_pid" 2>/dev/null || true
  fi
  [ -z "$health_config" ] || rm -f "$health_config"
  exit "$exit_code"
}

handle_signal() {
  local signal_number="$1"
  trap - HUP INT TERM
  exit "$((128 + signal_number))"
}

trap cleanup EXIT
trap 'handle_signal 1' HUP
trap 'handle_signal 2' INT
trap 'handle_signal 15' TERM

health_config="$(mktemp "${TMPDIR:-/tmp}/survey-health.XXXXXX")"
write_deploy_curl_config "$health_config"
curl \
  --config "$health_config" \
  --fail \
  --show-error \
  --connect-timeout 3 \
  --max-time 10 \
  "$(origin_url)/survey-api/health" &
curl_pid=$!
wait "$curl_pid"
curl_pid=""

rm -f "$health_config"
health_config=""
trap - EXIT
