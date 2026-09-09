#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

[ "$#" -eq 2 ] && [ "$2" = "--confirm" ] ||
  die "Usage: $0 BACKUP_FILE --confirm"
backup_file="$1"
[ -f "$backup_file" ] || die "Backup file does not exist: $backup_file"
[ -s "$backup_file" ] || die "Backup file is empty: $backup_file"
assert_private_file "$backup_file"

require_command docker
load_deploy_env
info "Restore target: database '$POSTGRES_DB' in Compose project '$COMPOSE_PROJECT_NAME'"
info "Explicit --confirm received; beginning restore"

compose exec -T db \
  pg_restore \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --no-privileges <"$backup_file"

info "Restore completed for database '$POSTGRES_DB'"
