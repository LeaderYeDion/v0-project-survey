#!/usr/bin/env bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
CONFIG_DIR="$DEPLOY_DIR/config"
RUNTIME_DIR="$DEPLOY_DIR/runtime"
ENV_FILE="${DEPLOY_ENV_FILE:-$CONFIG_DIR/deploy.env}"
SEED_USERS_FILE="${DEPLOY_SEED_USERS_FILE:-$CONFIG_DIR/seed-users.json}"
BACKUP_DIR="${DEPLOY_BACKUP_DIR:-$DEPLOY_DIR/backups}"
COMPOSE_FILE="$PROJECT_ROOT/compose.yaml"
PUBLIC_URL_FILE="$RUNTIME_DIR/public-url"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '[deploy] %s\n' "$*"
}

# All supported startup/restore wrappers share this per-user, per-project host
# lock, even from different checkouts. Never auto-reclaim: PID reuse, a failed
# metadata write, or detached Docker children make stale detection ambiguous.
acquire_maintenance_lock() {
  local operation="$1"
  local lock_root="/tmp/survey-maintenance-$(id -u)"
  local lock_path="$lock_root/$COMPOSE_PROJECT_NAME.lock"
  [ ! -L "$lock_root" ] || die "Maintenance lock root must not be a symbolic link: $lock_root"
  umask 077
  mkdir -p "$lock_root"
  local owner
  if stat -f '%u' "$lock_root" >/dev/null 2>&1; then
    owner="$(stat -f '%u' "$lock_root")"
  else
    owner="$(stat -c '%u' "$lock_root")"
  fi
  [ "$owner" = "$(id -u)" ] || die "Maintenance lock root belongs to another user: $lock_root"
  chmod 700 "$lock_root"
  if ! mkdir "$lock_path" 2>/dev/null; then
    die "Maintenance lock is held or stale: $lock_path. Inspect owner metadata and its process/Docker children. Do not remove an active lock; after confirming all maintenance has ended, move the stale directory aside manually and retry."
  fi
  MAINTENANCE_LOCK_DIR="$lock_path"
  MAINTENANCE_LOCK_TOKEN="$$-$RANDOM-$RANDOM"
  printf '%s\n' "$MAINTENANCE_LOCK_TOKEN" >"$lock_path/token"
  printf 'pid=%s\noperation=%s\nproject=%s\nstarted=%s\ncheckout=%s\n' \
    "$$" "$operation" "$COMPOSE_PROJECT_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PROJECT_ROOT" >"$lock_path/owner"
}

