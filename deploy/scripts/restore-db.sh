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

stage="validating restore inputs"
complete=0
quiescing=0
preflight_container=""
preflight_output=""
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
  if [ "$complete" -eq 0 ] && [ "$quiescing" -eq 1 ]; then
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
  [ -z "$preflight_container" ] || docker rm --force "$preflight_container" >/dev/null 2>&1 || true
  [ -z "$preflight_output" ] || rm -f "$preflight_output"
  release_maintenance_lock || exit_code=1
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

acquire_maintenance_lock restore
# Validate the installed image's explicit no-DB contract using the actual private
# seed. No application service/container or DB object is changed by this step.
compose config --quiet
backend_image_id="$(docker image inspect --format '{{.Id}}' "$COMPOSE_PROJECT_NAME-backend")"
[ -n "$backend_image_id" ] || die "Build the current backend image before restoring"
seed_absolute="$(cd "$(dirname "$SEED_USERS_FILE")" && pwd)/$(basename "$SEED_USERS_FILE")"
preflight_output="$(mktemp "${TMPDIR:-/tmp}/survey-restore-preflight.XXXXXX")"
preflight_container="$(docker create --network none --read-only \
  --tmpfs /app/runtime:rw,noexec,nosuid,size=1m \
  --mount "type=bind,source=$seed_absolute,target=/run/secrets/seed-users.json,readonly" \
  "$backend_image_id" --preflight-only)"
docker start --attach "$preflight_container" >"$preflight_output" 2>/dev/null ||
  die "Backend restore preflight failed; rebuild the current image and validate the private five-user seed"
[ "$(<"$preflight_output")" = "SURVEY_RESTORE_PREFLIGHT_V1 prepare-only seed-valid" ] ||
  die "Backend image lacks the restore preflight/prepare contract; rebuild before restoring"
docker rm --force "$preflight_container" >/dev/null
preflight_container=""
rm -f "$preflight_output"
preflight_output=""

# These checks require an already-running target db and remain read-only.
compose exec -T db pg_restore --list <"$backup_file" >/dev/null
actual_db="$(compose exec -T db psql --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --command 'SELECT current_database();')"
[ "$actual_db" = "$POSTGRES_DB" ] || die "Restore target did not match configured database"

stage="quiescing application services"
quiescing=1
info "Explicit --confirm received; stopping application services before restore"
compose --profile public stop cloudflared frontend backend
remove_public_url
stage="starting database only"
compose up --detach --no-deps --wait \
  --wait-timeout "${STARTUP_TIMEOUT_SECONDS:-180}" db

stage="restoring database"
active_services="$(compose --profile public ps --status running --status restarting \
  --status paused --services cloudflared frontend backend)"
[ -z "$active_services" ] || die "Application services are not stopped; refusing database import"
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
