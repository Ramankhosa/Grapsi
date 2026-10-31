import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { getTenantTimeZone } from '@/lib/tenant/locale'
import { CALL_MATCH_CENSUS_VERSION } from '@/lib/researcherMatching/config'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { openCallSql, visibleCallSql, effectiveCallDeadlineSql } from './callSql'
import { callFingerprint } from './callMatchFingerprint'
import { coordinatorSql } from './hubScope'
import { getMatchWidth } from './settings'
import { buildSchoolRoutingPreview, routingSnapshotStatus, type PreviewMatch, type PreviewSchool, type RoutingSnapshot } from './researcherRoutingPolicy'

export type PreviewOptions = { callId?: string; search?: string; page?: number }
export class RoutingPreviewError extends Error { constructor(message: string, public status: number) { super(message) } }

export async function researcherRoutingPreview(tenantId: string, options: PreviewOptions = {}) {
  const [zone, width] = await Promise.all([getTenantTimeZone(tenantId), getMatchWidth(tenantId)])
  const page = Math.max(1, options.page || 1), pageSize = 20
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const eligible = Prisma.sql`${visibleCallSql(tenantId)} AND ${openCallSql('fc', zone)}
      ${options.search ? Prisma.sql`AND strpos(lower(COALESCE(fc.scheme_title,fc.title)),lower(${options.search}))>0` : Prisma.empty}`
    const [count] = await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT count(*)::int total FROM funding_calls fc WHERE ${eligible}`)
    const calls = await tx.$queryRaw<Array<{ id: string; title: string }>>(Prisma.sql`
      SELECT fc.id,COALESCE(fc.scheme_title,fc.title) title FROM funding_calls fc WHERE ${eligible}
      ORDER BY ${effectiveCallDeadlineSql('fc', zone)} ASC NULLS LAST,fc.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`)
    const [coverage] = await tx.$queryRaw<Array<{ profiles: number; unplaced: number; invalidPlacement: number; missingEmbedding: number; missingResearch: number }>>(Prisma.sql`
      SELECT count(*)::int profiles,
        count(*) FILTER(WHERE p.org_unit_id IS NULL)::int unplaced,
        count(*) FILTER(WHERE p.org_unit_id IS NOT NULL AND (o.id IS NULL OR o.tenant_id<>${tenantId} OR NOT o.is_active OR root.id IS NULL OR NOT root.is_active OR root.tenant_id<>${tenantId} OR root.depth<>0))::int "invalidPlacement",
        count(*) FILTER(WHERE p.embedding_voyage_1024 IS NULL)::int "missingEmbedding",
        count(*) FILTER(WHERE nullif(btrim(p.research_summary),'') IS NULL AND cardinality(p.research_areas)=0 AND cardinality(p.keywords)=0)::int "missingResearch"
      FROM researcher_profiles p JOIN users u ON u.id=p.user_id AND u."tenantId"=${tenantId} AND u.status='ACTIVE'
      LEFT JOIN tenant_org_units o ON o.id=p.org_unit_id LEFT JOIN tenant_org_units root ON root.id=o.path[1]`)
    const issues = await tx.$queryRaw<Array<{ id: string; name: string; issue: string }>>(Prisma.sql`
      SELECT u.id,COALESCE(nullif(p.display_name,''),u.name,u.email) name,
        CASE WHEN p.org_unit_id IS NULL THEN 'School placement missing'
          WHEN o.id IS NULL OR o.tenant_id<>${tenantId} OR NOT o.is_active OR root.id IS NULL OR NOT root.is_active OR root.tenant_id<>${tenantId} OR root.depth<>0 THEN 'School placement needs correction'
          WHEN p.embedding_voyage_1024 IS NULL THEN 'Research index missing' ELSE 'Research description missing' END issue
      FROM researcher_profiles p JOIN users u ON u.id=p.user_id AND u."tenantId"=${tenantId} AND u.status='ACTIVE'
      LEFT JOIN tenant_org_units o ON o.id=p.org_unit_id LEFT JOIN tenant_org_units root ON root.id=o.path[1]
      WHERE p.org_unit_id IS NULL OR o.id IS NULL OR o.tenant_id<>${tenantId} OR NOT o.is_active OR root.id IS NULL OR NOT root.is_active OR root.tenant_id<>${tenantId} OR root.depth<>0
        OR p.embedding_voyage_1024 IS NULL OR (nullif(btrim(p.research_summary),'') IS NULL AND cardinality(p.research_areas)=0 AND cardinality(p.keywords)=0)
      ORDER BY name,u.id LIMIT 20`)
    const selectedId = options.callId || calls[0]?.id
    const selected = selectedId ? await tx.fundingCall.findFirst({ where: { AND: [{ id: selectedId }, visibleFundingCallWhere(tenantId)] },
      select: { id: true, title: true, scheme_title: true, career_stages: true, institution_types: true } }) : null
    if (selectedId && !selected) throw new RoutingPreviewError('Call not found or not available to this department.', 404)
    if (selected) {
      const [open] = await tx.$queryRaw<Array<{ open: boolean }>>(Prisma.sql`SELECT ${openCallSql('fc', zone)} AS open FROM funding_calls fc WHERE fc.id=${selected.id}`)
      if (!open?.open) throw new RoutingPreviewError('Choose an open, released call for this preview.', 409)
    }
    const base = { previewOnly: true as const, activationEnabled: false as const, asOf: new Date().toISOString(), width,
      calls, page, pageSize, totalCalls: count.total, coverage, issues,
      coverageNote: 'Profile checks are not a verification that every matching evidence source was processed. Eligibility and routing calibration remain pending.' }
    if (!selected) return { ...base, call: null, snapshotStatus: 'MISSING' as const, snapshot: null, schools: [] }
    const [snapshotRows, schools, matches, fingerprint] = await Promise.all([
      tx.$queryRaw<NonNullable<RoutingSnapshot>[]>(Prisma.sql`SELECT version,fingerprint,basis,(refreshed_at AT TIME ZONE 'UTC')::timestamptz AS "refreshedAt"
        FROM dsr_call_match_state WHERE tenant_id=${tenantId} AND call_id=${selected.id} AND version=${CALL_MATCH_CENSUS_VERSION}`),
      tx.$queryRaw<PreviewSchool[]>(Prisma.sql`SELECT s.id,s.name,
        (SELECT COALESCE(u.name,u.email) FROM users u WHERE u.id=${coordinatorSql(tenantId, 's.id', Prisma.sql`${selected.id}`)} AND u."tenantId"=${tenantId}) coordinator,
        EXISTS(SELECT 1 FROM dsr_call_school_mappings m WHERE m.tenant_id=${tenantId} AND m.school_id=s.id AND m.call_id=${selected.id} AND m.is_active) institutional
        FROM tenant_org_units s WHERE s.tenant_id=${tenantId} AND s.is_active AND s.depth=0 ORDER BY s.name`),
      tx.$queryRaw<PreviewMatch[]>(Prisma.sql`SELECT m.user_id "userId",COALESCE(nullif(p.display_name,''),u.name,u.email) name,m.school_id "schoolId",
        p.org_unit_id "unitId",unit.name "unitName",CASE WHEN unit.is_active AND unit.tenant_id=${tenantId} AND root.is_active AND root.tenant_id=${tenantId} AND root.depth=0 THEN root.id ELSE NULL END "actualSchoolId",
        m.match_score score,m.match_tier "storedBand",m.match_reason reason,m.inferred,m.source_version "sourceVersion",m.is_current current,p.career_stage "careerStage",p.institution_type "institutionType"
        FROM funding_opportunity_matches m JOIN users u ON u.id=m.user_id AND u."tenantId"=${tenantId} AND u.status='ACTIVE'
        JOIN researcher_profiles p ON p.user_id=u.id LEFT JOIN tenant_org_units unit ON unit.id=p.org_unit_id LEFT JOIN tenant_org_units root ON root.id=unit.path[1]
        WHERE m.tenant_id=${tenantId} AND m.funding_call_id=${selected.id} AND m.is_current`),
      callFingerprint(tenantId, selected.id, tx),
    ])
    const snapshot = snapshotRows[0] ? { ...snapshotRows[0], refreshedAt: new Date(snapshotRows[0].refreshedAt).toISOString() } : null
    return { ...base, call: { id: selected.id, title: selected.scheme_title || selected.title }, snapshot,
      snapshotStatus: routingSnapshotStatus(snapshot, fingerprint),
      schools: buildSchoolRoutingPreview(schools, matches, width, { careerStages: selected.career_stages || [], institutionTypes: selected.institution_types || [] }) }
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 })
}

export type ResearcherRoutingPreview = Awaited<ReturnType<typeof researcherRoutingPreview>>
