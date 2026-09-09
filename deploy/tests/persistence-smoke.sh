#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../scripts/common.sh"

require_command curl
require_command docker
require_command node
load_deploy_env
assert_private_file "$SEED_USERS_FILE"

base_url="$(origin_url)"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/survey-persistence.XXXXXX")"
isolated_started=0
isolated_env=""
isolated_project=""
isolated_db=""

cleanup() {
  if [ "$isolated_started" -eq 1 ]; then
    COMPOSE_PROJECT_NAME="$isolated_project" \
      POSTGRES_DB="$isolated_db" \
      ENV_FILE="$isolated_env" \
      compose --profile public down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT
umask 077

cookie_a="$temporary_dir/user-a.cookies"
cookie_b="$temporary_dir/user-b.cookies"
login_a="$temporary_dir/login-a.json"
login_b="$temporary_dir/login-b.json"

node - "$SEED_USERS_FILE" "$login_a" "$login_b" <<'NODE'
const fs = require("node:fs")
const [seedPath, loginAPath, loginBPath] = process.argv.slice(2)
const users = JSON.parse(fs.readFileSync(seedPath, "utf8"))
if (!Array.isArray(users) || users.length !== 5) {
  throw new Error("seed file must contain exactly five users")
}
fs.writeFileSync(loginAPath, JSON.stringify({
  username: users[0].username,
  password: users[0].password,
}), { mode: 0o600 })
fs.writeFileSync(loginBPath, JSON.stringify({
  username: users[1].username,
  password: users[1].password,
}), { mode: 0o600 })
NODE

json_field() {
  node -e '
const fs = require("node:fs")
const value = process.argv[2].split(".").reduce((item, key) => item?.[key], JSON.parse(fs.readFileSync(process.argv[1], "utf8")))
if (value === undefined || value === null) process.exit(2)
process.stdout.write(String(value))
' "$1" "$2"
}

csrf_token() {
  awk '$6 == "survey_csrf" { value = $7 } END { print value }' "$1"
}

api_login() {
  local payload="$1"
  local cookie_jar="$2"
  local output="$3"
  curl --fail-with-body --silent --show-error \
    --cookie-jar "$cookie_jar" \
    --header 'Accept-Language: zh-CN' \
    --header 'Content-Type: application/json' \
    --data-binary "@$payload" \
    "$base_url/survey-api/auth/login" >"$output"
}

api_get() {
  local cookie_jar="$1"
  local path="$2"
  local output="$3"
  curl --fail-with-body --silent --show-error \
    --cookie "$cookie_jar" \
    --header 'Accept-Language: zh-CN' \
    "$base_url/survey-api$path" >"$output"
}

api_post() {
  local cookie_jar="$1"
  local path="$2"
  local output="$3"
  local payload="${4:-}"
  local csrf
  csrf="$(csrf_token "$cookie_jar")"
  [ -n "$csrf" ] || die "CSRF cookie was not issued"

  request=(
    --fail-with-body
    --silent
    --show-error
    --request POST
    --cookie "$cookie_jar"
    --header 'Accept-Language: zh-CN'
    --header "Origin: $base_url"
    --header "X-CSRF-Token: $csrf"
  )
  if [ -n "$payload" ]; then
    request+=(--header 'Content-Type: application/json' --data-binary "@$payload")
  fi
  curl "${request[@]}" "$base_url/survey-api$path" >"$output"
}

wait_for_round() {
  local cookie_jar="$1"
  local round_id="$2"
  local output="$3"
  local status=""
  for _attempt in $(seq 1 160); do
    api_get "$cookie_jar" "/rounds/$round_id" "$output"
    status="$(json_field "$output" status)"
    case "$status" in
      completed | completed_with_errors | paused | cancelled | failed) return 0 ;;
    esac
    sleep 0.25
  done
  die "Round $round_id did not reach a durable observable state (last status: $status)"
}

wait_for_frontend() {
  for _attempt in $(seq 1 120); do
    if curl --fail --silent --max-time 5 \
      "$base_url/survey-api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  die "Frontend/backend health did not recover"
}

info "Logging in as two independently seeded application users"
api_login "$login_a" "$cookie_a" "$temporary_dir/user-a.json"
api_login "$login_b" "$cookie_b" "$temporary_dir/user-b.json"

project_payload="$temporary_dir/project.json"
printf '%s\n' \
  '{"name":"Task 9 persistence smoke","researchGoal":"Verify durable PostgreSQL state","principalName":"Smoke Test"}' \
  >"$project_payload"
api_post "$cookie_a" "/projects" "$temporary_dir/project-created.json" "$project_payload"
project_id="$(json_field "$temporary_dir/project-created.json" id)"

questionnaire_payload="$temporary_dir/questionnaire.json"
printf '%s\n' '{
  "mode":"survey",
  "config":{
    "title":"Durable smoke questionnaire",
    "description":"One deterministic persistence question",
    "questions":[{"id":"q1","type":"choice","question":"Choose one","options":["A","B"]}],
    "maxResponseTime":30,
    "respondentConfigs":[{"id":"group-1","gender":"all","ageRange":"18-65","occupation":"all","city":"Hangzhou","income":"all","count":2}],
    "inferenceConfig":null
  }
}' >"$questionnaire_payload"
api_post \
  "$cookie_a" \
  "/projects/$project_id/questionnaires" \
  "$temporary_dir/questionnaire-created.json" \
  "$questionnaire_payload"
