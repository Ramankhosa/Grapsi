/**
 * Which schools a call is the business of — decided once, stored, dated.
 *
 * `callUnitRelevance` answers "is this call relevant to this school" on every
 * read, and operational routing (`actionableSchoolCallWhereSql`) then only
 * showed a school the call once a researcher of its own had been matched. A
 * relevant school whose matching had not finished, or found nobody, never saw
 * the call at all. This module writes the answer down as a
 * `dsr_call_school_mappings` row the moment classification finishes, so the
 * school's coordinator sees it whatever matching later concludes.
 *
 * Rules:
 *   - direct and keyword matches map; broad matches map only when the
 *     department allows it (`mapBroadTier`, default off)
 *   - an unclassified call maps nowhere except its origin school; it waits in
 *     the head's Unclassified queue instead
 *   - a school with no research areas or keywords receives nothing — its
 *     profile would otherwise match every call
 *   - add-only: re-running never removes or re-dates a row, and never revives
 *     one the head ended. Only `endCallSchoolMapping` ends a mapping, with a
 *     reason, and the row stays as history
 *
 * Each tier is checked on its own rather than through `tierForCall`, which
 * keeps only the strongest tier: broad outranks keyword there, so with broad
 * mapping switched off a call matching a school both broadly and by keyword
 * would be read as "broad" and never mapped.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { textArray } from './callSql'
import { getDeptSettings } from './settings'

export const MAPPING_SOURCES = ['ORIGIN', 'INGESTION_DIRECT', 'INGESTION_KEYWORD', 'INGESTION_BROAD', 'ADDED_BY_HEAD', 'RECONSTRUCTED_FROM_WORK'] as const
export type MappingSource = (typeof MAPPING_SOURCES)[number]
export type MappingTier = 'direct' | 'keyword' | 'broad'
export const MAPPING_SOURCE_LABELS: Record<MappingSource, string> = {
  ORIGIN: 'Origin school',
  INGESTION_DIRECT: 'Ingestion: direct discipline match',
  INGESTION_KEYWORD: 'Ingestion: school keyword match',
  INGESTION_BROAD: 'Ingestion: broad discipline group',
  ADDED_BY_HEAD: 'Added by the DSR head',
  RECONSTRUCTED_FROM_WORK: 'Reconstructed from recorded work',
}

export type SchoolAreaProfile = { schoolId: string; areaIds: Set<string>; level1Codes: Set<string>; keywords: Set<string>; isUnmapped: boolean }
export type CallAreaRow = { taxonomy_area_id: string; taxonomy_level1_code: string | null; taxonomy_level1_name: string | null; taxonomy_level2_name: string | null }

/**
 * The mapping decision for one call and one school. Pure, so the tier rules
 * are unit-tested without a database. Returns null when the call is not this
 * school's business (or cannot be judged: unclassified call, unmapped school).
 */
export function mappingDecision(
  callAreas: CallAreaRow[], disciplines: string[] | null | undefined, profile: SchoolAreaProfile, options: { includeBroad: boolean }
): { tier: MappingTier; source: MappingSource; reason: string } | null {
  if (profile.isUnmapped || callAreas.length === 0) return null
  const direct = callAreas.find(area => profile.areaIds.has(area.taxonomy_area_id))
  if (direct) {
    const label = direct.taxonomy_level2_name ? `${direct.taxonomy_level1_name} → ${direct.taxonomy_level2_name}` : direct.taxonomy_level1_name || 'Mapped discipline'
    return { tier: 'direct', source: 'INGESTION_DIRECT', reason: label }
  }
  const keyword = (disciplines || []).find(tag => profile.keywords.has((tag || '').trim().toLowerCase()))
  if (keyword) return { tier: 'keyword', source: 'INGESTION_KEYWORD', reason: `Matches the school keyword "${keyword.trim()}"` }
  if (options.includeBroad) {
    const broad = callAreas.find(area => area.taxonomy_level1_code && profile.level1Codes.has(area.taxonomy_level1_code))
    if (broad) return { tier: 'broad', source: 'INGESTION_BROAD', reason: `${broad.taxonomy_level1_name || broad.taxonomy_level1_code} (related area)` }
  }
  return null
}