release_maintenance_lock() {
  [ -n "${MAINTENANCE_LOCK_DIR:-}" ] || return 0
  if [ ! -L "$MAINTENANCE_LOCK_DIR" ] &&
    [ "$(<"$MAINTENANCE_LOCK_DIR/token")" = "$MAINTENANCE_LOCK_TOKEN" ]; then
    rm -f "$MAINTENANCE_LOCK_DIR/owner" "$MAINTENANCE_LOCK_DIR/token"
    rmdir "$MAINTENANCE_LOCK_DIR" || return 1
  else
    printf 'ERROR: Maintenance lock ownership changed; lock retained for inspection.\n' >&2
    return 1
  fi
  MAINTENANCE_LOCK_DIR=""
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

assert_private_file() {
  local file="$1"
  [ ! -L "$file" ] || die "$file must not be a symbolic link"
  [ -f "$file" ] || die "Missing private file: $file"
  local mode
  mode="$(file_mode "$file")"
  [ "$mode" = "600" ] || die "$file must have mode 600; run chmod 600 '$file'"
}

ensure_runtime_dir() {
  mkdir -p "$RUNTIME_DIR"
  chmod 700 "$RUNTIME_DIR"
}

ensure_backup_dir() {
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
}

load_deploy_env() {
  assert_private_file "$ENV_FILE"
  local override_names=()
  local override_values=()
  local name
  for name in \
    COMPOSE_PROJECT_NAME \
    LOCAL_PORT \
    POSTGRES_DB \
    POSTGRES_USER \
    POSTGRES_PASSWORD \
    SIMULATION_TERMINATION_ENABLED \
    DEPLOY_AUTH_ENABLED \
    DEPLOY_USERNAME \
    DEPLOY_PASSWORD; do
    if [ "${!name+x}" = "x" ]; then
      override_names+=("$name")
      override_values+=("${!name}")
    fi
  done

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  local index
  for index in "${!override_names[@]}"; do
    printf -v "${override_names[$index]}" '%s' "${override_values[$index]}"
    export "${override_names[$index]}"
  done

  for name in \
    COMPOSE_PROJECT_NAME \
    LOCAL_PORT \
    POSTGRES_DB \
    POSTGRES_USER \
    POSTGRES_PASSWORD \
    SIMULATION_TERMINATION_ENABLED \
    DEPLOY_AUTH_ENABLED; do
    [ -n "${!name:-}" ] || die "Missing required setting: $name"
  done

  [[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] ||
    die "COMPOSE_PROJECT_NAME must use lowercase letters, digits, underscores, or hyphens"
  [[ "$LOCAL_PORT" =~ ^[0-9]+$ ]] &&
    (( 10#$LOCAL_PORT >= 1024 && 10#$LOCAL_PORT <= 65535 )) ||
    die "LOCAL_PORT must be an integer from 1024 through 65535"
  [[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    die "POSTGRES_DB must be a PostgreSQL identifier"
  [[ "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    die "POSTGRES_USER must be a PostgreSQL identifier"
  [[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9._~-]{20,}$ ]] ||
    die "POSTGRES_PASSWORD must contain at least 20 URL-safe characters"
  [[ "$POSTGRES_PASSWORD" != replace-with-* ]] ||
    die "POSTGRES_PASSWORD still uses the example value"
  [[ "$SIMULATION_TERMINATION_ENABLED" == "true" ||
    "$SIMULATION_TERMINATION_ENABLED" == "false" ]] ||
    die "SIMULATION_TERMINATION_ENABLED must be true or false"
  [[ "$DEPLOY_AUTH_ENABLED" == "true" || "$DEPLOY_AUTH_ENABLED" == "false" ]] ||
    die "DEPLOY_AUTH_ENABLED must be true or false"

  if [ "$DEPLOY_AUTH_ENABLED" = "true" ]; then
    local deploy_password="${DEPLOY_PASSWORD:-}"
    [[ "${DEPLOY_USERNAME:-}" =~ ^[A-Za-z0-9._-]{1,64}$ ]] ||
      die "DEPLOY_USERNAME is required when deployment authentication is enabled"
    [[ "$deploy_password" =~ ^[A-Za-z0-9._~-]{20,}$ ]] ||
      die "DEPLOY_PASSWORD must contain at least 20 URL-safe characters"
    [[ "$deploy_password" != replace-with-* ]] ||
      die "DEPLOY_PASSWORD still uses the example value"
  fi
}

compose() {
  docker compose \
    --env-file "$ENV_FILE" \
    --project-directory "$PROJECT_ROOT" \
    --file "$COMPOSE_FILE" \
    "$@"
}

origin_url() {
  printf 'http://127.0.0.1:%s\n' "$LOCAL_PORT"
}

read_public_url() {
  [ -s "$PUBLIC_URL_FILE" ] || return 1
  tr -d '[:space:]' <"$PUBLIC_URL_FILE"
}

is_valid_quick_tunnel_url() {
  [[ "${1:-}" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]]
}

remove_public_url() {
  rm -f "$PUBLIC_URL_FILE"
}

write_deploy_curl_config() {
  local target="$1"
  [ -n "$target" ] || die "Curl configuration path is required"
  umask 077
  : >"$target"
  chmod 600 "$target"
  if [ "$DEPLOY_AUTH_ENABLED" = "true" ]; then
    printf 'user = "%s:%s"\n' "$DEPLOY_USERNAME" "$DEPLOY_PASSWORD" >"$target"
  fi
}
