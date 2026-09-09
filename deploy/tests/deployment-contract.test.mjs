import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = fileURLToPath(new URL("../..", import.meta.url))
const read = path =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8")

async function privateEnvironment(tempDir) {
  const envFile = join(tempDir, "deploy.env")
  await writeFile(
    envFile,
    [
      "COMPOSE_PROJECT_NAME=survey-contract",
      "LOCAL_PORT=3000",
      "POSTGRES_DB=survey",
      "POSTGRES_USER=survey",
      "POSTGRES_PASSWORD=contract-password-at-least-20",
      "SIMULATION_TERMINATION_ENABLED=false",
      "DEPLOY_AUTH_ENABLED=false",
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  return envFile
}

async function fakeDocker(tempDir) {
  const binDir = join(tempDir, "bin")
  const commandLog = join(tempDir, "docker-commands")
  await mkdir(binDir)
  const docker = join(binDir, "docker")
  await writeFile(
    docker,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$DOCKER_COMMAND_LOG"
if [[ "$*" == *"pg_dump"* ]]; then printf 'PGDMP-contract-backup'; fi
if [[ "$*" == *"pg_restore"* ]]; then cat >/dev/null; fi
if [[ "\${FAKE_DOCKER_FAIL_UP:-0}" == "1" && "$*" == *" up "* ]]; then exit 42; fi
`,
    { mode: 0o700 },
  )
  return {
    commandLog,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      DOCKER_COMMAND_LOG: commandLog,
    },
  }
}

test("package scripts expose the complete Compose lifecycle", async () => {
  const pkg = JSON.parse(await read("package.json"))

  assert.equal(pkg.scripts["docker:init"], "bash deploy/scripts/init-config.sh")
  assert.equal(
    pkg.scripts["docker:build"],
    "docker compose --env-file deploy/config/deploy.env build",
  )
  assert.equal(pkg.scripts["docker:up"], "bash deploy/scripts/start.sh")
  assert.equal(pkg.scripts["docker:status"], "bash deploy/scripts/status.sh")
  assert.equal(
    pkg.scripts["docker:logs"],
    "docker compose --env-file deploy/config/deploy.env logs -f",
  )
  assert.equal(pkg.scripts["docker:down"], "bash deploy/scripts/stop.sh")
  assert.equal(pkg.scripts["docker:backup"], "bash deploy/scripts/backup-db.sh")
  assert.equal(pkg.scripts["docker:restore"], "bash deploy/scripts/restore-db.sh")
  assert.equal(pkg.scripts.stop, pkg.scripts["docker:down"])
})

test("initialization templates describe private PostgreSQL and seed configuration", async () => {
  const [init, example] = await Promise.all([
    read("deploy/scripts/init-config.sh"),
    read("deploy/config/deploy.env.example"),
  ])

  for (const source of [init, example]) {
    assert.match(source, /COMPOSE_PROJECT_NAME/)
    assert.match(source, /LOCAL_PORT/)
    assert.match(source, /POSTGRES_DB/)
    assert.match(source, /POSTGRES_USER/)
    assert.match(source, /POSTGRES_PASSWORD/)
    assert.match(source, /SIMULATION_TERMINATION_ENABLED=false/)
    assert.match(source, /DEPLOY_AUTH_ENABLED=false/)
  }
  assert.match(init, /SEED_USERS_FILE/)
  assert.match(init, /chmod 600/)
})

test("initialization preserves an existing private file while creating the missing one", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-partial-init-"))
  const envFile = join(tempDir, "deploy.env")
  const seedFile = join(tempDir, "seed-users.json")
  const existing = "EXISTING_PRIVATE_CONFIGURATION=preserve-me\n"
  await writeFile(envFile, existing, { mode: 0o600 })

  await execFileAsync("bash", ["deploy/scripts/init-config.sh"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DEPLOY_ENV_FILE: envFile,
      DEPLOY_SEED_USERS_FILE: seedFile,
    },
  })

  assert.equal(await readFile(envFile, "utf8"), existing)
  const users = JSON.parse(await readFile(seedFile, "utf8"))
  assert.equal(users.length, 5)
  assert.equal((await stat(seedFile)).mode & 0o777, 0o600)
})

test("prerequisites validate Docker Compose and private configuration files", async () => {
  const prerequisites = await read("deploy/scripts/check-prerequisites.sh")

  assert.match(prerequisites, /require_command docker/)
  assert.match(prerequisites, /docker info/)
  assert.match(prerequisites, /docker compose version/)
  assert.match(prerequisites, /assert_private_file "\$ENV_FILE"/)
  assert.match(prerequisites, /assert_private_file "\$SEED_USERS_FILE"/)
})

test("explicit process settings override deploy.env for isolated verification", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-env-override-"))
  const envFile = await privateEnvironment(tempDir)

  const result = await execFileAsync(
    "bash",
    [
      "-c",
      'source deploy/scripts/common.sh; load_deploy_env; printf "%s" "$POSTGRES_DB"',
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPLOY_ENV_FILE: envFile,
        POSTGRES_DB: "survey_isolated",
      },
    },
  )

  assert.equal(result.stdout, "survey_isolated")
})

test("outer-auth credentials cannot inject curl health configuration", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-auth-config-"))
  const envFile = await privateEnvironment(tempDir)
  await writeFile(
    envFile,
    `${await readFile(envFile, "utf8")}DEPLOY_AUTH_ENABLED=true\nDEPLOY_USERNAME=survey\nDEPLOY_PASSWORD=unsafe-password-with-a-quote\"\n`,
    { mode: 0o600 },
  )

  await assert.rejects(
    execFileAsync(
      "bash",
      ["-c", "source deploy/scripts/common.sh; load_deploy_env"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          DEPLOY_ENV_FILE: envFile,
          DEPLOY_AUTH_ENABLED: "true",
          DEPLOY_USERNAME: "survey",
          DEPLOY_PASSWORD: 'unsafe-password-with-a-quote"',
        },
      },
    ),
    /DEPLOY_PASSWORD must contain at least 20 URL-safe characters/,
  )
})

