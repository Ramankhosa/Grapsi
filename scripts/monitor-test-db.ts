/**
 * Creates (or resets) the disposable database the Source Watch integration
 * tests run against, and brings it to the current migrations.
 *
 *   npm run test:monitor:db            create if missing, then migrate deploy
 *   npm run test:monitor:db -- --reset drop and recreate first
 *
 * The test database is the dev DATABASE_URL with its name replaced by
 * MONITOR_TEST_DATABASE_NAME (default grapsi_monitor_test), or
 * MONITOR_TEST_DATABASE_URL when set. It refuses any name that does not end in
 * `_test`, and refuses to touch the database DATABASE_URL itself names — the
 * integration suites truncate monitor tables, so pointing them at a real
 * database must be impossible rather than merely discouraged.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

import { resolveMonitorTestDatabaseUrl } from '../src/tests/integration/helpers/monitorTestDatabase'

function loadDatabaseUrl(): string {
  let url = process.env.DATABASE_URL || ''
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(process.cwd(), filename)
    if (!fs.existsSync(envPath)) continue
    const parsed = dotenv.parse(fs.readFileSync(envPath))
    if (parsed.DATABASE_URL) url = parsed.DATABASE_URL
  }
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

async function main() {
  const reset = process.argv.includes('--reset')
  const devUrl = loadDatabaseUrl()
  const { url: testUrl, name: testName } = resolveMonitorTestDatabaseUrl(devUrl)

  const admin = new PrismaClient({ datasources: { db: { url: devUrl } } })
  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      'SELECT datname FROM pg_database WHERE datname = $1',
      testName
    )
    if (reset && existing.length > 0) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${testName}" WITH (FORCE)`)
      console.log(`[monitor-test-db] dropped ${testName}`)
    }
    if (reset || existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${testName}"`)
      console.log(`[monitor-test-db] created ${testName}`)
    }
  } finally {
    await admin.$disconnect()
  }

  const result = spawnSync(
    process.execPath,
    [path.join('node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: testUrl } }
  )
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed against ${testName} (exit ${result.status})`)
  }
  console.log(`[monitor-test-db] ${testName} is migrated`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
