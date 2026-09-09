#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

initialize=0
public=0
build=1
for argument in "$@"; do
  case "$argument" in
    --init) initialize=1 ;;
    --public) public=1 ;;
    --no-build) build=0 ;;
    *) die "Usage: $0 [--init] [--public] [--no-build]" ;;
  esac
done

if [ "$initialize" -eq 1 ] &&
  { [ ! -e "$ENV_FILE" ] || [ ! -e "$SEED_USERS_FILE" ]; }; then
  "$SCRIPT_DIR/init-config.sh"
fi

"$SCRIPT_DIR/check-prerequisites.sh"
load_deploy_env
ensure_runtime_dir
remove_public_url

started=0
complete=0
health_config=""
cleanup() {
  exit_code=$?
  trap - EXIT
  if [ "$complete" -eq 0 ] && [ "$started" -eq 1 ]; then
    info "Startup failed; stopping Compose services without deleting data"
    compose --profile public down --remove-orphans || true
    remove_public_url
  fi
  [ -z "$health_config" ] || rm -f "$health_config"
  exit "$exit_code"
}
trap cleanup EXIT

if [ "$build" -eq 1 ]; then
  info "Building independently deployable frontend and backend images"
  compose build
fi

info "Starting database, backend, and frontend"
started=1
compose up \
  --detach \
  --wait \
  --wait-timeout "${STARTUP_TIMEOUT_SECONDS:-180}" \
  frontend

health_config="$(mktemp "$RUNTIME_DIR/curl-health.XXXXXX")"
chmod 600 "$health_config"
{
  printf 'silent\n'
  printf 'show-error\n'
  printf 'fail\n'
  printf 'connect-timeout = 3\n'
  printf 'max-time = 10\n'
  if [ "$DEPLOY_AUTH_ENABLED" = "true" ]; then
    printf 'user = "%s:%s"\n' "$DEPLOY_USERNAME" "$DEPLOY_PASSWORD"
  fi
} >"$health_config"

curl --config "$health_config" "$(origin_url)/survey-api/health" >/dev/null
info "Local application is healthy at $(origin_url)"

if [ "$public" -eq 1 ]; then
  info "Starting optional Cloudflare Quick Tunnel"
  compose --profile public up \
    --detach \
    --wait \
    --wait-timeout "${STARTUP_TIMEOUT_SECONDS:-180}" \
    cloudflared

  public_url=""
  for _attempt in $(seq 1 120); do
    public_url="$(
      compose --profile public logs --no-color cloudflared 2>/dev/null |
        grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' |
        tail -n 1 || true
    )"
    if is_valid_quick_tunnel_url "$public_url"; then
      break
    fi
    sleep 0.5
  done
  is_valid_quick_tunnel_url "$public_url" ||
    die "Quick Tunnel did not provide a valid public URL"

  public_ready=0
  for _attempt in $(seq 1 60); do
    if curl --config "$health_config" \
      "$public_url/survey-api/health" >/dev/null 2>&1; then
      public_ready=1
      break
    fi
    sleep 1
  done
  [ "$public_ready" -eq 1 ] || die "Quick Tunnel health verification failed"
  printf '%s\n' "$public_url" >"$PUBLIC_URL_FILE"
  chmod 600 "$PUBLIC_URL_FILE"
  info "Public application: $public_url"
fi

rm -f "$health_config"
complete=1
trap - EXIT
info "Core services are running; data volume was preserved"
