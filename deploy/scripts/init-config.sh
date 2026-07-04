#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command openssl
ensure_runtime_dir

[ ! -e "$ENV_FILE" ] ||
  die "$ENV_FILE already exists; refusing to overwrite credentials"

password="$(openssl rand -hex 24)"
umask 077
{
  printf 'LOCAL_HOST=127.0.0.1\n'
  printf 'LOCAL_PORT=3000\n'
  printf 'BACKEND_HOST=127.0.0.1\n'
  printf 'BACKEND_PORT=8000\n'
  printf 'SURVEY_BACKEND_URL=http://127.0.0.1:8000\n'
  printf 'DEPLOY_AUTH_ENABLED=true\n'
  printf 'DEPLOY_USERNAME=survey\n'
  printf 'DEPLOY_PASSWORD=%s\n' "$password"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"

info "Created private deployment credentials at $ENV_FILE"
info "Open that file to view or change the username and password"
