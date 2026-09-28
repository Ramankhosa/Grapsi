import { Prisma } from '@/lib/prisma-generated'

/** Called inside the assignment transaction, after recipient authorization. */
export async function ensureManualAllocationMapping(tx: Prisma.TransactionClient, input: {
  tenantId: string; callId: string; orgUnitId: string | null; actorId: string; reason: string
}) {
  if (!input.orgUnitId) return
  const unit = await tx.tenantOrgUnit.findFirst({ where: { id: input.orgUnitId, tenant_id: input.tenantId }, select: { path: true, id: true } })
  if (!unit) throw new Error('Faculty school placement changed. Refresh and try again.')
  const schoolId = unit.path[0] || unit.id
  // Serialize absent-row inserts as well as reactivations for this call/school.
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.tenantId, input.callId, schoolId])}, 0))`)
  const before = (await tx.$queryRaw<Array<{ is_active: boolean }>>(Prisma.sql`
    SELECT * FROM dsr_call_school_mappings WHERE tenant_id=${input.tenantId}
      AND call_id=${input.callId} AND school_id=${schoolId} FOR UPDATE`))[0]
  if (before?.is_active) return
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    INSERT INTO dsr_call_school_mappings(tenant_id, call_id, school_id, source, tier, reason, mapped_at, mapped_by)
    VALUES (${input.tenantId}, ${input.callId}, ${schoolId}, 'MANUAL_ALLOCATION', NULL, ${input.reason}, now(), ${input.actorId})
    ON CONFLICT (tenant_id, call_id, school_id) DO UPDATE SET
      source='MANUAL_ALLOCATION', tier=NULL, reason=EXCLUDED.reason, is_active=true,
      ended_at=NULL, ended_by=NULL, ended_reason=NULL, mapped_at=EXCLUDED.mapped_at, mapped_by=EXCLUDED.mapped_by, backfilled=false
    RETURNING *`)
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO dsr_events(tenant_id, school_id, entity_type, entity_id, actor_user_id, kind, before_data, after_data, reason, occurred_at)
    VALUES (${input.tenantId}, ${schoolId}, 'MAPPING', ${input.callId}, ${input.actorId},
      ${before ? 'REOPENED_BY_ALLOCATION' : 'MANUAL_ALLOCATION'},
      ${before ? JSON.stringify(before) : null}::jsonb, ${JSON.stringify(rows[0])}::jsonb, ${input.reason}, now())`)
}