/** Every active school's effective profile (its whole subtree), in two queries. */
export async function loadSchoolProfiles(tenantId: string, schoolIds?: string[]): Promise<SchoolAreaProfile[]> {
  const schools = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: tenantId, depth: 0, is_active: true, ...(schoolIds ? { id: { in: schoolIds } } : {}) },
    select: { id: true },
  })
  if (!schools.length) return []
  const ids = textArray(schools.map(s => s.id))
  const [areas, keywords] = await Promise.all([
    prisma.$queryRaw<Array<{ school_id: string; taxonomy_area_id: string; level1_code: string }>>(Prisma.sql`
      SELECT DISTINCT unit.path[1] school_id, ra.taxonomy_area_id, area.level1_code
        FROM tenant_org_unit_research_areas ra
        JOIN tenant_org_units unit ON unit.id = ra.org_unit_id AND unit.is_active
        JOIN research_area_taxonomy_areas area ON area.id = ra.taxonomy_area_id AND area.is_active
        JOIN research_area_taxonomy_uploads upload ON upload.id = area.upload_id AND upload.status = 'ACTIVE'
       WHERE ra.tenant_id = ${tenantId} AND unit.path[1] = ANY(${ids})`),
    prisma.$queryRaw<Array<{ school_id: string; keyword: string }>>(Prisma.sql`
      SELECT DISTINCT unit.path[1] school_id, lower(btrim(k)) keyword
        FROM tenant_org_units unit, unnest(unit.keywords) k
       WHERE unit.tenant_id = ${tenantId} AND unit.is_active AND unit.path[1] = ANY(${ids}) AND btrim(k) <> ''`),
  ])
  return schools.map(school => {
    const own = areas.filter(a => a.school_id === school.id)
    const words = keywords.filter(k => k.school_id === school.id).map(k => k.keyword)
    return { schoolId: school.id, areaIds: new Set(own.map(a => a.taxonomy_area_id)), level1Codes: new Set(own.map(a => a.level1_code).filter(Boolean)),
      keywords: new Set(words), isUnmapped: own.length === 0 && words.length === 0 }
  })
}

export type PlannedMapping = {
  tenantId: string; callId: string; schoolId: string; source: MappingSource; tier: MappingTier | null
  reason: string; isOrigin: boolean; mappedAt: Date; backfilled: boolean
}

/**
 * The mappings these calls should have in one tenant, from the current
 * classification, school profiles and origin evidence. Plans only; the writer
 * decides what is new.
 */
export async function planTenantMappings(tenantId: string, callIds: string[], options: { schoolIds?: string[]; mappedAt?: Date; backfilled?: boolean } = {}): Promise<PlannedMapping[]> {
  if (!callIds.length) return []
  const mappedAt = options.mappedAt ?? new Date()
  const ids = textArray(callIds)
  const [settings, profiles, calls, areas, origins] = await Promise.all([
    getDeptSettings(tenantId),
    loadSchoolProfiles(tenantId, options.schoolIds),
    prisma.$queryRaw<Array<{ id: string; disciplines: string[] | null }>>(Prisma.sql`SELECT id, disciplines FROM funding_calls WHERE id = ANY(${ids})`),
    prisma.$queryRaw<Array<CallAreaRow & { funding_call_id: string }>>(Prisma.sql`
      SELECT funding_call_id, taxonomy_area_id, taxonomy_level1_code, taxonomy_level1_name, taxonomy_level2_name
        FROM funding_call_research_area_taxonomies WHERE funding_call_id = ANY(${ids})`),
    prisma.$queryRaw<Array<{ call_id: string; school_id: string; arrived_at: Date }>>(Prisma.sql`
      SELECT o.call_id, o.school_id, MIN(o.arrived_at) arrived_at FROM dsr_origin_responsibilities o
        JOIN tenant_org_units s ON s.id = o.school_id AND s.tenant_id = ${tenantId} AND s.depth = 0
       WHERE o.tenant_id = ${tenantId} AND o.call_id = ANY(${ids}) GROUP BY o.call_id, o.school_id`),
  ])
  const wanted = options.schoolIds ? new Set(options.schoolIds) : null
  const planned: PlannedMapping[] = []
  for (const call of calls) {
    const callAreas = areas.filter(a => a.funding_call_id === call.id)
    const originSchools = origins.filter(o => o.call_id === call.id && (!wanted || wanted.has(o.school_id)))
    for (const origin of originSchools) {
      planned.push({ tenantId, callId: call.id, schoolId: origin.school_id, source: 'ORIGIN', tier: null, reason: 'Entered by this school',
        isOrigin: true, mappedAt: options.backfilled ? origin.arrived_at : mappedAt, backfilled: Boolean(options.backfilled) })
    }
    for (const profile of profiles) {
      if (originSchools.some(o => o.school_id === profile.schoolId)) continue
      const decision = mappingDecision(callAreas, call.disciplines, profile, { includeBroad: settings.mapBroadTier })
      if (decision) planned.push({ tenantId, callId: call.id, schoolId: profile.schoolId, ...decision, isOrigin: false, mappedAt, backfilled: Boolean(options.backfilled) })
    }
  }
  return planned
}

