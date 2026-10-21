#!/usr/bin/env node
/**
 * Resolves the environment the catalogue release runs with, so every step
 * talks to the same database and the same embedding provider the live app
 * uses.
 *
 *   node env.mjs <app-dir> <out-file> [extra env files...]
 *
 * The app (`next start`) reads .env, then .env.production, then .env.local,
 * then .env.production.local, later files winning; a variable already set in
 * the shell wins over all of them. Extra env files (for example a PM2
 * ecosystem's shared .env.production) are layered after those. That merged
 * view is written to <out-file> as shell-quoted KEY='value' lines for
 * `set -a; . <out-file>`.
 *
 * The scripts are a second reader: src/lib/prisma.ts overwrites DATABASE_URL
 * from .env and then .env.local, whatever the shell says. If that gives a
 * different database than the app's own view, the release would back up and
 * check one database and import into another, so this exits 2 and names both.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [appDir, outFile, ...extraFiles] = process.argv.slice(2)
if (!appDir || !outFile) {
  console.error('usage: env.mjs <app-dir> <out-file> [extra env files...]')
  process.exit(64)
}

let dotenv
try {
  dotenv = (await import(pathToFileURL(path.join(appDir, 'node_modules', 'dotenv', 'lib', 'main.js')).href)).default
} catch {
  console.error(`dotenv not found under ${appDir}/node_modules: run npm ci in the app first.`)
  process.exit(3)
}

const read = (file) => (fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : null)

const layered = ['.env', '.env.production', '.env.local', '.env.production.local'].map((name) => path.join(appDir, name))
const files = [...layered, ...extraFiles.map((file) => path.resolve(file))]
const merged = {}
const used = []
for (const file of files) {
  const values = read(file)
  if (!values) continue
  used.push(file)
  Object.assign(merged, values)
}
for (const key of Object.keys(merged)) {
  if (process.env[key] !== undefined && process.env[key] !== '') merged[key] = process.env[key]
}
if (!merged.DATABASE_URL && process.env.DATABASE_URL) merged.DATABASE_URL = process.env.DATABASE_URL

// What src/lib/prisma.ts will actually connect to.
let scriptDb = merged.DATABASE_URL || ''
for (const name of ['.env', '.env.local']) {
  const values = read(path.join(appDir, name))
  if (values?.DATABASE_URL) scriptDb = values.DATABASE_URL
}

const describe = (url) => {
  try {
    const u = new URL(url)
    return `${u.hostname || u.searchParams.get('host') || 'local socket'}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`
  } catch {
    return '(unparseable)'
  }
}

if (!merged.DATABASE_URL) {
  console.error('No DATABASE_URL in the shell or in', files.join(', '))
  process.exit(2)
}
if (scriptDb !== merged.DATABASE_URL) {
  console.error('The app and the scripts would use DIFFERENT databases:')
  console.error(`  app (Next.js env order):         ${describe(merged.DATABASE_URL)}`)
  console.error(`  scripts (src/lib/prisma.ts reads .env / .env.local): ${describe(scriptDb)}`)
  console.error('Make DATABASE_URL agree across those files before releasing.')
  process.exit(2)
}

const quote = (value) => "'" + String(value).replace(/'/g, "'\"'\"'") + "'"
const lines = Object.entries(merged)
  .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
  .map(([key, value]) => `${key}=${quote(value)}`)
fs.writeFileSync(outFile, lines.join('\n') + '\n', { mode: 0o600 })
console.log(`env: ${lines.length} variables from ${used.length ? used.join(', ') : 'the shell only'}`)
console.log(`database: ${describe(merged.DATABASE_URL)}`)
