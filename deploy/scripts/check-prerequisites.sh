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
