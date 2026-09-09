#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command docker
load_deploy_env

printf 'Compose services and health:\n'
compose --profile public ps
printf '\nLocal URL: %s\n' "$(origin_url)"

if public_url="$(read_public_url 2>/dev/null)" &&
  is_valid_quick_tunnel_url "$public_url"; then
  printf 'Public URL: %s\n' "$public_url"
else
  printf 'Public URL: not active\n'
fi

volume_name="$(
  docker volume ls \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --filter 'label=com.docker.compose.volume=survey_postgres_data' \
    --format '{{.Name}}' |
    head -n 1
)"
printf 'Database volume: %s\n' "${volume_name:-not created}"

printf 'Migration revision: '
if ! compose exec -T backend alembic current 2>/dev/null; then
  printf 'backend not running\n'
fi
