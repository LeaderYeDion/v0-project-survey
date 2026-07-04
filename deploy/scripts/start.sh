#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

STARTED_BACKEND=0
STARTED_NEXT=0
STARTED_TUNNEL=0
STARTUP_COMPLETE=0
HEALTH_CONFIG=""

rollback() {
  trap - ERR INT TERM EXIT
  info "Startup failed; rolling back deployment processes"
  if [ "$STARTED_TUNNEL" -eq 1 ]; then
    stop_role "cloudflared" || true
  fi
  remove_public_url
  if [ "$STARTED_NEXT" -eq 1 ]; then
    stop_role "next" || true
  fi
  if [ "$STARTED_BACKEND" -eq 1 ]; then
    stop_role "backend" || true
  fi
  [ -z "$HEALTH_CONFIG" ] || rm -f "$HEALTH_CONFIG"
  release_lock
}

handle_signal() {
  local exit_code="$1"
  rollback
  exit "$exit_code"
}

cleanup_on_exit() {
  local exit_code=$?
  trap - EXIT
  if [ "$STARTUP_COMPLETE" -eq 0 ] && [ "$exit_code" -ne 0 ]; then
    rollback
  fi
  exit "$exit_code"
}

trap rollback ERR
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM
trap cleanup_on_exit EXIT

load_deploy_env
[ "$LOCAL_HOST" = "127.0.0.1" ] ||
  die "Refusing to start: LOCAL_HOST must be 127.0.0.1"
acquire_lock
"$SCRIPT_DIR/check-prerequisites.sh"

for role in backend next cloudflared; do
  [ ! -f "$(pid_file_for_role "$role")" ] ||
    die "Found $role PID file; run npm stop before starting"
done

[ ! -e "$(public_url_file)" ] ||
  die "Found a stale public URL; run npm stop before starting"
[ -z "$(matching_tunnel_processes)" ] ||
  die "A matching Quick Tunnel process is already running"
[ -z "$(matching_next_processes)" ] ||
  die "A matching Next.js production process is already running"
[ -z "$(matching_backend_processes)" ] ||
  die "A matching FastAPI backend process is already running"
[ -z "$(port_listener "$LOCAL_PORT")" ] ||
  die "Port $LOCAL_PORT is already in use; refusing to start or kill its owner"
[ -z "$(port_listener "$BACKEND_PORT")" ] ||
  die "Port $BACKEND_PORT is already in use; refusing to start or kill its owner"

info "Building the production application"
(cd "$PROJECT_ROOT" && npm run build)

backend_log="$RUNTIME_DIR/backend.log"
next_log="$RUNTIME_DIR/next.log"
cloudflared_log="$RUNTIME_DIR/cloudflared.log"

info "Starting FastAPI on $BACKEND_HOST:$BACKEND_PORT"
(
  cd "$PROJECT_ROOT/backend"
  nohup "$PROJECT_ROOT/backend/.venv/bin/uvicorn" app.main:app \
    --host "$BACKEND_HOST" \
    --port "$BACKEND_PORT" >"$backend_log" 2>&1 &
  printf '%s\n' "$!" >"$(pid_file_for_role backend)"
)
backend_pid="$(read_role_pid backend)"
STARTED_BACKEND=1

backend_ready=0
for attempt in $(seq 1 80); do
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    die "FastAPI exited during startup; inspect $backend_log"
  fi
  backend_status="$(
    curl --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --max-time 5 \
      "$(backend_origin_url)/api/health" 2>/dev/null || true
  )"
  if [ "$backend_status" = "200" ]; then
    backend_ready=1
    break
  fi
  sleep 0.25
done
[ "$backend_ready" -eq 1 ] ||
  die "FastAPI health check failed; inspect $backend_log"
pid_matches_role backend "$backend_pid" ||
  die "FastAPI PID identity check failed"
assert_loopback_listener "$BACKEND_HOST" "$BACKEND_PORT"

info "Starting Next.js on $LOCAL_HOST:$LOCAL_PORT"
nohup "$PROJECT_ROOT/node_modules/.bin/next" start \
  -H "$LOCAL_HOST" \
  -p "$LOCAL_PORT" >"$next_log" 2>&1 &
next_pid=$!
printf '%s\n' "$next_pid" >"$(pid_file_for_role next)"
STARTED_NEXT=1

basic_token="$(
  printf '%s' "$DEPLOY_USERNAME:$DEPLOY_PASSWORD" |
    openssl base64 -A
)"
HEALTH_CONFIG="$(mktemp "$RUNTIME_DIR/curl-health.XXXXXX")"
chmod 600 "$HEALTH_CONFIG"
{
  printf 'silent\n'
  printf 'show-error\n'
  printf 'connect-timeout = 3\n'
  printf 'max-time = 5\n'
  printf 'header = "Authorization: Basic %s"\n' "$basic_token"
} >"$HEALTH_CONFIG"
unset basic_token

