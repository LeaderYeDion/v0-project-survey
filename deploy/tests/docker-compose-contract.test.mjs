import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = fileURLToPath(new URL("../..", import.meta.url))
const read = path =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8")

async function writeExecutable(path, source) {
  await writeFile(path, source, { mode: 0o700 })
}

async function renderComposeWithSeed(tempDir) {
  const envFile = join(tempDir, "deploy.env")
  const seedFile = join(tempDir, "custom-seed-users.json")
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
  await writeFile(seedFile, "[]\n", { mode: 0o600 })

  const result = await execFileAsync(
    "bash",
    [
      "-c",
      "source deploy/scripts/common.sh; load_deploy_env; compose --profile public config --format json",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPLOY_ENV_FILE: envFile,
        DEPLOY_SEED_USERS_FILE: seedFile,
      },
      maxBuffer: 1024 * 1024,
    },
  )
  return { config: JSON.parse(result.stdout), seedFile }
}

function serviceBlock(compose, service, nextService) {
  const start = compose.indexOf(`  ${service}:`)
  assert.notEqual(start, -1, `missing ${service} service`)
  const end = nextService ? compose.indexOf(`  ${nextService}:`, start + 1) : -1
  return compose.slice(start, end === -1 ? undefined : end)
}

test("compose separates the frontend, backend, and persistent database", async () => {
  const compose = await read("compose.yaml")

  for (const service of ["frontend", "backend", "db"]) {
    assert.match(compose, new RegExp(`^  ${service}:`, "m"))
  }
  assert.match(compose, /^  survey_postgres_data:\s*$/m)
  assert.match(compose, /source:\s*survey_postgres_data/)

  const db = serviceBlock(compose, "db", "backend")
  const backend = serviceBlock(compose, "backend", "frontend")
  assert.doesNotMatch(db, /^\s+ports:/m)
  assert.doesNotMatch(backend, /^\s+ports:/m)
  assert.doesNotMatch(compose, /5432:5432/)
})

test("compose gates each application tier on its dependency health", async () => {
  const compose = await read("compose.yaml")
  const db = serviceBlock(compose, "db", "backend")
  const backend = serviceBlock(compose, "backend", "frontend")
  const frontend = serviceBlock(compose, "frontend", "cloudflared")

  assert.match(db, /pg_isready/)
  assert.match(backend, /db:\s*\n\s+condition:\s*service_healthy/)
  assert.match(backend, /\/api\/health/)
  assert.match(frontend, /backend:\s*\n\s+condition:\s*service_healthy/)
  assert.match(frontend, /\/survey-api\/health/)
  assert.match(frontend, /127\.0\.0\.1:\$\{LOCAL_PORT:-3000\}:3000/)
})

test("compose keeps application traffic internal and source trees out of production containers", async () => {
  const compose = await read("compose.yaml")

  assert.match(compose, /^  app_internal:\s*\n\s+internal:\s*true/m)
  assert.doesNotMatch(compose, /source:\s*(?:\.|\.\/backend|\.\/app)\s*$/m)
  assert.doesNotMatch(compose, /-\s*(?:\.|\.\/backend|\.\/app):/m)
  assert.match(compose, /target:\s*seed-users\.json/)
  assert.match(
    compose,
    /DATABASE_URL=postgresql\+asyncpg:\/\/\$\{POSTGRES_USER\}:\$\{POSTGRES_PASSWORD\}@db:5432\/\$\{POSTGRES_DB\}/,
  )
})

test("backend receives the private seed file through a read-only Compose secret", async () => {
  const compose = await read("compose.yaml")
  const backend = serviceBlock(compose, "backend", "frontend")

  assert.match(backend, /secrets:\s*\n\s+-\s+source:\s*seed_users/)
  assert.match(backend, /target:\s*seed-users\.json/)
})

test("rendered Compose honors the custom private seed path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-compose-seed-"))
  const { config, seedFile } = await renderComposeWithSeed(tempDir)

  assert.equal(config.secrets.seed_users.file, seedFile)
})

test("cloudflared is optional and waits for the healthy frontend", async () => {
  const compose = await read("compose.yaml")
  const tunnel = serviceBlock(compose, "cloudflared")

  assert.match(tunnel, /profiles:\s*\n\s+-\s*public/)
  assert.match(tunnel, /frontend:\s*\n\s+condition:\s*service_healthy/)
  assert.match(tunnel, /http:\/\/frontend:3000/)
})

test("rendered Compose pins cloudflared to the reviewed release", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-compose-tunnel-"))
  const { config } = await renderComposeWithSeed(tempDir)

  assert.equal(config.services.cloudflared.image, "cloudflare/cloudflared:2026.8.3")
})

