#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "$backend_pid" ]]; then
    kill "$backend_pid" 2>/dev/null || true
  fi
  if [[ -n "$frontend_pid" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM
cd "$repo_dir"

npm run dev:backend &
backend_pid=$!
npm run dev &
frontend_pid=$!

while kill -0 "$backend_pid" 2>/dev/null &&
  kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done
