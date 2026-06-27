#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_deploy_env
for command_name in node curl jq; do
  require_command "$command_name"
done

for name in \
  CLOUDFLARE_ACCOUNT_ID \
  CLOUDFLARE_ACCESS_APP_ID \
  CLOUDFLARE_ACCESS_POLICY_ID \
  CLOUDFLARE_OTP_IDP_ID \
  CLOUDFLARE_API_TOKEN; do
  value="${!name:-}"
  [ -n "$value" ] || die "Missing required Access setting: $name"
  [[ "$value" != replace-with-* ]] ||
    die "$name still uses an example value"
done

assert_private_file "$ENV_FILE"
assert_private_file "$ALLOWLIST_FILE"

payload_file="$(mktemp)"
response_file="$(mktemp)"
cleanup() {
  rm -f "$payload_file" "$response_file"
}
trap cleanup EXIT

node "$SCRIPT_DIR/render-access-policy.mjs" \
  "$ALLOWLIST_FILE" \
  "$CLOUDFLARE_OTP_IDP_ID" >"$payload_file"

endpoint="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$CLOUDFLARE_ACCESS_APP_ID/policies/$CLOUDFLARE_ACCESS_POLICY_ID"
http_code="$(
  curl --silent --show-error \
    --output "$response_file" \
    --write-out '%{http_code}' \
    --request PUT \
    --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    --header "Content-Type: application/json" \
    --data-binary "@$payload_file" \
    "$endpoint"
)"

if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ] ||
  ! jq -e '.success == true' "$response_file" >/dev/null 2>&1; then
  jq -r '.errors[]? | "Cloudflare error \(.code): \(.message)"' \
    "$response_file" >&2 || true
  die "Cloudflare rejected the Access policy update (HTTP $http_code)"
fi

email_count="$(jq '.include | length' "$payload_file")"
policy_id="$(jq -r '.result.id // "unknown"' "$response_file")"
info "Access policy $policy_id synchronized with $email_count allowed email(s)"
