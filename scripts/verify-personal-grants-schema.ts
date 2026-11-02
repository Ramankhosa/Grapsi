/** Checks the exact migration in a temporary schema inside a rolled-back local
 * transaction. No application tables are read or written; no migration applied.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import prisma from '../src/lib/prisma'
const rollback = new Error('intentional planner verification rollback')
async function main() {
  const host = new URL(process.env.DATABASE_URL || '').hostname
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error('Schema verification requires a local database.')
  const schema = `verify_personal_grants_${randomBytes(6).toString('hex')}`
  const migration = readFileSync('prisma/migrations/20261101090000_personal_grant_planner/migration.sql', 'utf8')
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
      for (const table of ['tenants', 'users', 'funding_calls']) await tx.$executeRawUnsafe(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY)`)
      for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement)
      for (const table of ['tenants', 'users', 'funding_calls']) await tx.$executeRawUnsafe(`INSERT INTO "${table}" (id) VALUES ('fixture')`)
      await tx.$executeRawUnsafe(`INSERT INTO personal_grants (id, tenant_id, user_id, funding_call_id, notes, updated_at) VALUES ('personal', 'fixture', 'fixture', 'fixture', 'My private note', now())`)
      await tx.$executeRawUnsafe(`INSERT INTO personal_grant_events (id, personal_grant_id, title, event_at, timezone, reminder_at, reminder_state, retry_at, updated_at) VALUES ('event', 'personal', 'Budget', '2090-11-10 10:00:00+05:30', 'Asia/Kolkata', '2090-11-09 09:00:00+05:30', 'PENDING', '2090-11-09 09:00:00+05:30', now())`)
      const [row] = await tx.$queryRawUnsafe<Array<{ event_at: Date; reminder_at: Date; notes: string }>>('SELECT e.event_at, e.reminder_at, p.notes FROM personal_grant_events e JOIN personal_grants p ON p.id=e.personal_grant_id')
      assert.equal(row.event_at.toISOString(), '2090-11-10T04:30:00.000Z')
      assert.equal(row.reminder_at.toISOString(), '2090-11-09T03:30:00.000Z')
      assert.equal(row.notes, 'My private note')
      await tx.$executeRawUnsafe(`UPDATE personal_grants SET is_favourite=false WHERE id='personal'`)
      const [retained] = await tx.$queryRawUnsafe<Array<{ notes: string; events: bigint }>>(`SELECT notes, (SELECT count(*) FROM personal_grant_events) events FROM personal_grants`)
      assert.equal(retained.notes, 'My private note'); assert.equal(Number(retained.events), 1)
      await tx.$executeRawUnsafe(`DELETE FROM funding_calls WHERE id='fixture'`)
      const [remaining] = await tx.$queryRawUnsafe<Array<{ grants: bigint; events: bigint }>>(`SELECT (SELECT count(*) FROM personal_grants) grants, (SELECT count(*) FROM personal_grant_events) events`)
      assert.equal(Number(remaining.grants), 0); assert.equal(Number(remaining.events), 0)
      throw rollback
    }, { timeout: 30000 })
  } catch (error) { if (error !== rollback) throw error }
  const schemas = await prisma.$queryRaw<Array<{ schema_name: string }>>`SELECT schema_name FROM information_schema.schemata WHERE schema_name=${schema}`
  assert.equal(schemas.length, 0, 'Verification schema was rolled back')
  console.log('PASS: exact migration, UTC reminder times, note preservation and grant deletion cleanup; verification schema rolled back, no application data changed.')
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Schema verification failed'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