/**
 * Insert planned rows that do not exist yet, and one MAPPED audit event per
 * inserted row, in a single statement. Existing rows — active or ended — are
 * left exactly as they are, except that a row gains the origin flag when the
 * origin evidence arrives after it was first mapped.
 */
export async function writeMappings(rows: PlannedMapping[], actorId: string | null = null): Promise<PlannedMapping[]> {
  if (!rows.length) return []
  const byTenant = new Map<string, PlannedMapping[]>()
  for (const row of rows) byTenant.set(row.tenantId, [...(byTenant.get(row.tenantId) || []), row])
  const inserted: PlannedMapping[] = []
  for (const [tenantId, tenantRows] of byTenant) {
    const json = JSON.stringify(tenantRows.map(r => ({ call_id: r.callId, school_id: r.schoolId, source: r.source, tier: r.tier, reason: r.reason,
      is_origin: r.isOrigin, mapped_at: r.mappedAt.toISOString(), backfilled: r.backfilled })))
    const created = await prisma.$queryRaw<Array<{ call_id: string; school_id: string }>>(Prisma.sql`
      WITH input AS (
        SELECT * FROM jsonb_to_recordset(${json}::jsonb)
          AS r(call_id text, school_id text, source text, tier text, reason text, is_origin boolean, mapped_at text, backfilled boolean)
      ), ins AS (
        INSERT INTO dsr_call_school_mappings(tenant_id, call_id, school_id, source, tier, reason, is_origin, mapped_at, mapped_by, backfilled)
        SELECT ${tenantId}, call_id, school_id, source, tier, reason, is_origin, mapped_at::timestamptz, ${actorId}, backfilled FROM input
        ON CONFLICT (tenant_id, call_id, school_id) DO NOTHING
        RETURNING *
      ), evt AS (
        INSERT INTO dsr_events(tenant_id, school_id, entity_type, entity_id, actor_user_id, kind, after_data, reason, inferred, occurred_at)
        SELECT tenant_id, school_id, 'MAPPING', call_id, mapped_by, 'MAPPED', to_jsonb(ins), reason, backfilled, now() FROM ins
      )
      SELECT call_id, school_id FROM ins`)
    await prisma.$executeRaw(Prisma.sql`
      UPDATE dsr_call_school_mappings m SET is_origin = true
        FROM jsonb_to_recordset(${json}::jsonb) AS r(call_id text, school_id text, is_origin boolean)
       WHERE m.tenant_id = ${tenantId} AND m.call_id = r.call_id AND m.school_id = r.school_id AND r.is_origin AND NOT m.is_origin`)
    const key = new Set(created.map(c => `${c.call_id}:${c.school_id}`))
    inserted.push(...tenantRows.filter(r => key.has(`${r.callId}:${r.schoolId}`)))
  }
  return inserted
}

/** Tenants a call can be routed in: its own, or every tenant with a funding department for a global call. */
async function tenantsForCall(callId: string): Promise<string[]> {
  const call = await prisma.fundingCall.findUnique({ where: { id: callId }, select: { tenantId: true, visibility: true } })
  if (!call) return []
  if (call.tenantId) return [call.tenantId]
  if (call.visibility !== 'GLOBAL_PUBLISHED') return []
  const rows = await prisma.fundingDeptMember.findMany({ where: { is_active: true }, distinct: ['tenant_id'], select: { tenant_id: true } })
  return rows.map(r => r.tenant_id)
}

