#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env

for command_name in node npm cloudflared curl lsof ps pgrep openssl; do
  require_command "$command_name"
done

assert_private_file "$ENV_FILE"

backend_python="$PROJECT_ROOT/backend/.venv/bin/python"
backend_uvicorn="$PROJECT_ROOT/backend/.venv/bin/uvicorn"
[ -x "$backend_python" ] && [ -x "$backend_uvicorn" ] ||
  die "Backend environment is missing. Run bash backend/scripts/bootstrap.sh"
"$backend_python" -c \
  'import sys, fastapi, uvicorn; assert sys.version_info[:3] == (3, 14, 6)' ||
  die "Backend requires Python 3.14.6 with FastAPI and Uvicorn; run bash backend/scripts/bootstrap.sh"

for config_path in \
  "$HOME/.cloudflared/config.yml" \
  "$HOME/.cloudflared/config.yaml" \
  "/etc/cloudflared/config.yml" \
  "/etc/cloudflared/config.yaml" \
  "/usr/local/etc/cloudflared/config.yml" \
  "/usr/local/etc/cloudflared/config.yaml"; do
  [ ! -f "$config_path" ] ||
    die "Quick Tunnel cannot use the default config $config_path; rename it before starting"
done

info "Zero-cost Quick Tunnel prerequisites are valid"
