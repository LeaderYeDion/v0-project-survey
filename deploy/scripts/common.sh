#!/usr/bin/env bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
CONFIG_DIR="$DEPLOY_DIR/config"
RUNTIME_DIR="$DEPLOY_DIR/runtime"
ENV_FILE="$CONFIG_DIR/deploy.env"
ALLOWLIST_FILE="$CONFIG_DIR/allowed-emails.txt"

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
  [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE. Copy deploy.env.example first."
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  local name
  for name in PUBLIC_HOSTNAME LOCAL_HOST LOCAL_PORT TUNNEL_NAME TUNNEL_CONFIG_PATH; do
    [ -n "${!name:-}" ] || die "Missing required setting: $name"
  done

  [ "$LOCAL_HOST" = "127.0.0.1" ] ||
    die "LOCAL_HOST must be 127.0.0.1"
  [ "$LOCAL_PORT" = "3000" ] ||
    die "LOCAL_PORT must be 3000"
  [[ "$PUBLIC_HOSTNAME" != *"example.com"* ]] ||
    die "PUBLIC_HOSTNAME still uses the example domain"
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
  [[ "$pid" =~ ^[0-9]+$ ]] || die "Invalid PID file: $pid_file"
  printf '%s\n' "$pid"
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
      [[ "$command_line" == *"$PROJECT_ROOT"* ]] &&
        [[ "$command_line" == *"next"* ]] &&
        [[ "$command_line" == *"start"* ]]
      ;;
    cloudflared)
      [[ "$command_line" == *"cloudflared"* ]] &&
        [[ "$command_line" == *"run"* ]] &&
        [[ "$command_line" == *"$TUNNEL_NAME"* ]]
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
  pid="$(read_role_pid "$role")"
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    info "Removed stale $role PID file"
    return 0
  fi

  pid_matches_role "$role" "$pid" ||
    die "PID $pid does not match role $role; refusing to kill it"

  info "Stopping $role (PID $pid)"
  kill -TERM "$pid"

  local attempt
  for attempt in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done

  if kill -0 "$pid" 2>/dev/null; then
    pid_matches_role "$role" "$pid" ||
      die "PID $pid changed identity while stopping $role"
    info "$role did not exit after TERM; sending KILL"
    kill -KILL "$pid"
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
    grep -F -- "$TUNNEL_NAME" |
    grep -F -- "run" || true
}

matching_next_processes() {
  pgrep -fl next 2>/dev/null |
    grep -F -- "$PROJECT_ROOT" |
    grep -F -- "start" || true
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
    die "$file must not be readable, writable, or executable by group/others; run chmod 600"
  fi
}