/**
 * Map one call wherever classification (or an origin) makes it some school's
 * business. Safe to call repeatedly — it only ever adds.
 */
export async function mapCallToSchools(callId: string, options: { tenantIds?: string[]; actorId?: string | null } = {}) {
  const tenantIds = options.tenantIds ?? await tenantsForCall(callId)
  const planned = (await Promise.all(tenantIds.map(tenantId => planTenantMappings(tenantId, [callId])))).flat()
  return writeMappings(planned, options.actorId ?? null)
}

/** Fire-and-forget form for publish and classification paths, which must never fail because of routing. */
export function mapCallToSchoolsQuietly(callId: string) {
  void mapCallToSchools(callId).catch(error => {
    console.warn(`[DSR MAPPING] Could not map call ${callId}:`, error instanceof Error ? error.message : String(error))
  })
}

/**
 * A school's research areas or keywords changed: add mappings for the calls
 * still open to it. Add-only — narrowing a school's profile never removes the
 * responsibilities it already has.
 */
export async function remapSchoolOpenCalls(tenantId: string, schoolIds: string[], actorId: string | null = null) {
  const roots = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT path[1] id FROM tenant_org_units WHERE tenant_id = ${tenantId} AND id = ANY(${textArray(schoolIds)})`)
  if (!roots.length) return []
  const calls = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT fc.id FROM funding_calls fc
     WHERE ((fc."tenantId" = ${tenantId}) OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED'))
       AND (COALESCE(fc.close_date, fc."deadlineAt") IS NULL
            OR (COALESCE(fc.close_date, fc."deadlineAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
       AND EXISTS (SELECT 1 FROM funding_call_research_area_taxonomies m WHERE m.funding_call_id = fc.id)`)
  const planned = await planTenantMappings(tenantId, calls.map(c => c.id), { schoolIds: roots.map(r => r.id) })
  return writeMappings(planned, actorId)
}

export function remapSchoolOpenCallsQuietly(tenantId: string, schoolIds: string[], actorId: string | null = null) {
  void remapSchoolOpenCalls(tenantId, schoolIds, actorId).catch(error => {
    console.warn('[DSR MAPPING] Could not remap school calls:', error instanceof Error ? error.message : String(error))
  })
}

export class MappingError extends Error { constructor(message: string, public status = 400) { super(message) } }

