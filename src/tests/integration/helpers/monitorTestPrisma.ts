import fs from 'node:fs'
import path from 'node:path'

import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

import { resolveMonitorTestDatabaseUrl } from './monitorTestDatabase'

/**
 * The PrismaClient the Source Watch integration suites inject in place of
 * `@/lib/prisma` (see vi.mock in each suite). It can only point at a database
 * whose name ends in `_test` and that is not the dev database.
 */
function devDatabaseUrl(): string {
  let url = process.env.DATABASE_URL || ''
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(process.cwd(), filename)
    if (!fs.existsSync(envPath)) continue
    const parsed = dotenv.parse(fs.readFileSync(envPath))
    if (parsed.DATABASE_URL) url = parsed.DATABASE_URL
  }
  if (!url) throw new Error('DATABASE_URL is not set; cannot derive the monitor test database')
  return url
}

const { url } = resolveMonitorTestDatabaseUrl(devDatabaseUrl())

export const testPrisma = new PrismaClient({ datasources: { db: { url } } })

/** Every table the Source Watch suites write, emptied between suites. */
const MONITOR_TABLES = [
  'monitor_notification_deliveries',
  'monitor_events',
  'monitor_opportunity_evidence',
  'monitor_handoffs',
  'monitor_opportunities',
  'monitor_observations',
  'monitor_resource_aliases',
  'monitor_resource_versions',
  'monitor_resources',
  'monitor_check_runs',
  'monitor_crawl_frontier',
  'monitor_site_funders',
  'monitor_verified_announcements',
  'monitored_ignore_rules',
  'monitored_changes',
  'monitored_snapshots',
  'monitored_sources',
  'monitor_sites',
  'monitor_tasks',
  'monitor_operation_tombstones',
  'monitor_host_pacing',
  'monitor_robots',
  'monitor_budget_ledger',
  'monitor_llm_attempts',
  'monitor_stage_cache',
  'monitor_provider_health',
  'monitor_worker_heartbeats',
  'monitor_sync_cursors',
  'monitor_audit_samples',
  'funding_call_url_keys',
]

export async function resetMonitorTables(): Promise<void> {
  // Re-check the guard at the moment of deletion, not only at import time.
  const [{ current_database: name }] = await testPrisma.$queryRawUnsafe<Array<{ current_database: string }>>('SELECT current_database()')
  if (!name.endsWith('_test')) throw new Error(`Refusing to truncate tables in ${name}`)
  await testPrisma.$executeRawUnsafe(`TRUNCATE ${MONITOR_TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`)
  await testPrisma.$executeRawUnsafe(`DELETE FROM "funding_calls" WHERE "createdByUserId" = 'monitor-test'`)
}
