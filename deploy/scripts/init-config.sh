#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command openssl
mkdir -p "$(dirname "$ENV_FILE")" "$(dirname "$SEED_USERS_FILE")"
umask 077

for existing_file in "$ENV_FILE" "$SEED_USERS_FILE"; do
  if [ -e "$existing_file" ] &&
    { [ ! -f "$existing_file" ] || [ "$(file_mode "$existing_file")" != "600" ]; }; then
    die "$existing_file already exists; refusing to overwrite credentials"
  fi
done

if [ -e "$ENV_FILE" ]; then
  assert_private_file "$ENV_FILE"
  info "Preserved existing private Compose configuration at $ENV_FILE"
else
  postgres_password="$(openssl rand -hex 24)"
  {
    printf 'COMPOSE_PROJECT_NAME=survey\n'
    printf 'LOCAL_PORT=3000\n'
    printf 'POSTGRES_DB=survey\n'
    printf 'POSTGRES_USER=survey\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
    printf 'SIMULATION_TERMINATION_ENABLED=false\n'
    printf 'DEPLOY_AUTH_ENABLED=false\n'
    printf 'DEPLOY_USERNAME=\n'
    printf 'DEPLOY_PASSWORD=\n'
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
  info "Created private Compose configuration at $ENV_FILE"
fi

if [ -e "$SEED_USERS_FILE" ]; then
  assert_private_file "$SEED_USERS_FILE"
  info "Preserved existing private application-user credentials at $SEED_USERS_FILE"
else
  seed_passwords=()
  for _index in {1..5}; do
    seed_passwords+=("$(openssl rand -hex 24)")
  done
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
  info "Created five private application-user credentials at $SEED_USERS_FILE"
fi

info "Initialization complete; no existing credential file was overwritten"