/** The head adds a school to a call by hand. Reactivates an ended row, keeping its history in the audit trail. */
export async function addCallSchoolMapping(tenantId: string, callId: string, schoolId: string, actorId: string, reason: string) {
  if (!reason.trim()) throw new MappingError('Say why this school should own the call.')
  return prisma.$transaction(async tx => {
    const school = await tx.tenantOrgUnit.findFirst({ where: { id: schoolId, tenant_id: tenantId, depth: 0 }, select: { id: true } })
    if (!school) throw new MappingError('School not found.', 404)
    const call = await tx.fundingCall.findFirst({ where: { id: callId, OR: [{ tenantId }, { tenantId: null, visibility: 'GLOBAL_PUBLISHED' }] }, select: { id: true } })
    if (!call) throw new MappingError('Call not found.', 404)
    const before = (await tx.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM dsr_call_school_mappings WHERE tenant_id=${tenantId} AND call_id=${callId} AND school_id=${schoolId} FOR UPDATE`))[0] ?? null
    if (before && (before as { is_active: boolean }).is_active) throw new MappingError('This school already owns the call.', 409)
    const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
      INSERT INTO dsr_call_school_mappings(tenant_id, call_id, school_id, source, tier, reason, mapped_at, mapped_by)
      VALUES (${tenantId}, ${callId}, ${schoolId}, 'ADDED_BY_HEAD', NULL, ${reason.trim()}, now(), ${actorId})
      ON CONFLICT (tenant_id, call_id, school_id) DO UPDATE SET source='ADDED_BY_HEAD', tier=NULL, reason=EXCLUDED.reason, is_active=true,
        ended_at=NULL, ended_by=NULL, ended_reason=NULL, mapped_at=EXCLUDED.mapped_at, mapped_by=EXCLUDED.mapped_by
      RETURNING *`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id, school_id, entity_type, entity_id, actor_user_id, kind, before_data, after_data, reason, occurred_at)
      VALUES (${tenantId}, ${schoolId}, 'MAPPING', ${callId}, ${actorId}, ${before ? 'REINSTATED' : 'ADDED_BY_HEAD'}, ${before ? JSON.stringify(before) : null}::jsonb, ${JSON.stringify(rows[0])}::jsonb, ${reason.trim()}, now())`)
    return rows[0]
  })
}

/** Only the head ends a mapping, and only with a reason. The row stays as history. */
export async function endCallSchoolMapping(tenantId: string, callId: string, schoolId: string, actorId: string, reason: string) {
  if (!reason.trim()) throw new MappingError('Say why this school no longer owns the call.')
  return prisma.$transaction(async tx => {
    const before = (await tx.$queryRaw<Array<{ is_active: boolean }>>(Prisma.sql`SELECT * FROM dsr_call_school_mappings WHERE tenant_id=${tenantId} AND call_id=${callId} AND school_id=${schoolId} FOR UPDATE`))[0]
    if (!before) throw new MappingError('Mapping not found.', 404)
    if (!before.is_active) throw new MappingError('This mapping has already ended.', 409)
    const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
      UPDATE dsr_call_school_mappings SET is_active=false, ended_at=now(), ended_by=${actorId}, ended_reason=${reason.trim()}
       WHERE tenant_id=${tenantId} AND call_id=${callId} AND school_id=${schoolId} RETURNING *`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id, school_id, entity_type, entity_id, actor_user_id, kind, before_data, after_data, reason, occurred_at)
      VALUES (${tenantId}, ${schoolId}, 'MAPPING', ${callId}, ${actorId}, 'ENDED', ${JSON.stringify(before)}::jsonb, ${JSON.stringify(rows[0])}::jsonb, ${reason.trim()}, now())`)
    return rows[0]
  })
}

/** Routing clause: an active mapping names this school. Gated per tenant by `callMappingRoutingEnabled`. */
export function activeMappingSql(tenantId: string, schoolId: string, callIdExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(EXISTS(SELECT 1 FROM dsr_call_school_mappings mapping
      WHERE mapping.tenant_id=${tenantId} AND mapping.school_id=${schoolId} AND mapping.call_id=${callIdExpr} AND mapping.is_active)
    AND EXISTS(SELECT 1 FROM tenants routing_tenant WHERE routing_tenant.id=${tenantId}
      AND COALESCE((routing_tenant.dept_settings->>'callMappingRoutingEnabled')::boolean, false)))`
}

/* -------------------------------------------------------------------------- */
/* One-off backfill                                                           */
/* -------------------------------------------------------------------------- */

const BACKFILL_PRIORITY: Record<MappingSource, number> = { ORIGIN: 0, RECONSTRUCTED_FROM_WORK: 1, INGESTION_DIRECT: 2, INGESTION_KEYWORD: 3, INGESTION_BROAD: 4, ADDED_BY_HEAD: 5 }

/**
 * The rows a backfill would write for one tenant, with honest dates:
 *   ORIGIN                   dated by the earliest arrival that named the school
 *   RECONSTRUCTED_FROM_WORK  a school that already worked the call, dated by its
 *                            first recorded observation or evidence — never by
 *                            the call's own intake date
 *   INGESTION_*              open calls relevant today, dated the backfill day
 * One row per call and school, in that order of precedence. Existing rows are
 * reported separately and never touched.
 */
export async function planBackfill(tenantId: string, backfillDay = new Date()) {
  const [origins, work, openCalls, existing] = await Promise.all([
    prisma.$queryRaw<Array<{ call_id: string }>>(Prisma.sql`SELECT DISTINCT call_id FROM dsr_origin_responsibilities WHERE tenant_id=${tenantId}`),
    prisma.$queryRaw<Array<{ call_id: string; school_id: string; first_evidence: Date; kinds: string[] }>>(Prisma.sql`
      WITH evidence AS (
        SELECT funding_call_id call_id, org_unit_id school_id, decided_at at, 'triage' kind FROM call_school_triage WHERE tenant_id=${tenantId} AND decided_at IS NOT NULL
        UNION ALL SELECT call_id, school_id, created_at, 'application' FROM dsr_applications WHERE tenant_id=${tenantId} AND call_id IS NOT NULL
        UNION ALL SELECT call_id, school_id, created_at, 'action' FROM dsr_actions WHERE tenant_id=${tenantId} AND call_id IS NOT NULL
        UNION ALL SELECT call_id, school_id, updated_at, 'disposition' FROM dsr_opportunity_dispositions WHERE tenant_id=${tenantId}
        UNION ALL SELECT f.funding_call_id, u.path[1], f.happened_at, 'follow-up' FROM assignment_follow_ups f JOIN tenant_org_units u ON u.id=f.org_unit_id WHERE f.tenant_id=${tenantId} AND f.funding_call_id IS NOT NULL
        UNION ALL SELECT c.funding_call_id, u.path[1], c.created_at, 'candidate' FROM call_candidates c JOIN researcher_profiles p ON p.user_id=c.user_id JOIN tenant_org_units u ON u.id=p.org_unit_id WHERE c.tenant_id=${tenantId}
      )
      SELECT e.call_id, e.school_id, LEAST(MIN(e.at), MIN(o.first_seen_at)) first_evidence, array_agg(DISTINCT e.kind) kinds
        FROM evidence e
        JOIN tenant_org_units s ON s.id=e.school_id AND s.tenant_id=${tenantId} AND s.depth=0
        JOIN funding_calls fc ON fc.id=e.call_id
        LEFT JOIN dsr_opportunity_observations o ON o.tenant_id=${tenantId} AND o.school_id=e.school_id AND o.call_id=e.call_id
       WHERE e.school_id IS NOT NULL GROUP BY e.call_id, e.school_id`),
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT fc.id FROM funding_calls fc
       WHERE ((fc."tenantId"=${tenantId} AND (fc.status='PUBLISHED' OR fc.catalog_status='PUBLISHED'))
              OR (fc."tenantId" IS NULL AND fc.visibility='GLOBAL_PUBLISHED' AND fc.status='PUBLISHED'))
         AND (COALESCE(fc.close_date, fc."deadlineAt") IS NULL
              OR (COALESCE(fc.close_date, fc."deadlineAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)`),
    prisma.$queryRaw<Array<{ call_id: string; school_id: string }>>(Prisma.sql`SELECT call_id, school_id FROM dsr_call_school_mappings WHERE tenant_id=${tenantId}`),
  ])
  const originRows = (await planTenantMappings(tenantId, origins.map(o => o.call_id), { backfilled: true })).filter(r => r.source === 'ORIGIN')
  const reconstructed: PlannedMapping[] = work.map(w => ({ tenantId, callId: w.call_id, schoolId: w.school_id, source: 'RECONSTRUCTED_FROM_WORK', tier: null,
    reason: `Recorded work: ${w.kinds.sort().join(', ')}`, isOrigin: false, mappedAt: w.first_evidence, backfilled: true }))
  const relevant = (await planTenantMappings(tenantId, openCalls.map(c => c.id), { mappedAt: backfillDay, backfilled: true })).filter(r => r.source !== 'ORIGIN')
    .map(r => ({ ...r, reason: `${r.reason} (mapped at backfill)` }))
  const taken = new Set(existing.map(e => `${e.call_id}:${e.school_id}`))
  const chosen = new Map<string, PlannedMapping>()
  for (const row of [...originRows, ...reconstructed, ...relevant].sort((a, b) => BACKFILL_PRIORITY[a.source] - BACKFILL_PRIORITY[b.source])) {
    const key = `${row.callId}:${row.schoolId}`
    if (!chosen.has(key)) chosen.set(key, row)
  }
  const rows = [...chosen.values()].filter(r => !taken.has(`${r.callId}:${r.schoolId}`))
  const bySource = Object.fromEntries(MAPPING_SOURCES.map(source => [source, rows.filter(r => r.source === source).length]))
  return { tenantId, rows, bySource, alreadyMapped: [...chosen.keys()].filter(key => taken.has(key)).length,
    schools: new Set(rows.map(r => r.schoolId)).size, calls: new Set(rows.map(r => r.callId)).size }
}
