/**
 * A throwaway local PostgreSQL database for DSR verification scripts.
 *
 * Clones the SCHEMA (never the data) of the local database in DATABASE_URL into
 * a new database, applies whichever committed migrations the source has not yet
 * applied, points the app's shared Prisma client at the clone, runs the
 * callback, and drops the clone. Refuses to run against anything but localhost.
 *
 * Applying only the migrations the source lacks keeps the clone equal to what
 * the next `migrate deploy` will produce, whether or not the developer has run
 * it yet — the earlier scripts hard-coded a migration list and broke the day
 * those migrations reached the dev database.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

export type DisposableDb = { db: PrismaClient; database: string; applied: string[] }

export async function withDisposableDb(run: (ctx: DisposableDb) => Promise<void>) {
  let source = process.env.DATABASE_URL || ''
  for (const file of ['.env', '.env.local']) if (existsSync(file)) source = dotenv.parse(readFileSync(file)).DATABASE_URL || source
  const url = new URL(source)
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local PostgreSQL is allowed.')
  const sourceDb = url.pathname.slice(1)
  const database = `grapsi_dsr_verify_${Date.now()}`
  const bin = process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin'
  const exe = (name: string) => path.join(bin, process.platform === 'win32' ? `${name}.exe` : name)
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) }
  const psql = (db: string, args: string[], input?: Buffer | string) =>
    execFileSync(exe('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { env, input, maxBuffer: 30 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })

  const appliedInSource = new Set(
    psql(sourceDb, ['-At', '-c', 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'])
      .toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  )
  const pending = readdirSync(path.resolve('prisma/migrations'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !appliedInSource.has(entry.name))
    .map(entry => entry.name).sort()

  const schema = execFileSync(exe('pg_dump'), ['--schema-only', '--no-owner', '--no-acl', '-d', sourceDb], { env, maxBuffer: 50 * 1024 * 1024 })
  psql('postgres', ['-c', `CREATE DATABASE "${database}"`])
  url.pathname = `/${database}`
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
  try {
    psql(database, [], schema)
    for (const migration of pending) psql(database, ['-f', path.resolve('prisma/migrations', migration, 'migration.sql')])
    assert.equal((await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() name'))[0].name, database)
    ;(globalThis as any).prisma = db
    await run({ db, database, applied: pending })
  } finally {
    await db.$disconnect()
    assert(/^grapsi_dsr_verify_\d+$/.test(database))
    psql('postgres', ['-c', `DROP DATABASE "${database}" WITH (FORCE)`])
    console.log('Removed the disposable verification database; working data was not changed.')
  }
}

/** A tiny assertion counter shared by the verification scripts. */
export function checker() {
  let checks = 0
  const ok = (value: unknown, label: string) => { assert(value, label); checks++; console.log(`PASS ${label}`) }
  return { ok, count: () => checks }
}
