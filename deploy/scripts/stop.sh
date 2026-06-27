#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env
ensure_runtime_dir
acquire_lock
trap release_lock EXIT

stop_role "cloudflared"
stop_role "next"
"$SCRIPT_DIR/verify-shutdown.sh" --lock-held