test("frontend image is standalone, multi-stage, and non-root", async () => {
  const [dockerfile, nextConfig] = await Promise.all([
    read("Dockerfile"),
    read("next.config.mjs"),
  ])

  assert.match(dockerfile, /^FROM .* AS deps$/m)
  assert.match(dockerfile, /^FROM .* AS builder$/m)
  assert.match(dockerfile, /^FROM .* AS runner$/m)
  assert.match(dockerfile, /npm ci/)
  assert.match(dockerfile, /npm run typecheck/)
  assert.match(dockerfile, /npm run build/)
  assert.match(dockerfile, /\.next\/standalone/)
  assert.match(dockerfile, /\.next\/static/)
  assert.match(dockerfile, /public/)
  assert.match(dockerfile, /^USER\s+(?!root\b)\S+/m)
  assert.match(dockerfile, /server\.js/)
  assert.match(nextConfig, /output:\s*["']standalone["']/)
})

test("frontend health remains valid when the optional outer auth gate is enabled", async () => {
  const compose = await read("compose.yaml")
  const frontend = serviceBlock(compose, "frontend", "cloudflared")

  assert.match(frontend, /DEPLOY_AUTH_ENABLED/)
  assert.match(frontend, /authorization|Authorization/)
  assert.match(frontend, /survey-api\/health/)
})

test("backend image uses locked wheels and a root-only privilege-drop bootstrap", async () => {
  const [dockerfile, requirements] = await Promise.all([
    read("backend/Dockerfile"),
    read("backend/requirements.txt"),
  ])

  assert.match(dockerfile, /^FROM .* AS builder$/m)
  assert.match(dockerfile, /^FROM .* AS runner$/m)
  assert.match(dockerfile, /requirements\.txt/)
  assert.match(dockerfile, /pip wheel/)
  assert.match(dockerfile, /pip install.*--no-index/s)
  assert.match(dockerfile, /apt-get[\s\S]*\bgosu\b/)
  assert.match(dockerfile, /^USER\s+root$/m)
  assert.match(dockerfile, /docker-entrypoint\.sh/)
  for (const line of requirements.split("\n")) {
    if (line && !line.startsWith("#")) assert.match(line, /==/)
  }
})

test("backend root bootstrap copies a mode-600 secret before dropping to survey", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-backend-bootstrap-"))
  const binDir = join(tempDir, "bin")
  const runtimeDir = join(tempDir, "runtime")
  const seedFile = join(tempDir, "seed-users.json")
  const commandLog = join(tempDir, "commands.log")
  await mkdir(binDir)
  await writeFile(seedFile, '[{"username":"researcher01"}]\n', {
    mode: 0o600,
  })
  await writeExecutable(
    join(binDir, "id"),
    "#!/usr/bin/env bash\nprintf '0\\n'\n",
  )
  await writeExecutable(
    join(binDir, "install"),
    `#!/usr/bin/env bash
set -eu
printf 'install %s\\n' "$*" >>"$COMMAND_LOG"
target="\${!#}"
if [[ " $* " == *" -d "* ]]; then
  mkdir -p "$target"
  chmod 700 "$target"
else
  source_index=$(( $# - 1 ))
  source="\${!source_index}"
  cp "$source" "$target"
  chmod 600 "$target"
fi
`,
  )
  await writeExecutable(
    join(binDir, "gosu"),
    "#!/usr/bin/env bash\nprintf 'gosu %s\\n' \"$*\" >>\"$COMMAND_LOG\"\n",
  )
  for (const command of ["alembic", "python", "uvicorn"]) {
    await writeExecutable(
      join(binDir, command),
      `#!/usr/bin/env bash
printf '${command} %s\\n' "$*" >>"$COMMAND_LOG"
`,
    )
  }

  await execFileAsync("bash", ["backend/docker-entrypoint.sh"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      COMMAND_LOG: commandLog,
      SEED_USERS_FILE: seedFile,
      BACKEND_RUNTIME_DIR: runtimeDir,
    },
  })

  const privateSeed = join(runtimeDir, "seed-users.json")
  assert.equal(
    await readFile(privateSeed, "utf8").catch(() => null),
    '[{"username":"researcher01"}]\n',
  )
  assert.equal((await stat(privateSeed)).mode & 0o777, 0o600)
  const commands = await readFile(commandLog, "utf8")
  assert.match(commands, /install .* -o survey -g survey .*seed-users\.json/)
  assert.match(commands, /gosu survey .*docker-entrypoint\.sh/)
  assert.doesNotMatch(commands, /alembic|python|uvicorn/)
})

test("backend entrypoint migrates and seeds before serving", async () => {
  const entrypoint = await read("backend/docker-entrypoint.sh")

  const migration = entrypoint.indexOf("alembic upgrade head")
  const seed = entrypoint.indexOf("python -m app.cli seed-users")
  const server = entrypoint.indexOf("uvicorn app.main:app")
  assert.ok(migration >= 0, "entrypoint must apply migrations")
  assert.ok(seed > migration, "entrypoint must seed after migration")
  assert.ok(server > seed, "entrypoint must start Uvicorn after seeding")
  assert.match(entrypoint, /exec .*uvicorn app\.main:app/)
  assert.match(entrypoint, /--host 0\.0\.0\.0/)
  assert.match(entrypoint, /--port 8000/)
})
