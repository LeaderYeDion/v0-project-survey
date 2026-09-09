#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command docker
require_command curl
load_deploy_env
assert_private_file "$ENV_FILE"
assert_private_file "$SEED_USERS_FILE"

docker info >/dev/null 2>&1 || die "Docker daemon is not available"
docker compose version >/dev/null 2>&1 || die "Docker Compose is not available"
compose config --quiet

info "Docker Compose prerequisites and private configuration are valid"
