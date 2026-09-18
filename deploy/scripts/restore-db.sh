#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

[ "$#" -eq 2 ] && [ "$2" = "--confirm" ] ||
  die "Usage: $0 BACKUP_FILE --confirm"
backup_file="$1"
[ -f "$backup_file" ] || die "Backup file does not exist: $backup_file"
[ -s "$backup_file" ] || die "Backup file is empty: $backup_file"
assert_private_file "$backup_file"
[ "$(head -c 5 "$backup_file")" = "PGDMP" ] ||
  die "Backup must be a PostgreSQL custom-format archive"
backup_file="$(cd "$(dirname "$backup_file")" && pwd)/$(basename "$backup_file")"

require_command docker
require_command curl
load_deploy_env
assert_private_file "$SEED_USERS_FILE"
case "$POSTGRES_DB" in
  postgres | template0 | template1) die "Refusing to restore a PostgreSQL system database" ;;
esac
info "Restore target: database '$POSTGRES_DB' in Compose project '$COMPOSE_PROJECT_NAME'"

# Read-only preflight requires the target db to be running. No writer is stopped
# and no database object is changed until configuration, archive and target pass.
compose config --quiet
compose exec -T db pg_restore --list <"$backup_file" >/dev/null
actual_db="$(compose exec -T db psql --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
[ "$actual_db" = "$POSTGRES_DB" ] || die "Restore target did not match configured database"

stage="quiescing application services"
complete=0
print_recovery_compose() {
  printf 'COMPOSE_PROJECT_NAME=%q POSTGRES_DB=%q POSTGRES_USER=%q LOCAL_PORT=%q DEPLOY_SEED_USERS_FILE=%q docker compose --env-file %q --project-directory %q --file %q ' \
    "$COMPOSE_PROJECT_NAME" "$POSTGRES_DB" "$POSTGRES_USER" "$LOCAL_PORT" \
    "$SEED_USERS_FILE" "$ENV_FILE" "$PROJECT_ROOT" "$COMPOSE_FILE" >&2
  printf '%q ' "$@" >&2
  printf '\n' >&2
}
cleanup() {
  exit_code=$?
  trap - EXIT HUP INT TERM
  if [ "$complete" -eq 0 ]; then
    printf 'ERROR: Restore failed while %s for project %s, database %s.\n' \
      "$stage" "$COMPOSE_PROJECT_NAME" "$POSTGRES_DB" >&2
    if compose --profile public stop cloudflared frontend backend; then
      printf 'Application services are stopped; database volume is preserved.\n' >&2
    else
      printf 'ERROR: Could not confirm application services stopped; stop them manually before recovery.\n' >&2
    fi
    printf 'Do not start frontend or backend until restore, migrations and seed succeed.\n' >&2
    printf 'Inspect db/backend logs and correct the reported cause. With the same private configuration and exported credential overrides, confirm app shutdown, start only db if needed, then retry:\n' >&2
    print_recovery_compose --profile public stop cloudflared frontend backend
    print_recovery_compose up --detach --no-deps --wait db
    printf 'COMPOSE_PROJECT_NAME=%q POSTGRES_DB=%q POSTGRES_USER=%q LOCAL_PORT=%q DEPLOY_ENV_FILE=%q DEPLOY_SEED_USERS_FILE=%q bash %q %q --confirm\n' \
      "$COMPOSE_PROJECT_NAME" "$POSTGRES_DB" "$POSTGRES_USER" "$LOCAL_PORT" \
      "$ENV_FILE" "$SEED_USERS_FILE" "$SCRIPT_DIR/restore-db.sh" "$backup_file" >&2
    printf 'If the archive is unusable, substitute a verified mode-600 backup in that command. Never delete the volume to repair a failed restore.\n' >&2
    [ "$exit_code" -ne 0 ] || exit_code=1
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

info "Explicit --confirm received; stopping application services before restore"
compose --profile public stop cloudflared frontend backend
remove_public_url
stage="starting database only"
compose up --detach --no-deps --wait \
  --wait-timeout "${STARTUP_TIMEOUT_SECONDS:-180}" db

stage="restoring database"
compose exec -T db \
  pg_restore \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --single-transaction \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --no-privileges <"$backup_file"

stage="applying migrations and synchronizing five seed users"
compose run --rm --no-deps -T backend --prepare-only
stage="restarting application services"
compose up --detach --wait --wait-timeout "${STARTUP_TIMEOUT_SECONDS:-180}" frontend
stage="verifying application health"
DEPLOY_ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/check-health.sh"
complete=1
info "Restore, migrations, seed and application health completed for database '$POSTGRES_DB'"
info "Optional public tunnel remains stopped; re-enable it explicitly with docker:up -- --public --no-build"
