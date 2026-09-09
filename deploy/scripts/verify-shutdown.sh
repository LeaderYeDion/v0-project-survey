#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command docker
load_deploy_env

containers="$(compose --profile public ps --all --quiet)"
[ -z "$containers" ] || die "Compose deployment still has containers: $containers"
[ ! -e "$PUBLIC_URL_FILE" ] || die "Public URL state still exists: $PUBLIC_URL_FILE"
info "Verified stopped; the persistent database volume was not inspected or deleted"