local_url="$(origin_url)/"
local_backend_url="$(origin_url)/survey-api/health"
next_ready=0
for attempt in $(seq 1 80); do
  if ! kill -0 "$next_pid" 2>/dev/null; then
    die "Next.js exited during startup; inspect $next_log"
  fi
  authenticated_status="$(
    curl --config "$HEALTH_CONFIG" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$local_url" 2>/dev/null || true
  )"
  if [ "$authenticated_status" = "200" ]; then
    next_ready=1
    break
  fi
  sleep 0.25
done
[ "$next_ready" -eq 1 ] ||
  die "Authenticated local health check failed; inspect $next_log"

authenticated_backend_status="$(
  curl --config "$HEALTH_CONFIG" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$local_backend_url" 2>/dev/null || true
)"
[ "$authenticated_backend_status" = "200" ] ||
  die "Authenticated backend proxy health check failed; inspect $next_log and $backend_log"

unauthenticated_status="$(
  curl --silent \
    --output /dev/null \
    --write-out '%{http_code}' \
    --max-time 5 \
    "$local_url" 2>/dev/null || true
)"
[ "$unauthenticated_status" = "401" ] ||
  die "Unauthenticated local request was not rejected"
unauthenticated_backend_status="$(
  curl --silent \
    --output /dev/null \
    --write-out '%{http_code}' \
    --max-time 5 \
    "$local_backend_url" 2>/dev/null || true
)"
[ "$unauthenticated_backend_status" = "401" ] ||
  die "Unauthenticated backend proxy request was not rejected"
pid_matches_role next "$next_pid" ||
  die "Next.js PID identity check failed"
assert_loopback_listener "$LOCAL_HOST" "$LOCAL_PORT"

info "Starting zero-cost Cloudflare Quick Tunnel"
nohup cloudflared tunnel \
  --url "$(origin_url)" >"$cloudflared_log" 2>&1 &
cloudflared_pid=$!
printf '%s\n' "$cloudflared_pid" >"$(pid_file_for_role cloudflared)"
STARTED_TUNNEL=1

public_url=""
for attempt in $(seq 1 120); do
  if ! kill -0 "$cloudflared_pid" 2>/dev/null; then
    die "cloudflared exited during startup; inspect $cloudflared_log"
  fi
  public_url="$(
    grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' \
      "$cloudflared_log" |
      tail -n 1 || true
  )"
  if is_valid_quick_tunnel_url "$public_url"; then
    break
  fi
  sleep 0.25
done
is_valid_quick_tunnel_url "$public_url" ||
  die "Quick Tunnel did not provide a valid public URL; inspect $cloudflared_log"
printf '%s\n' "$public_url" >"$(public_url_file)"

pid_matches_role cloudflared "$cloudflared_pid" ||
  die "cloudflared PID identity check failed"

info "Waiting for Quick Tunnel DNS and edge warm-up"
sleep 15
kill -0 "$cloudflared_pid" 2>/dev/null ||
  die "cloudflared exited during DNS warm-up; inspect $cloudflared_log"

public_ready=0
for attempt in $(seq 1 60); do
  unauthenticated_status="$(
    curl --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --max-time 5 \
      "$public_url" 2>/dev/null || true
  )"
  authenticated_status="$(
    curl --config "$HEALTH_CONFIG" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$public_url" 2>/dev/null || true
  )"
  authenticated_backend_status="$(
    curl --config "$HEALTH_CONFIG" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$public_url/survey-api/health" 2>/dev/null || true
  )"
  if [ "$unauthenticated_status" = "401" ] &&
    [ "$authenticated_status" = "200" ] &&
    [ "$authenticated_backend_status" = "200" ]; then
    public_ready=1
    break
  fi
  sleep 1
done
[ "$public_ready" -eq 1 ] ||
  die "Public verification failed (unauthenticated HTTP ${unauthenticated_status:-none}, page HTTP ${authenticated_status:-none}, backend HTTP ${authenticated_backend_status:-none}); inspect $cloudflared_log"

rm -f "$HEALTH_CONFIG"
HEALTH_CONFIG=""
STARTUP_COMPLETE=1
trap - ERR INT TERM EXIT
release_lock

info "Deployment is running"
info "Public: $public_url"
info "Login:  use DEPLOY_USERNAME and DEPLOY_PASSWORD from $ENV_FILE"
info "Stop:   npm stop"
info "Logs:   $backend_log, $next_log and $cloudflared_log"
