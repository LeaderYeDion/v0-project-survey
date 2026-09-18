import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)
const cwd = fileURLToPath(new URL("../..", import.meta.url))

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "survey-restore-lifecycle-"))
  const bin = join(dir, "bin")
  await mkdir(bin)
  const log = join(dir, "commands")
  const envFile = join(dir, "deploy.env")
  const seedFile = join(dir, "seed.json")
  const backup = join(dir, "backup with spaces.dump")
  await writeFile(envFile, "COMPOSE_PROJECT_NAME=survey-restore-test\nLOCAL_PORT=3000\nPOSTGRES_DB=survey\nPOSTGRES_USER=survey\nPOSTGRES_PASSWORD=contract-password-at-least-20\nSIMULATION_TERMINATION_ENABLED=false\nDEPLOY_AUTH_ENABLED=false\n", { mode: 0o600 })
  await writeFile(seedFile, "[]", { mode: 0o600 })
  await writeFile(backup, "PGDMP-contract", { mode: 0o600 })
  await writeFile(join(bin, "docker"), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$COMMAND_LOG"
case "$*" in
  *"config --quiet"*) stage=config ;;
  *"pg_restore --list"*) stage=archive; cat >/dev/null ;;
  *"psql "*) stage=target; printf '%s\\n' "\${FAKE_TARGET:-survey}" ;;
  *" stop "*) stage=stop ;;
  *" up "*" db") stage=db ;;
  *"pg_restore "*) stage=restore; cat >/dev/null ;;
  *" run "*) stage=prepare ;;
  *" up "*" frontend") stage=restart ;;
  *) printf 'Unexpected command: %s\\n' "$*" >&2; exit 90 ;;
esac
[ "$stage" != "\${FAIL_STAGE:-}" ] || exit 42
`, { mode: 0o700 })
  await writeFile(join(bin, "curl"), `#!/usr/bin/env bash
