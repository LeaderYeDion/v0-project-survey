import test from "node:test"
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
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
if [[ "$*" == "image inspect "* ]]; then printf 'sha256:contract-backend\\n'; fi
if [[ "$*" == "create "* ]]; then printf 'contract-preflight-container\\n'; fi
if [[ "$*" == "start --attach "* ]]; then printf 'SURVEY_RESTORE_PREFLIGHT_V1 prepare-only seed-valid\\n'; fi
if [[ "$*" == *"pg_dump"* ]]; then printf 'PGDMP-contract-backup'; fi
if [[ "$*" == *"pg_restore"* ]]; then cat >/dev/null; fi
if [[ "$*" == *"psql"* ]]; then printf 'survey\\n'; fi
if [[ "\${FAKE_DOCKER_FAIL_UP:-0}" == "1" && "$*" == *" up "* ]]; then exit 42; fi
`,
    { mode: 0o700 },
  )
  await writeFile(join(binDir, "curl"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 })
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

test("private credential validation rejects symbolic links", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-private-symlink-"))
  const privateTarget = join(tempDir, "private-target")
  const linkedFile = join(tempDir, "deploy.env")
  await writeFile(privateTarget, "PRIVATE_CONFIGURATION=not-followed\n", {
    mode: 0o600,
  })
  await symlink(privateTarget, linkedFile)

  await assert.rejects(
    execFileAsync(
      "bash",
      [
        "-c",
        'source deploy/scripts/common.sh; assert_private_file "$1"',
        "assert-private-file",
        linkedFile,
      ],
      { cwd: projectRoot },
    ),
    /must not be a symbolic link/,
  )
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

test("enabled outer auth is written to a private curl configuration", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-curl-auth-"))
  const envFile = await privateEnvironment(tempDir)
  const curlConfig = join(tempDir, "curl.config")

  await execFileAsync(
    "bash",
    [
      "-c",
      'source deploy/scripts/common.sh; load_deploy_env; write_deploy_curl_config "$1"',
      "write-curl-config",
      curlConfig,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPLOY_ENV_FILE: envFile,
        DEPLOY_AUTH_ENABLED: "true",
        DEPLOY_USERNAME: "survey",
        DEPLOY_PASSWORD: "outer-auth-password-2026",
      },
    },
  )

  assert.equal(
    await readFile(curlConfig, "utf8"),
    'user = "survey:outer-auth-password-2026"\n',
  )
  assert.equal((await stat(curlConfig)).mode & 0o777, 0o600)
})

test("docker health check runs from zsh without exposing outer auth in argv", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-health-zsh-"))
  const envFile = await privateEnvironment(tempDir)
  const binDir = join(tempDir, "bin")
  const curlArgs = join(tempDir, "curl-args")
  const copiedConfig = join(tempDir, "curl-config-copy")
  const curlMode = join(tempDir, "curl-config-mode")
  await mkdir(binDir)
  await writeFile(
    join(binDir, "curl"),
    `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >"$HEALTH_CURL_ARGS"
cp "$2" "$HEALTH_CURL_CONFIG"
if stat -f '%Lp' "$2" >/dev/null 2>&1; then
  stat -f '%Lp' "$2" >"$HEALTH_CURL_MODE"
else
  stat -c '%a' "$2" >"$HEALTH_CURL_MODE"
fi
printf '{"status":"ok"}\n'
`,
    { mode: 0o700 },
  )

  const result = await execFileAsync("zsh", ["-c", "npm run docker:health"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TMPDIR: tempDir,
      NPM_CONFIG_CACHE: join(tempDir, "npm-cache"),
      DEPLOY_ENV_FILE: envFile,
      DEPLOY_AUTH_ENABLED: "true",
      DEPLOY_USERNAME: "survey",
      DEPLOY_PASSWORD: "outer-auth-password-2026",
      HEALTH_CURL_ARGS: curlArgs,
      HEALTH_CURL_CONFIG: copiedConfig,
      HEALTH_CURL_MODE: curlMode,
    },
  })

  assert.match(result.stdout, /{"status":"ok"}/)
  const invokedArgs = (await readFile(curlArgs, "utf8")).trim()
  assert.match(
    invokedArgs,
    /^--config \S+ --fail --show-error --connect-timeout 3 --max-time 10 http:\/\/127\.0\.0\.1:3000\/survey-api\/health$/,
  )
  assert.doesNotMatch(invokedArgs, /outer-auth-password-2026/)
  assert.equal(
    await readFile(copiedConfig, "utf8"),
    'user = "survey:outer-auth-password-2026"\n',
  )
  assert.equal((await readFile(curlMode, "utf8")).trim(), "600")

  const healthConfig = invokedArgs.split(" ")[1]
  await assert.rejects(stat(healthConfig), /ENOENT/)
})

test("docker health check cleans credentials on HUP INT and TERM", async () => {
  for (const { signal, exitCode } of [
    { signal: "SIGHUP", exitCode: 129 },
    { signal: "SIGINT", exitCode: 130 },
    { signal: "SIGTERM", exitCode: 143 },
  ]) {
    const tempDir = await mkdtemp(join(tmpdir(), "survey-health-signal-"))
    const envFile = await privateEnvironment(tempDir)
    const binDir = join(tempDir, "bin")
    const curlArgs = join(tempDir, "curl-args")
    const curlMode = join(tempDir, "curl-config-mode")
    const configPathFile = join(tempDir, "curl-config-path")
    const readyFile = join(tempDir, "curl-ready")
    await mkdir(binDir)
    await writeFile(
      join(binDir, "curl"),
      `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >"$HEALTH_CURL_ARGS"