questionnaire_id="$(json_field "$temporary_dir/questionnaire-created.json" id)"

api_post \
  "$cookie_a" \
  "/questionnaires/$questionnaire_id/rounds" \
  "$temporary_dir/round-created.json"
round_id="$(json_field "$temporary_dir/round-created.json" id)"
wait_for_round "$cookie_a" "$round_id" "$temporary_dir/round.json"

info "Verifying cross-owner reads are indistinguishable from missing resources"
for path in \
  "/projects/$project_id" \
  "/questionnaires/$questionnaire_id" \
  "/questionnaires/$questionnaire_id/versions" \
  "/rounds/$round_id"; do
  status_code="$(
    curl --silent --show-error \
      --output "$temporary_dir/cross-owner.json" \
      --write-out '%{http_code}' \
      --cookie "$cookie_b" \
      --header 'Accept-Language: zh-CN' \
      "$base_url/survey-api$path"
  )"
  [ "$status_code" = "404" ] ||
    die "Cross-owner request $path returned HTTP $status_code instead of 404"
  [ "$(json_field "$temporary_dir/cross-owner.json" code)" = "RESOURCE_NOT_FOUND" ] ||
    die "Cross-owner request $path did not use RESOURCE_NOT_FOUND"
done

analytics_payload="$temporary_dir/analytics-query.json"
printf '%s\n' '{"questionId":"q1","filters":{},"groupBy":[]}' >"$analytics_payload"
api_post \
  "$cookie_a" \
  "/rounds/$round_id/analytics/query" \
  "$temporary_dir/analytics.json" \
  "$analytics_payload"
[ "$(json_field "$temporary_dir/analytics.json" scope.populationCount)" = "2" ] ||
  die "Live PostgreSQL analytics did not report the expected population"

info "Restarting only the backend and verifying the round persists"
compose restart backend
wait_for_frontend
api_get "$cookie_a" "/rounds/$round_id" "$temporary_dir/after-restart.json"
[ "$(json_field "$temporary_dir/after-restart.json" id)" = "$round_id" ] ||
  die "Round changed after backend restart"

info "Performing ordinary down/up without deleting the named volume"
DEPLOY_ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/../scripts/stop.sh"
compose up \
  --detach \
  --wait \
  --wait-timeout "${STARTUP_TIMEOUT_SECONDS:-180}" \
  frontend
wait_for_frontend
api_get "$cookie_a" "/rounds/$round_id" "$temporary_dir/after-down-up.json"
[ "$(json_field "$temporary_dir/after-down-up.json" id)" = "$round_id" ] ||
  die "Round changed after ordinary Compose down/up"

source_project_count="$(
  compose exec -T db psql \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command 'SELECT count(*) FROM projects;' |
    tr -d '[:space:]'
)"

info "Creating a private custom-format backup"
backup_output="$(
  DEPLOY_ENV_FILE="$ENV_FILE" \
    DEPLOY_BACKUP_DIR="$BACKUP_DIR" \
    "$SCRIPT_DIR/../scripts/backup-db.sh"
)"
backup_file="$(printf '%s\n' "$backup_output" | tail -n 1)"
[ -s "$backup_file" ] || die "Backup smoke artifact is empty"
[ "$(file_mode "$backup_file")" = "600" ] || die "Backup is not mode 600"

info "Restoring the backup into an isolated Compose database"
isolated_project="${COMPOSE_PROJECT_NAME}-restore-$RANDOM"
isolated_db="${POSTGRES_DB}_restore_$RANDOM"
isolated_env="$temporary_dir/restore.env"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    COMPOSE_PROJECT_NAME=*) printf 'COMPOSE_PROJECT_NAME=%s\n' "$isolated_project" ;;
    POSTGRES_DB=*) printf 'POSTGRES_DB=%s\n' "$isolated_db" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <"$ENV_FILE" >"$isolated_env"
chmod 600 "$isolated_env"

COMPOSE_PROJECT_NAME="$isolated_project" \
  POSTGRES_DB="$isolated_db" \
  ENV_FILE="$isolated_env" \
  compose up \
  --detach \
  --wait \
  --wait-timeout "${STARTUP_TIMEOUT_SECONDS:-180}" \
  db
isolated_started=1

COMPOSE_PROJECT_NAME="$isolated_project" \
  POSTGRES_DB="$isolated_db" \
  DEPLOY_ENV_FILE="$isolated_env" \
  "$SCRIPT_DIR/../scripts/restore-db.sh" "$backup_file" --confirm

restored_project_count="$(
  COMPOSE_PROJECT_NAME="$isolated_project" \
    POSTGRES_DB="$isolated_db" \
    ENV_FILE="$isolated_env" \
    compose exec -T db psql \
    --username="$POSTGRES_USER" \
    --dbname="$isolated_db" \
    --tuples-only \
    --no-align \
    --command 'SELECT count(*) FROM projects;' |
    tr -d '[:space:]'
)"
[ "$restored_project_count" = "$source_project_count" ] ||
  die "Isolated restore project count $restored_project_count differs from source $source_project_count"

info "Persistence smoke passed for round $round_id and isolated restore database $isolated_db"