printf 'health %s\\n' "$*" >>"$COMMAND_LOG"
[ "\${FAIL_STAGE:-}" != health ] || exit 43
`, { mode: 0o700 })
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: log, DEPLOY_ENV_FILE: envFile, DEPLOY_SEED_USERS_FILE: seedFile }
  return { dir, backup, seedFile, envFile, env, commands: async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean) }
}

function restore(f, extra = {}, args = [f.backup, "--confirm"]) {
  return run("bash", ["deploy/scripts/restore-db.sh", ...args], { cwd, env: { ...f.env, ...extra } })
}

test("restore validates then quiesces writers, restores atomically, prepares and health-checks startup in order", async () => {
  const f = await fixture()
  await restore(f)
  const commands = await f.commands()
  assert.equal(commands.length, 9)
  assert.match(commands[0], /config --quiet$/)
  assert.match(commands[1], /pg_restore --list$/)
  assert.match(commands[2], /psql .*--dbname=survey .*SELECT current_database\(\)/)
  assert.match(commands[3], /--profile public stop cloudflared frontend backend$/)
  assert.match(commands[4], /up --detach --no-deps --wait --wait-timeout 180 db$/)
  assert.match(commands[5], /pg_restore .*--dbname=survey .*--single-transaction/)
  assert.match(commands[5], /--clean --if-exists --exit-on-error --no-owner --no-privileges/)
  assert.match(commands[6], /run --rm --no-deps -T backend --prepare-only$/)
  assert.match(commands[7], /up --detach --wait --wait-timeout 180 frontend$/)
  assert.match(commands[8], /^health .*http:\/\/127\.0\.0\.1:3000\/survey-api\/health$/)
  assert.doesNotMatch(commands.join("\n"), /down|--volumes|--create/)
})

for (const failStage of ["config", "archive", "target"]) {
  test(`restore ${failStage} preflight failure does not stop or mutate services`, async () => {
    const f = await fixture()
    await assert.rejects(restore(f, { FAIL_STAGE: failStage }))
    assert.doesNotMatch((await f.commands()).join("\n"), / stop | up | run |--clean/)
  })
}

test("restore rejects missing confirmation, invalid archive and reserved/mismatched targets before mutation", async () => {
  for (const kind of ["confirmation", "archive", "reserved", "mismatch"]) {
    const f = await fixture()
    if (kind === "archive") await writeFile(f.backup, "not-a-pg-dump")
    const env = kind === "reserved" ? { POSTGRES_DB: "postgres" } : kind === "mismatch" ? { FAKE_TARGET: "another_database" } : {}
    await assert.rejects(restore(f, env, kind === "confirmation" ? [f.backup] : undefined))
    assert.doesNotMatch((await f.commands()).join("\n"), / stop | up | run |--clean/)
  }
})

for (const failStage of ["stop", "db", "restore", "prepare", "restart", "health"]) {
  test(`restore ${failStage} failure stops app services and gives target-specific recovery without automatic restart`, async () => {
    const f = await fixture()
    let failure
    await assert.rejects(restore(f, { FAIL_STAGE: failStage }), error => { failure = error; return true })
    const commands = await f.commands()
    assert.match(commands.at(-1), /--profile public stop cloudflared frontend backend$/)
    if (!["restart", "health"].includes(failStage)) assert.doesNotMatch(commands.join("\n"), / up .* frontend/)
    assert.doesNotMatch(commands.join("\n"), /down|--volumes/)
    assert.match(failure.stderr, /Do not start frontend or backend/)
    assert.match(failure.stderr, /survey-restore-test.*survey/)
    assert.match(failure.stderr, /restore-db\.sh .*--confirm/)
    assert.match(failure.stderr, /DEPLOY_ENV_FILE=/)
    assert.match(failure.stderr, /DEPLOY_SEED_USERS_FILE=/)
    assert.match(failure.stderr, /docker compose .*stop cloudflared frontend backend/)
    assert.match(failure.stderr, /docker compose .*up --detach --no-deps --wait db/)
    if (failStage === "stop") assert.match(failure.stderr, /could not confirm.*stopped/i)
  })
}

for (const scenario of ["prepare", "serve", "migration-fails", "seed-fails", "invalid-argument"]) {
  test(`backend entrypoint ${scenario} obeys migration/seed/server ordering`, async () => {
    const f = await fixture()
    const bin = join(f.dir, "bin")
    await writeFile(join(bin, "id"), "#!/usr/bin/env bash\nprintf '10001\\n'\n", { mode: 0o700 })
    for (const name of ["alembic", "python", "uvicorn"]) {
      await writeFile(join(bin, name), `#!/usr/bin/env bash
printf '${name} %s\\n' "$*" >>"$COMMAND_LOG"
[ "\${FAIL_COMMAND:-}" != ${name} ] || exit 42
`, { mode: 0o700 })
    }
    const args = scenario === "serve" ? [] : [scenario === "invalid-argument" ? "--typo" : "--prepare-only"]
    const invocation = run("bash", ["backend/docker-entrypoint.sh", ...args], { cwd, env: { ...f.env, SEED_USERS_FILE: f.seedFile, FAIL_COMMAND: scenario === "migration-fails" ? "alembic" : scenario === "seed-fails" ? "python" : "" } })
    if (["migration-fails", "seed-fails", "invalid-argument"].includes(scenario)) await assert.rejects(invocation)
    else await invocation
    const commands = await f.commands()
    if (scenario === "invalid-argument") assert.deepEqual(commands, [])
    else {
      assert.equal(commands[0], "alembic upgrade head")
      if (scenario !== "migration-fails") assert.equal(commands[1], `python -m app.cli seed-users --file ${f.seedFile}`)
      assert.equal(commands.length, scenario === "serve" ? 3 : scenario === "migration-fails" ? 1 : 2)
      if (scenario === "serve") assert.match(commands[2], /^uvicorn app.main:app --host 0.0.0.0 --port 8000$/)
    }
  })
}
