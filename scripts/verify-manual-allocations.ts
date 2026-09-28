/** Local database smoke test. Every fixture and event is rolled back; no notifications are sent. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import prisma from '../src/lib/prisma'
import { Prisma } from '../src/lib/prisma-generated'
import { ensureManualAllocationMapping } from '../src/lib/assignments/manualAllocationMapping'
import { snapshotFundingOpportunity } from '../src/lib/fundingDept/opportunitySnapshot'

async function main() {
  const host = new URL(process.env.DATABASE_URL || '').hostname
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(host), 'This rollback verification only runs on a local database.')
  const marker = `manual-allocation-verification-${randomUUID()}`
  const rollback = new Error('ROLLBACK_VERIFICATION')
  let checks = 0
  try {
    await prisma.$transaction(async tx => {
      const tenant = await tx.tenant.create({ data: { name: marker, atiId: marker } })
      const officer = await tx.user.create({ data: { tenantId: tenant.id, email: `officer-${marker}@example.invalid`, name: 'Verification officer', roles: ['MANAGER'] } })
      const faculty = await tx.user.create({ data: { tenantId: tenant.id, email: `faculty-${marker}@example.invalid`, name: 'Unmatched faculty', roles: ['MEMBER'] } })
      const school = await tx.tenantOrgUnit.create({ data: { tenant_id: tenant.id, name: 'Unmatched school', kind: 'SCHOOL' } })
      await tx.researcherProfile.create({ data: { user_id: faculty.id, org_unit_id: school.id, research_areas: [] } })
      const call = await tx.fundingCall.create({ data: { tenantId: tenant.id, createdByUserId: officer.id, updatedByUserId: officer.id, title: 'Expired unrelated call', visibility: 'TENANT_PRIVATE', status: 'PUBLISHED', is_active: true, close_date: new Date('2000-01-01') } })
      await tx.$executeRaw(Prisma.sql`SELECT set_config('grapsi.actor_id', ${officer.id}, true)`)
      const allocation = await tx.callAssignment.create({ data: {
        tenant_id: tenant.id, funding_call_id: call.id, assignee_user_id: faculty.id, assigned_by_user_id: officer.id,
        assignee_org_unit_id: school.id, allocation_method: 'MANUAL', allocation_reason: 'FACULTY_WILLINGNESS', allocation_note: 'Faculty offered to explore this call',
      } })
      assert.equal(allocation.status, 'ASSIGNED'); checks++
      const mappingInput = { tenantId: tenant.id, callId: call.id, orgUnitId: school.id, actorId: officer.id, reason: 'Faculty willingness' }
      await ensureManualAllocationMapping(tx, mappingInput)
      await snapshotFundingOpportunity({ tenantId: tenant.id, fundingCallId: call.id, userId: faculty.id, orgUnitId: school.id, source: 'assignment', sourceVersion: 'manual-allocation-v1' }, tx)
      const readMapping = async () => (await tx.$queryRaw<any[]>(Prisma.sql`SELECT * FROM dsr_call_school_mappings WHERE tenant_id=${tenant.id} AND call_id=${call.id} AND school_id=${school.id}`))[0]
      const first = await readMapping()
      assert.equal(first.source, 'MANUAL_ALLOCATION'); assert.equal(first.is_active, true); assert.equal(first.mapped_by, officer.id); checks++
      const apps = await tx.$queryRaw<any[]>(Prisma.sql`SELECT * FROM dsr_applications WHERE tenant_id=${tenant.id}`)
      assert.equal(apps.length, 1); assert.equal(apps[0].allocation_method, 'MANUAL'); assert.equal(apps[0].school_id, school.id); checks++
      const matches = await tx.fundingOpportunityMatch.findMany({ where: { tenant_id: tenant.id } })
      assert.equal(matches.length, 1); assert.equal(matches[0].is_current, false); assert.equal(matches[0].match_score, null); checks++
      const applicationEvents = await tx.$queryRaw<any[]>(Prisma.sql`SELECT * FROM dsr_events WHERE tenant_id=${tenant.id} AND entity_type='APPLICATION'`)
      assert.equal(applicationEvents.length, 1); assert.equal(applicationEvents[0].actor_user_id, officer.id)
      assert.equal(applicationEvents[0].after_data.allocation_reason, 'FACULTY_WILLINGNESS'); checks++

      // Preserve an active mapping's source, original date and reason.
      await tx.$executeRaw(Prisma.sql`UPDATE dsr_call_school_mappings SET source='ORIGIN', reason='Original intake', is_origin=true WHERE tenant_id=${tenant.id}`)
      await ensureManualAllocationMapping(tx, { ...mappingInput, reason: 'Another allocation' })
      const preserved = await readMapping()
      assert.equal(preserved.source, 'ORIGIN'); assert.equal(preserved.reason, 'Original intake'); assert.equal(+preserved.mapped_at, +first.mapped_at); checks++

      // Reopening preserves the previous closure in the audit before_data.
      await tx.$executeRaw(Prisma.sql`UPDATE dsr_call_school_mappings SET is_active=false, ended_at=now(), ended_by=${officer.id}, ended_reason='Earlier head decision' WHERE tenant_id=${tenant.id}`)
      await ensureManualAllocationMapping(tx, { ...mappingInput, reason: 'Indirect research fit' })
      const reopened = await readMapping()
      assert.equal(reopened.is_active, true); assert.equal(reopened.ended_reason, null); assert.equal(reopened.is_origin, true); checks++
      const events = await tx.$queryRaw<any[]>(Prisma.sql`SELECT * FROM dsr_events WHERE tenant_id=${tenant.id} AND kind='REOPENED_BY_ALLOCATION'`)
      assert.equal(events.length, 1); assert.equal(events[0].before_data.ended_reason, 'Earlier head decision'); assert.equal(events[0].reason, 'Indirect research fit'); checks++

      // PostgreSQL enforces the one-call/one-faculty boundary independently of the UI.
      await tx.$executeRawUnsafe('SAVEPOINT duplicate_check')
      await assert.rejects(tx.callAssignment.create({ data: { tenant_id: tenant.id, funding_call_id: call.id, assignee_user_id: faculty.id, assigned_by_user_id: officer.id } }), (error: any) => error.code === 'P2002')
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_check')
      assert.equal(await tx.callAssignment.count({ where: { tenant_id: tenant.id } }), 1); checks++
      throw rollback
    }, { timeout: 30000 })
  } catch (error) { if (error !== rollback) throw error }
  assert.equal(await prisma.tenant.count({ where: { atiId: marker } }), 0); checks++
  console.log(`Passed ${checks} local database checks. All fixtures, mappings and audit events rolled back; no notifications sent.`)
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
