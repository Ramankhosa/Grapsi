/**
 * Who did what, when, per call and school — read from the department's one
 * audit table, dsr_events. Mapping, review, responsibility transfer, closure,
 * named actions, origin corrections, verification and coverage changes all
 * write there already; this reads them back in one shape for the Audit report,
 * the Register's per-row panel and the call dossier timeline.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { textArray } from './callSql'
import { departmentEventTitle } from './callTimeline'

/** Events that belong to one call (entity_id is the call id, or the action names it). */
const CALL_ENTITY_TYPES = ['MAPPING', 'REVIEW', 'RESPONSIBILITY', 'DISPOSITION', 'ORIGIN_ATTRIBUTION']
export const AUDIT_ENTITY_TYPES = [...CALL_ENTITY_TYPES, 'ACTION', 'VERIFICATION', 'OWNERSHIP'] as const

export type AuditRow = {
  id: string; entity_type: string; kind: string; reason: string | null; occurred_at: Date; school_id: string | null; school_name: string | null
  call_id: string | null; call_title: string | null; actor_name: string | null; before_data: any; after_data: any; inferred: boolean; summary: string
}

export async function getAuditTrail(tenantId: string, f: {
  scopeSchoolIds?: string[]; callId?: string | null; schoolId?: string | null; entityType?: string | null; start?: Date | null; end?: Date | null
  page?: number; pageSize?: number; all?: boolean
}) {
  const page = Math.max(1, f.page || 1), pageSize = Math.min(200, Math.max(1, f.pageSize || 50))
  const callOf = Prisma.sql`CASE WHEN e.entity_type = ANY(${textArray(CALL_ENTITY_TYPES)}) THEN e.entity_id ELSE COALESCE(e.after_data->>'call_id', e.before_data->>'call_id') END`
  const where = Prisma.sql`e.tenant_id=${tenantId} AND e.kind <> 'BASELINE' AND e.entity_type = ANY(${textArray([...AUDIT_ENTITY_TYPES])})
    ${f.scopeSchoolIds ? Prisma.sql`AND e.school_id = ANY(${textArray(f.scopeSchoolIds)})` : Prisma.empty}
    ${f.schoolId ? Prisma.sql`AND e.school_id=${f.schoolId}` : Prisma.empty}
    ${f.callId ? Prisma.sql`AND ${callOf}=${f.callId}` : Prisma.empty}
    ${f.entityType ? Prisma.sql`AND e.entity_type=${f.entityType}` : Prisma.empty}
    ${f.start ? Prisma.sql`AND e.occurred_at>=${f.start}` : Prisma.empty}
    ${f.end ? Prisma.sql`AND e.occurred_at<${f.end}` : Prisma.empty}`
  const [count, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int n FROM dsr_events e WHERE ${where}`),
    prisma.$queryRaw<Array<Omit<AuditRow, 'summary'>>>(Prisma.sql`
      SELECT e.id::text id, e.entity_type, e.kind, e.reason, e.occurred_at, e.school_id, s.name school_name, ${callOf} call_id,
             COALESCE(fc.scheme_title, fc.title) call_title, COALESCE(u.name, u.email) actor_name, e.before_data, e.after_data, e.inferred
        FROM dsr_events e LEFT JOIN tenant_org_units s ON s.id=e.school_id LEFT JOIN users u ON u.id=e.actor_user_id
        LEFT JOIN funding_calls fc ON fc.id = ${callOf}
       WHERE ${where} ORDER BY e.occurred_at DESC, e.id DESC
       ${f.all ? Prisma.empty : Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`}`),
  ])
  return {
    rows: rows.map(row => ({ ...row, summary: departmentEventTitle(row) || describe(row) })),
    total: count[0]?.n ?? 0, page, pageSize,
  }
}

function describe(row: { entity_type: string; kind: string; school_name: string | null; after_data: any }) {
  const school = row.school_name || 'a school'
  if (row.entity_type === 'REVIEW') return `${school} review: ${row.kind.toLowerCase().replace(/_/g, ' ')}`
  if (row.entity_type === 'OWNERSHIP') return `${school} coverage ${row.kind === 'DELETE' ? 'removed' : row.kind === 'INSERT' ? 'assigned' : 'changed'}${row.after_data?.is_deputy ? ' (deputy)' : ''}`
  if (row.entity_type === 'VERIFICATION') return `${school} submission verified`
  if (row.entity_type === 'RESPONSIBILITY') return `${school} ${row.kind.toLowerCase()} cover changed`
  return `${row.entity_type.toLowerCase()} ${row.kind.toLowerCase().replace(/_/g, ' ')} — ${school}`
}

/** Shaped for `buildTimeline`'s departmentEvents source. */
export async function departmentEventsForCall(tenantId: string, callId: string, schoolIds?: string[]) {
  const { rows } = await getAuditTrail(tenantId, { callId, scopeSchoolIds: schoolIds, all: true })
  return rows.filter(r => r.entity_type !== 'OWNERSHIP' && r.entity_type !== 'REVIEW').slice(0, 200).map(r => ({
    id: `dsr:${r.id}`, entity_type: r.entity_type, kind: r.kind, reason: r.reason, occurred_at: r.occurred_at,
    actor: r.actor_name ? { name: r.actor_name, email: null } : null, school_name: r.school_name, after_data: r.after_data,
  }))
}
