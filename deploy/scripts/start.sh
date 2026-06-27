#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

STARTED_NEXT=0
STARTED_TUNNEL=0

rollback() {
  trap - ERR INT TERM
  info "Startup failed; rolling back deployment processes"
  if [ "$STARTED_TUNNEL" -eq 1 ]; then
    stop_role "cloudflared" || true
  fi
  if [ "$STARTED_NEXT" -eq 1 ]; then
    stop_role "next" || true
  fi
  release_lock
}
trap rollback ERR INT TERM

load_deploy_env
[ "$LOCAL_HOST" = "127.0.0.1" ] ||
  die "Refusing to start: LOCAL_HOST must be 127.0.0.1"
acquire_lock
"$SCRIPT_DIR/check-prerequisites.sh"

for role in next cloudflared; do
  [ ! -f "$(pid_file_for_role "$role")" ] ||
    die "Found $role PID file; run npm stop before starting"
done

[ -z "$(matching_tunnel_processes)" ] ||
  die "A matching cloudflared process is already running"
[ -z "$(port_listener)" ] ||
  die "Port $LOCAL_PORT is already in use; refusing to start or kill its owner"

info "Building the production application"
(cd "$PROJECT_ROOT" && npm run build)

next_log="$RUNTIME_DIR/next.log"
cloudflared_log="$RUNTIME_DIR/cloudflared.log"

info "Starting Next.js on $LOCAL_HOST:$LOCAL_PORT"
nohup "$PROJECT_ROOT/node_modules/.bin/next" start \
  -H "$LOCAL_HOST" \
  -p "$LOCAL_PORT" >"$next_log" 2>&1 &
next_pid=$!
printf '%s\n' "$next_pid" >"$(pid_file_for_role next)"
STARTED_NEXT=1

next_ready=0
for attempt in $(seq 1 60); do
  if ! kill -0 "$next_pid" 2>/dev/null; then
    die "Next.js exited during startup; inspect $next_log"
  fi
  if curl --fail --silent --show-error \
    "http://$LOCAL_HOST:$LOCAL_PORT" >/dev/null 2>&1; then
    next_ready=1
    break
  fi
  sleep 0.25
done
[ "$next_ready" -eq 1 ] ||
  die "Next.js did not become ready; inspect $next_log"
pid_matches_role next "$next_pid" ||
  die "Next.js PID identity check failed"
assert_loopback_listener

info "Starting Cloudflare Tunnel $TUNNEL_NAME"
nohup cloudflared tunnel \
  --config "$TUNNEL_CONFIG_PATH" \
  run "$TUNNEL_NAME" >"$cloudflared_log" 2>&1 &
cloudflared_pid=$!
printf '%s\n' "$cloudflared_pid" >"$(pid_file_for_role cloudflared)"
STARTED_TUNNEL=1

sleep 2
kill -0 "$cloudflared_pid" 2>/dev/null ||
  die "cloudflared exited during startup; inspect $cloudflared_log"
pid_matches_role cloudflared "$cloudflared_pid" ||
  die "cloudflared PID identity check failed"

trap - ERR INT TERM
release_lock

info "Deployment is running"
info "Local:  http://$LOCAL_HOST:$LOCAL_PORT"
info "Public: https://$PUBLIC_HOSTNAME"
info "Stop:   npm stop"
info "Logs:   $next_log and $cloudflared_log"