test("the example PostgreSQL password cannot be used as a real secret", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-example-password-"))
  const envFile = await privateEnvironment(tempDir)

  await assert.rejects(
    execFileAsync(
      "bash",
      ["-c", "source deploy/scripts/common.sh; load_deploy_env"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          DEPLOY_ENV_FILE: envFile,
          POSTGRES_PASSWORD:
            "replace-with-at-least-20-url-safe-random-characters",
        },
      },
    ),
    /POSTGRES_PASSWORD still uses the example value/,
  )
})

test("ordinary stop performs Compose down without deleting volumes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-stop-contract-"))
  const envFile = await privateEnvironment(tempDir)
  const fake = await fakeDocker(tempDir)

  await execFileAsync("bash", ["deploy/scripts/stop.sh"], {
    cwd: projectRoot,
    env: { ...fake.env, DEPLOY_ENV_FILE: envFile },
  })

  const commands = await readFile(fake.commandLog, "utf8")
  assert.match(commands, /compose .* down/)
  assert.doesNotMatch(commands, /(?:^|\s)(?:-v|--volumes)(?:\s|$)/)
})

test("a partially failed start rolls containers back without deleting data", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-start-rollback-"))
  const envFile = await privateEnvironment(tempDir)
  const seedFile = join(tempDir, "seed-users.json")
  await writeFile(seedFile, "[]\n", { mode: 0o600 })
  const fake = await fakeDocker(tempDir)

  await assert.rejects(
    execFileAsync("bash", ["deploy/scripts/start.sh", "--no-build"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        DEPLOY_ENV_FILE: envFile,
        DEPLOY_SEED_USERS_FILE: seedFile,
        FAKE_DOCKER_FAIL_UP: "1",
      },
    }),
  )

  const commands = await readFile(fake.commandLog, "utf8")
  assert.match(commands, / up /)
  assert.match(commands, / down /)
  assert.doesNotMatch(commands, /(?:^|\s)(?:-v|--volumes)(?:\s|$)/)
})

