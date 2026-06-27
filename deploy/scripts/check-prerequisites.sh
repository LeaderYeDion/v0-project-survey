#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env

for command_name in node npm cloudflared curl jq lsof ps pgrep; do
  require_command "$command_name"
done

assert_private_file "$ENV_FILE"
assert_private_file "$ALLOWLIST_FILE"
[ -f "$TUNNEL_CONFIG_PATH" ] ||
  die "Missing Tunnel config: $TUNNEL_CONFIG_PATH"

if grep -Eq 'replace-with|<TUNNEL_UUID>|<HOME>' "$ENV_FILE" "$TUNNEL_CONFIG_PATH"; then
  die "Deployment or Tunnel config still contains example placeholders"
fi

credentials_file="$(
  awk -F': *' '/^[[:space:]]*credentials-file:/ {
    sub(/^[[:space:]]*/, "", $2)
    print $2
    exit
  }' "$TUNNEL_CONFIG_PATH"
)"
[ -n "$credentials_file" ] ||
  die "Tunnel config has no credentials-file"
[ -f "$credentials_file" ] ||
  die "Tunnel credentials do not exist: $credentials_file"

cloudflared tunnel ingress validate --config "$TUNNEL_CONFIG_PATH" >/dev/null

http_origins="$(
  grep -E '^[[:space:]]*service:[[:space:]]*https?://' "$TUNNEL_CONFIG_PATH" ||
    true
)"
[ "$(printf '%s\n' "$http_origins" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1 ] ||
  die "Tunnel config must contain exactly one HTTP origin"
printf '%s\n' "$http_origins" |
  grep -Eq "service:[[:space:]]*http://127\\.0\\.0\\.1:3000[[:space:]]*$" ||
  die "Tunnel origin must be http://127.0.0.1:3000"

grep -Eq "hostname:[[:space:]]*$PUBLIC_HOSTNAME[[:space:]]*$" "$TUNNEL_CONFIG_PATH" ||
  die "Tunnel hostname does not match PUBLIC_HOSTNAME"

last_service="$(
  awk '/^[[:space:]]*-[[:space:]]*service:/ { line=$0 } END { print line }' \
    "$TUNNEL_CONFIG_PATH"
)"
[[ "$last_service" == *"http_status:404"* ]] ||
  die "Tunnel ingress must end with http_status:404"

policy_file="$(mktemp)"
trap 'rm -f "$policy_file"' EXIT
node "$SCRIPT_DIR/render-access-policy.mjs" \
  "$ALLOWLIST_FILE" \
  "${CLOUDFLARE_OTP_IDP_ID:-preflight-only}" >"$policy_file"
jq -e '.decision == "allow" and (.include | length > 0)' "$policy_file" \
  >/dev/null

info "Prerequisites and fail-closed Tunnel configuration are valid"
