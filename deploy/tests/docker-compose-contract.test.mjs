import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const read = path =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8")

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
  assert.match(compose, /file:\s*\.\/deploy\/config\/seed-users\.json/)
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
  assert.match(
    compose,
    /^secrets:\s*\n\s+seed_users:\s*\n\s+file:\s*\.\/deploy\/config\/seed-users\.json/m,
  )
})

test("cloudflared is optional and waits for the healthy frontend", async () => {
  const compose = await read("compose.yaml")
  const tunnel = serviceBlock(compose, "cloudflared")

  assert.match(tunnel, /profiles:\s*\n\s+-\s*public/)
  assert.match(tunnel, /frontend:\s*\n\s+condition:\s*service_healthy/)
  assert.match(tunnel, /http:\/\/frontend:3000/)
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

test("backend image uses locked wheels and starts as non-root", async () => {
  const [dockerfile, requirements] = await Promise.all([
    read("backend/Dockerfile"),
    read("backend/requirements.txt"),
  ])

  assert.match(dockerfile, /^FROM .* AS builder$/m)
  assert.match(dockerfile, /^FROM .* AS runner$/m)
  assert.match(dockerfile, /requirements\.txt/)
  assert.match(dockerfile, /pip wheel/)
  assert.match(dockerfile, /pip install.*--no-index/s)
  assert.match(dockerfile, /^USER\s+(?!root\b)\S+/m)
  assert.match(dockerfile, /docker-entrypoint\.sh/)
  for (const line of requirements.split("\n")) {
    if (line && !line.startsWith("#")) assert.match(line, /==/)
  }
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
