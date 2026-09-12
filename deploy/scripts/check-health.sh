#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command curl
load_deploy_env

health_config=""
cleanup() {
  exit_code=$?
  trap - EXIT
  [ -z "$health_config" ] || rm -f "$health_config"
  exit "$exit_code"
}
trap cleanup EXIT

health_config="$(mktemp "${TMPDIR:-/tmp}/survey-health.XXXXXX")"
write_deploy_curl_config "$health_config"
curl \
  --config "$health_config" \
  --fail \
  --show-error \
  --connect-timeout 3 \
  --max-time 10 \
  "$(origin_url)/survey-api/health"

rm -f "$health_config"
health_config=""
trap - EXIT
