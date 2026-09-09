#!/usr/bin/env bash
set -Eeuo pipefail

seed_users_file="${SEED_USERS_FILE:-/run/secrets/seed-users.json}"
[ -r "$seed_users_file" ] || {
  printf 'ERROR: seed users file is not readable: %s\n' "$seed_users_file" >&2
  exit 1
}

alembic upgrade head
python -m app.cli seed-users --file "$seed_users_file"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
