#!/usr/bin/env bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
CONFIG_DIR="$DEPLOY_DIR/config"
RUNTIME_DIR="$DEPLOY_DIR/runtime"
ENV_FILE="$CONFIG_DIR/deploy.env"
PUBLIC_URL_FILE="$RUNTIME_DIR/public-url"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '[deploy] %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

ensure_runtime_dir() {
  mkdir -p "$RUNTIME_DIR"
  chmod 700 "$RUNTIME_DIR"
}

load_deploy_env() {
  [ -f "$ENV_FILE" ] ||
    die "Missing $ENV_FILE. Run npm run deploy:init first."
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  local name
  for name in \
    LOCAL_HOST \
    LOCAL_PORT \
    DEPLOY_AUTH_ENABLED \
    DEPLOY_USERNAME \
    DEPLOY_PASSWORD; do
    [ -n "${!name:-}" ] || die "Missing required setting: $name"
  done

  [ "$LOCAL_HOST" = "127.0.0.1" ] ||
    die "LOCAL_HOST must be 127.0.0.1"
  [ "$LOCAL_PORT" = "3000" ] ||
    die "LOCAL_PORT must be 3000"
  [ "$DEPLOY_AUTH_ENABLED" = "true" ] ||
    die "DEPLOY_AUTH_ENABLED must be true for public deployment"
  [[ "$DEPLOY_USERNAME" =~ ^[A-Za-z0-9._-]{1,64}$ ]] ||
    die "DEPLOY_USERNAME must use 1-64 letters, digits, dots, underscores, or hyphens"
  [ "${#DEPLOY_PASSWORD}" -ge 20 ] ||
    die "DEPLOY_PASSWORD must contain at least 20 characters"
  [[ "$DEPLOY_PASSWORD" != *$'\n'* ]] ||
    die "DEPLOY_PASSWORD must not contain newlines"
  [[ "$DEPLOY_PASSWORD" != replace-with-* ]] ||
    die "DEPLOY_PASSWORD still uses the example value"
}

origin_url() {
  printf 'http://%s:%s\n' "$LOCAL_HOST" "$LOCAL_PORT"
}

public_url_file() {
  printf '%s\n' "$PUBLIC_URL_FILE"
}

read_public_url() {
  [ -f "$PUBLIC_URL_FILE" ] || return 1
  tr -d '[:space:]' <"$PUBLIC_URL_FILE"
}

is_valid_quick_tunnel_url() {
  [[ "${1:-}" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]]
}

remove_public_url() {
  rm -f "$PUBLIC_URL_FILE"
}

pid_file_for_role() {
  case "$1" in
    next | cloudflared) printf '%s/%s.pid\n' "$RUNTIME_DIR" "$1" ;;
    *) die "Unknown process role: $1" ;;
  esac
}

read_role_pid() {
  local pid_file
  pid_file="$(pid_file_for_role "$1")"
  [ -f "$pid_file" ] || return 1

  local pid
  pid="$(tr -d '[:space:]' <"$pid_file")"
  if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
    printf 'ERROR: Invalid PID file: %s\n' "$pid_file" >&2
    return 2
  fi
  printf '%s\n' "$pid"
}

process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null |
    sed -n 's/^n//p' |
    head -n 1
}

pid_matches_role() {
  local role="$1"
  local pid="$2"
  kill -0 "$pid" 2>/dev/null || return 1

  local command_line
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [ -n "$command_line" ] || return 1

  case "$role" in
    next)
      [ "$(process_cwd "$pid")" = "$PROJECT_ROOT" ] &&
        {
          [[ "$command_line" == *"next-server"* ]] ||
            {
              [[ "$command_line" == *"$PROJECT_ROOT"* ]] &&
                [[ "$command_line" == *"next"* ]] &&
                [[ "$command_line" == *"start"* ]]
            }
        }
      ;;
    cloudflared)
      [[ "$command_line" == *"cloudflared"* ]] &&
        [[ "$command_line" == *"tunnel"* ]] &&
        [[ "$command_line" == *"--url"* ]] &&
        [[ "$command_line" == *"$(origin_url)"* ]]
      ;;
    *) return 1 ;;
  esac
}

stop_role() {
  local role="$1"
  local pid_file
  pid_file="$(pid_file_for_role "$role")"

  if [ ! -f "$pid_file" ]; then
    info "$role is already stopped"
    return 0
  fi

  local pid
  if ! pid="$(read_role_pid "$role")"; then
    printf 'ERROR: Cannot read %s PID safely\n' "$role" >&2
    return 1
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    info "Removed stale $role PID file"
    return 0
  fi

  if ! pid_matches_role "$role" "$pid"; then
    printf 'ERROR: PID %s does not match role %s; refusing to kill it\n' \
      "$pid" "$role" >&2
    return 1
  fi

  info "Stopping $role (PID $pid)"
  kill -TERM "$pid"

  local attempt
  for attempt in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done

  if kill -0 "$pid" 2>/dev/null; then
    if ! pid_matches_role "$role" "$pid"; then
      printf 'ERROR: PID %s changed identity while stopping %s\n' \
        "$pid" "$role" >&2
      return 1
    fi
    info "$role did not exit after TERM; sending KILL"
    kill -KILL "$pid"
    for attempt in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
  fi

  if kill -0 "$pid" 2>/dev/null; then
    printf 'ERROR: %s PID %s remains after KILL\n' "$role" "$pid" >&2
    return 1
  fi
  rm -f "$pid_file"
}

port_listener() {
  lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true
}

assert_loopback_listener() {
  local listeners
  listeners="$(port_listener)"
  [ -n "$listeners" ] || die "Nothing is listening on $LOCAL_HOST:$LOCAL_PORT"
  [[ "$listeners" == *"$LOCAL_HOST:$LOCAL_PORT"* ]] ||
    die "Port $LOCAL_PORT is not bound to $LOCAL_HOST"
  [[ "$listeners" != *"*:$LOCAL_PORT"* ]] ||
    die "Port $LOCAL_PORT is exposed on every interface"
  [[ "$listeners" != *"0.0.0.0:$LOCAL_PORT"* ]] ||
    die "Port $LOCAL_PORT is exposed on 0.0.0.0"
  [[ "$listeners" != *"[::]:$LOCAL_PORT"* ]] ||
    die "Port $LOCAL_PORT is exposed on IPv6"
}

matching_tunnel_processes() {
  pgrep -fl cloudflared 2>/dev/null |
    grep -F -- "tunnel" |
    grep -F -- "--url" |
    grep -F -- "$(origin_url)" || true
}

matching_next_processes() {
  local pid
  for pid in $(pgrep -f 'next-server|next.*start' 2>/dev/null || true); do
    if [ "$(process_cwd "$pid")" = "$PROJECT_ROOT" ]; then
      ps -p "$pid" -o pid=,command= 2>/dev/null || true
    fi
  done
}

acquire_lock() {
  ensure_runtime_dir
  mkdir "$RUNTIME_DIR/lifecycle.lock" 2>/dev/null ||
    die "Another deployment lifecycle command is running"
}

release_lock() {
  rmdir "$RUNTIME_DIR/lifecycle.lock" 2>/dev/null || true
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
  [ -f "$file" ] || die "Missing private file: $file"
  local mode
  mode="$(file_mode "$file")"
  if (( (8#$mode & 077) != 0 )); then
    die "$file must not be accessible by group/others; run chmod 600"
  fi
}
