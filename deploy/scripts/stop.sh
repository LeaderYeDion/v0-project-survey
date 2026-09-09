#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command docker
load_deploy_env
compose --profile public down --remove-orphans
remove_public_url
info "Compose services stopped; database volume retained"
