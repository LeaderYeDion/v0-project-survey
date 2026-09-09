#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

require_command docker
load_deploy_env
ensure_backup_dir
umask 077

timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
backup_file="$BACKUP_DIR/survey-${POSTGRES_DB}-${timestamp}-$$.dump"
temporary_file="$(mktemp "$BACKUP_DIR/.survey-backup.XXXXXX")"
cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

compose exec -T db \
  pg_dump \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom \
  --no-owner \
  --no-privileges >"$temporary_file"

[ -s "$temporary_file" ] || die "Database backup is empty"
chmod 600 "$temporary_file"
mv "$temporary_file" "$backup_file"
trap - EXIT

info "Backup created: $backup_file"
printf '%s\n' "$backup_file"
