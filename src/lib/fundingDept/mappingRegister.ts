/**
 * The Mapping register: which school owns which call and why, what nobody owns
 * yet, and which schools cannot receive calls at all.
 *
 *   mapped        every mapping, active or ended, with source, tier, reason,
 *                 date and whether it was reconstructed at backfill
 *   unclassified  open calls with no discipline classification. They map
 *                 nowhere (except an origin school), so the head owns them;
 *                 each carries its age so the queue cannot silently grow
 *   schools       schools with no research areas or keywords (they receive no
 *                 mappings) or with no primary coordinator (their mappings reach
 *                 nobody)
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { openCallSql, textArray, visibleCallSql } from './callSql'
import { MAPPING_SOURCE_LABELS, type MappingSource } from './callSchoolMapping'
import { getDeptSettings } from './settings'

export async function getMappedCalls(tenantId: string, f: { scopeSchoolIds?: string[]; schoolId?: string | null; source?: string | null; active?: string | null; callSearch?: string | null; page?: number; pageSize?: number; all?: boolean }) {
  const page = Math.max(1, f.page || 1), pageSize = Math.min(100, Math.max(1, f.pageSize || 20))
  const where = Prisma.sql`m.tenant_id=${tenantId}
    ${f.scopeSchoolIds ? Prisma.sql`AND m.school_id = ANY(${textArray(f.scopeSchoolIds)})` : Prisma.empty}
    ${f.schoolId ? Prisma.sql`AND m.school_id=${f.schoolId}` : Prisma.empty}
    ${f.source ? Prisma.sql`AND m.source=${f.source}` : Prisma.empty}
    ${f.active === 'active' ? Prisma.sql`AND m.is_active` : f.active === 'ended' ? Prisma.sql`AND NOT m.is_active` : Prisma.empty}
    ${f.callSearch ? Prisma.sql`AND (COALESCE(fc.scheme_title, fc.title) ILIKE ${`%${f.callSearch}%`} OR fc.id=${f.callSearch})` : Prisma.empty}`
  const [count, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int n FROM dsr_call_school_mappings m JOIN funding_calls fc ON fc.id=m.call_id WHERE ${where}`),
    prisma.$queryRaw<Array<{ call_id: string; title: string; school_id: string; school_name: string; source: MappingSource; tier: string | null; reason: string | null
      is_origin: boolean; mapped_at: Date; backfilled: boolean; is_active: boolean; ended_at: Date | null; ended_reason: string | null; mapped_by: string | null; ended_by: string | null }>>(Prisma.sql`
      SELECT m.call_id, COALESCE(fc.scheme_title, fc.title) title, m.school_id, s.name school_name, m.source, m.tier, m.reason, m.is_origin, m.mapped_at, m.backfilled,
             m.is_active, m.ended_at, m.ended_reason, COALESCE(mb.name, mb.email) mapped_by, COALESCE(eb.name, eb.email) ended_by
        FROM dsr_call_school_mappings m JOIN funding_calls fc ON fc.id=m.call_id JOIN tenant_org_units s ON s.id=m.school_id
        LEFT JOIN users mb ON mb.id=m.mapped_by LEFT JOIN users eb ON eb.id=m.ended_by
       WHERE ${where} ORDER BY m.mapped_at DESC, m.call_id, m.school_id
       ${f.all ? Prisma.empty : Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`}`),
  ])
  return { rows: rows.map(r => ({ ...r, sourceLabel: MAPPING_SOURCE_LABELS[r.source] || r.source, reconstructed: r.source === 'RECONSTRUCTED_FROM_WORK' || r.backfilled })),
    total: count[0]?.n ?? 0, page, pageSize }
}

/** Open, visible calls nobody has classified. Head-owned; aged so it cannot become a black hole. */
export async function getUnclassifiedQueue(tenantId: string, f: { page?: number; pageSize?: number; all?: boolean; asOf?: Date } = {}) {
  const page = Math.max(1, f.page || 1), pageSize = Math.min(100, Math.max(1, f.pageSize || 20))
  const settings = await getDeptSettings(tenantId)
  const asOf = f.asOf ?? new Date()
  const where = Prisma.sql`${visibleCallSql(tenantId, 'fc')} AND ${openCallSql('fc')}
    AND NOT EXISTS (SELECT 1 FROM funding_call_research_area_taxonomies t WHERE t.funding_call_id = fc.id)`
  const [count, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number; overdue: number }>>(Prisma.sql`SELECT count(*)::int n,
        count(*) FILTER (WHERE COALESCE(fc."publishedAt", fc."createdAt") < ${new Date(asOf.getTime() - settings.untouchedDays * 86400000)})::int overdue
        FROM funding_calls fc WHERE ${where}`),
    prisma.$queryRaw<Array<{ id: string; title: string; agency: string | null; entered_at: Date; deadline: Date | null; origin_school: string | null; global: boolean }>>(Prisma.sql`
      SELECT fc.id, COALESCE(fc.scheme_title, fc.title) title, COALESCE(fc.agency_name, fc."agencyName") agency, COALESCE(fc."publishedAt", fc."createdAt") entered_at,
             COALESCE(fc.close_date, fc."deadlineAt") deadline, fc.origin_school_name origin_school, fc."tenantId" IS NULL global
        FROM funding_calls fc WHERE ${where}
       ORDER BY COALESCE(fc.close_date, fc."deadlineAt") ASC NULLS LAST, fc.id
       ${f.all ? Prisma.empty : Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`}`),
  ])
  return {
    rows: rows.map(r => ({ ...r, ageDays: Math.max(0, Math.floor((asOf.getTime() - r.entered_at.getTime()) / 86400000)) })),
    total: count[0]?.n ?? 0, overdue: count[0]?.overdue ?? 0, overdueAfterDays: settings.untouchedDays, page, pageSize,
  }
}

/** Schools that cannot be routed to: nothing mapped, or nobody covering them. */
export async function getSchoolRoutingGaps(tenantId: string, scopeSchoolIds?: string[]) {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; areas: number; keywords: number; coordinator: string | null; active_mappings: number }>>(Prisma.sql`
    SELECT s.id, s.name,
      (SELECT count(*)::int FROM tenant_org_unit_research_areas ra JOIN tenant_org_units u ON u.id=ra.org_unit_id AND u.is_active WHERE ra.tenant_id=${tenantId} AND u.path[1]=s.id) areas,
      (SELECT count(*)::int FROM tenant_org_units u, unnest(u.keywords) k WHERE u.tenant_id=${tenantId} AND u.is_active AND u.path[1]=s.id) keywords,
      (SELECT COALESCE(us.name, us.email) FROM funding_dept_school_assignments sa JOIN funding_dept_members dm ON dm.id=sa.member_id AND dm.is_active JOIN users us ON us.id=dm.user_id
        WHERE sa.tenant_id=${tenantId} AND sa.org_unit_id=s.id AND NOT sa.is_deputy LIMIT 1) coordinator,
      (SELECT count(*)::int FROM dsr_call_school_mappings m WHERE m.tenant_id=${tenantId} AND m.school_id=s.id AND m.is_active) active_mappings
    FROM tenant_org_units s WHERE s.tenant_id=${tenantId} AND s.depth=0 AND s.is_active
      ${scopeSchoolIds ? Prisma.sql`AND s.id = ANY(${textArray(scopeSchoolIds)})` : Prisma.empty}
    ORDER BY s.name`)
  return rows.filter(r => r.areas + r.keywords === 0 || !r.coordinator).map(r => ({
    ...r,
    problems: [r.areas + r.keywords === 0 ? 'No research areas or keywords: receives no mapped calls' : null,
      !r.coordinator ? `No primary coordinator: ${r.active_mappings} mapped call${r.active_mappings === 1 ? '' : 's'} reach nobody` : null].filter(Boolean) as string[],
    nextAction: !r.coordinator ? 'Assign coverage' : 'Map research areas',
  }))
}