printf '%s\n' "$2" >"$HEALTH_CONFIG_PATH"
if stat -f '%Lp' "$2" >/dev/null 2>&1; then
  stat -f '%Lp' "$2" >"$HEALTH_CURL_MODE"
else
  stat -c '%a' "$2" >"$HEALTH_CURL_MODE"
fi
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
: >"$HEALTH_CURL_READY"
while :; do sleep 1; done
`,
      { mode: 0o700 },
    )

    const child = spawn("bash", ["deploy/scripts/check-health.sh"], {
      cwd: projectRoot,
      detached: true,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        TMPDIR: tempDir,
        DEPLOY_ENV_FILE: envFile,
        DEPLOY_AUTH_ENABLED: "true",
        DEPLOY_USERNAME: "survey",
        DEPLOY_PASSWORD: "outer-auth-password-2026",
        HEALTH_CURL_ARGS: curlArgs,
        HEALTH_CURL_MODE: curlMode,
        HEALTH_CONFIG_PATH: configPathFile,
        HEALTH_CURL_READY: readyFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let closed = false
    child.stdout.on("data", chunk => {
      stdout += chunk
    })
    child.stderr.on("data", chunk => {
      stderr += chunk
    })
    const completion = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, receivedSignal) => {
        closed = true
        resolve({ code, receivedSignal })
      })
    })

    try {
      let ready = false
      for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
          await stat(readyFile)
          ready = true
          break
        } catch (error) {
          if (error.code !== "ENOENT") throw error
          await delay(10)
        }
      }
      assert.equal(ready, true, `${signal} fixture did not become ready`)

      child.kill(signal)
      let timeout
      const result = await new Promise((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${signal} health process did not exit`)),
          3000,
        )
        completion.then(resolve, reject)
      }).finally(() => clearTimeout(timeout))

      assert.deepEqual(result, { code: exitCode, receivedSignal: null })
      assert.equal((await readFile(curlMode, "utf8")).trim(), "600")
      const invokedArgs = await readFile(curlArgs, "utf8")
      assert.doesNotMatch(invokedArgs, /outer-auth-password-2026/)
      assert.doesNotMatch(stdout, /outer-auth-password-2026/)
      assert.doesNotMatch(stderr, /outer-auth-password-2026/)
      const healthConfig = (await readFile(configPathFile, "utf8")).trim()
      await assert.rejects(stat(healthConfig), /ENOENT/)
    } finally {
      if (!closed) {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch (error) {
          if (error.code !== "ESRCH") throw error
        }
      }
    }
  }
})

test("persistence smoke routes every HTTP request through outer auth", async () => {
  const smoke = await read("deploy/tests/persistence-smoke.sh")
  const directCurlLines = smoke
    .split("\n")
    .filter(line => /^\s*curl\b/.test(line))

  assert.deepEqual(directCurlLines, [
    '  curl --config "$outer_auth_config" "$@"',
  ])
  assert.match(smoke, /write_deploy_curl_config "\$outer_auth_config"/)
  assert.match(smoke, /authenticated_curl\(\)/)
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
  const seedFile = join(tempDir, "seed-users.json")
  await writeFile(seedFile, "[]", { mode: 0o600 })
  const fake = await fakeDocker(tempDir)
  await writeFile(backup, "PGDMP-test", { mode: 0o600 })

  const result = await execFileAsync(
    "bash",
    ["deploy/scripts/restore-db.sh", backup, "--confirm"],
    {
      cwd: projectRoot,
      env: { ...fake.env, DEPLOY_ENV_FILE: envFile, DEPLOY_SEED_USERS_FILE: seedFile },
    },
  )

  assert.match(result.stdout, /survey/)
  const commands = await readFile(fake.commandLog, "utf8")
  assert.match(commands, /pg_restore/)
  assert.match(commands, /--dbname=survey/)
  assert.doesNotMatch(commands, /--dbname=(?:postgres|template0|template1)(?:\s|$)/)
})

test("persistence smoke explicitly targets the isolated restore project and database", async () => {
  const smoke = await read("deploy/tests/persistence-smoke.sh")
  assert.match(
    smoke,
    /COMPOSE_PROJECT_NAME="\$isolated_project" \\\n\s+POSTGRES_DB="\$isolated_db" \\\n\s+DEPLOY_ENV_FILE="\$isolated_env" \\\n\s+"\$SCRIPT_DIR\/\.\.\/scripts\/restore-db\.sh" "\$backup_file" --confirm/,
  )
})

test("persistence smoke arms isolated cleanup before database startup", async () => {
  const smoke = await read("deploy/tests/persistence-smoke.sh")
  const isolatedSection = smoke.slice(
    smoke.indexOf('info "Restoring the backup into an isolated Compose database"'),
  )
  const cleanupArmed = isolatedSection.indexOf("\nisolated_started=1\n")
  const databaseStartup = isolatedSection.indexOf("\n  compose up \\")

  assert.ok(cleanupArmed >= 0, "isolated cleanup is never armed")
  assert.ok(databaseStartup >= 0, "isolated database startup was not found")
  assert.ok(
    cleanupArmed < databaseStartup,
    "isolated cleanup must be armed before compose up can partially fail",
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
