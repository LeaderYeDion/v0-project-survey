#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command openssl
ensure_runtime_dir

[ ! -e "$ENV_FILE" ] ||
  die "$ENV_FILE already exists; refusing to overwrite credentials"
SEED_USERS_FILE="$CONFIG_DIR/seed-users.json"
[ ! -e "$SEED_USERS_FILE" ] ||
  die "$SEED_USERS_FILE already exists; refusing to overwrite credentials"

password="$(openssl rand -hex 24)"
umask 077
seed_passwords=()
for _index in {1..5}; do
  seed_passwords+=("$(openssl rand -hex 24)")
done
{
  printf 'LOCAL_HOST=127.0.0.1\n'
  printf 'LOCAL_PORT=3000\n'
  printf 'BACKEND_HOST=127.0.0.1\n'
  printf 'BACKEND_PORT=8000\n'
  printf 'SURVEY_BACKEND_URL=http://127.0.0.1:8000\n'
  printf 'SIMULATION_TERMINATION_ENABLED=false\n'
  printf 'DEPLOY_AUTH_ENABLED=true\n'
  printf 'DEPLOY_USERNAME=survey\n'
  printf 'DEPLOY_PASSWORD=%s\n' "$password"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"

{
  printf '[\n'
  for index in {1..5}; do
    comma=','
    [ "$index" -lt 5 ] || comma=''
    printf '  {"username":"researcher0%s","password":"%s","locale":"zh-CN"}%s\n' \
      "$index" "${seed_passwords[$((index - 1))]}" "$comma"
  done
  printf ']\n'
} >"$SEED_USERS_FILE"
chmod 600 "$SEED_USERS_FILE"

info "Created private deployment credentials at $ENV_FILE"
info "Created private application user credentials at $SEED_USERS_FILE"
info "Open that file to view or change the username and password"
