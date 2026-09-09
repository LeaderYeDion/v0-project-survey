#!/usr/bin/env bash
set -Eeuo pipefail

survey_uid=10001
runtime_dir="${BACKEND_RUNTIME_DIR:-/app/runtime}"
seed_users_file="${SEED_USERS_FILE:-/run/secrets/seed-users.json}"

if [ "$(id -u)" -eq 0 ]; then
  [ -r "$seed_users_file" ] || {
    printf 'ERROR: seed users secret is not readable by root: %s\n' \
      "$seed_users_file" >&2
    exit 1
  }
  private_seed_users_file="$runtime_dir/seed-users.json"
  install -d -m 0700 -o survey -g survey "$runtime_dir"
  install -m 0600 -o survey -g survey \
    "$seed_users_file" "$private_seed_users_file"
  export SEED_USERS_FILE="$private_seed_users_file"
  exec gosu survey "$0" "$@"
fi

[ "$(id -u)" -eq "$survey_uid" ] || {
  printf 'ERROR: backend must run as root bootstrap or UID %s\n' \
    "$survey_uid" >&2
  exit 1
}
[ -r "$seed_users_file" ] || {
  printf 'ERROR: private seed users file is not readable: %s\n' \
    "$seed_users_file" >&2
  exit 1
}

alembic upgrade head
python -m app.cli seed-users --file "$seed_users_file"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