test("backup creates a non-empty mode-600 custom dump", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-backup-contract-"))
  const envFile = await privateEnvironment(tempDir)
  const backupDir = join(tempDir, "backups")
  const fake = await fakeDocker(tempDir)

  await execFileAsync("bash", ["deploy/scripts/backup-db.sh"], {
    cwd: projectRoot,
    env: {
      ...fake.env,
      DEPLOY_ENV_FILE: envFile,
      DEPLOY_BACKUP_DIR: backupDir,
    },
  })

  const entries = await readdir(backupDir)
  assert.equal(entries.length, 1)
  const backup = join(backupDir, entries[0])
  assert.ok((await stat(backup)).size > 0)
  assert.equal((await stat(backup)).mode & 0o777, 0o600)
  const commands = await readFile(fake.commandLog, "utf8")
  assert.match(commands, /pg_dump .*--format=custom/)
})

test("restore refuses absent confirmation, missing files, and empty files before Docker", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-restore-refusal-"))
  const envFile = await privateEnvironment(tempDir)
  const nonempty = join(tempDir, "valid.dump")
  const empty = join(tempDir, "empty.dump")
  await writeFile(nonempty, "PGDMP-test", { mode: 0o600 })
  await writeFile(empty, "", { mode: 0o600 })

  for (const args of [
    [nonempty],
    [join(tempDir, "missing.dump"), "--confirm"],
    [empty, "--confirm"],
  ]) {
    await assert.rejects(
      execFileAsync("bash", ["deploy/scripts/restore-db.sh", ...args], {
        cwd: projectRoot,
        env: { ...process.env, DEPLOY_ENV_FILE: envFile },
      }),
    )
  }
})

test("confirmed restore targets only the configured application database", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-restore-contract-"))
  const envFile = await privateEnvironment(tempDir)
  const backup = join(tempDir, "valid.dump")
  const fake = await fakeDocker(tempDir)
  await writeFile(backup, "PGDMP-test", { mode: 0o600 })

  const result = await execFileAsync(
    "bash",
    ["deploy/scripts/restore-db.sh", backup, "--confirm"],
    {
      cwd: projectRoot,
      env: { ...fake.env, DEPLOY_ENV_FILE: envFile },
    },
  )

  assert.match(result.stdout, /survey/)
  const commands = await readFile(fake.commandLog, "utf8")
  assert.match(commands, /pg_restore/)
  assert.match(commands, /--dbname=survey/)
  assert.doesNotMatch(commands, /postgres|template0|template1/)
})

test("persistence smoke explicitly targets the isolated restore project and database", async () => {
  const smoke = await read("deploy/tests/persistence-smoke.sh")
  assert.match(
    smoke,
    /COMPOSE_PROJECT_NAME="\$isolated_project" \\\n\s+POSTGRES_DB="\$isolated_db" \\\n\s+DEPLOY_ENV_FILE="\$isolated_env" \\\n\s+"\$SCRIPT_DIR\/\.\.\/scripts\/restore-db\.sh" "\$backup_file" --confirm/,
  )
})

test("all deployment entrypoints are executable", async () => {
  for (const path of [
    "deploy/scripts/init-config.sh",
    "deploy/scripts/check-prerequisites.sh",
    "deploy/scripts/start.sh",
    "deploy/scripts/stop.sh",
    "deploy/scripts/status.sh",
    "deploy/scripts/backup-db.sh",
    "deploy/scripts/restore-db.sh",
    "deploy/tests/persistence-smoke.sh",
    "backend/docker-entrypoint.sh",
  ]) {
    const metadata = await stat(new URL(`../../${path}`, import.meta.url))
    assert.notEqual(metadata.mode & 0o111, 0, `${path} is not executable`)
  }
})
