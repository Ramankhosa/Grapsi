import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { isAccessError } from '@/lib/auth/tenantAccess'
import { discoverablePersonSql, discoveryCapabilities, discoveryUnits, requireDiscoveryPeople, validateDiscoveryAreas } from '@/lib/discovery/server'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { eligibilityConflictTexts, eligibilityGroup } from '@/lib/funding/eligibilityAssessment'
import { researcherSearchService } from '@/lib/services/researcherSearchService'
import { UNPLACED_UNIT, type DiscoveryPerson } from '@/lib/discovery/types'

export const dynamic = 'force-dynamic'
const PAGE_SIZE = 12
const BROWSE_PAGE_SIZE = 24
const schema = z.object({ kind: z.enum(['standard', 'person', 'semantic', 'call', 'browse']), query: z.string().trim().max(300).default(''),
  areaIds: z.array(z.string().max(120)).max(20).default([]), unitId: z.string().max(120).optional(),
  includeSubunits: z.boolean().default(true), designation: z.string().trim().max(120).optional(),
  careerStage: z.string().trim().max(120).optional(),
  callId: z.string().max(120).optional(), page: z.number().int().min(1).max(500).default(1) }).strict()

/** Every member: what they may do, and the values the people filters offer. */
export const GET = withCatalogueProtection(async (request: NextRequest) => {
  const auth = await requireDiscoveryPeople(request)
  if (isAccessError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const options = await prisma.$queryRaw<Array<{ kind: string; value: string; n: number }>>(Prisma.sql`
    SELECT kind, value, n FROM (
      SELECT 'designation' kind, btrim(p.designation) value, count(*)::int n FROM users u JOIN researcher_profiles p ON p.user_id = u.id
       WHERE u."tenantId" = ${auth.tenantId} AND ${discoverablePersonSql('u')} AND nullif(btrim(p.designation), '') IS NOT NULL GROUP BY 2
      UNION ALL
      SELECT 'careerStage', btrim(p.career_stage), count(*)::int FROM users u JOIN researcher_profiles p ON p.user_id = u.id
       WHERE u."tenantId" = ${auth.tenantId} AND ${discoverablePersonSql('u')} AND nullif(btrim(p.career_stage), '') IS NOT NULL GROUP BY 2
    ) options ORDER BY kind, n DESC, value LIMIT 120`)
  const pick = (kind: string) => options.filter(o => o.kind === kind).slice(0, 60).map(o => ({ value: o.value, count: o.n }))
  return NextResponse.json({ canSearchPeople: true, scopeLabel: 'Your organisation', capabilities: discoveryCapabilities(auth),
    designations: pick('designation'), careerStages: pick('careerStage') }, { headers: { 'Cache-Control': 'private, no-store' } })
}, 'metadata')

export const POST = withCatalogueProtection(async (request: NextRequest) => {
  const auth = await requireDiscoveryPeople(request)
  if (isAccessError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Check the search fields and try again.' }, { status: 400 })
  const input = parsed.data
  if (['person', 'semantic'].includes(input.kind) && input.query.length < 2) return NextResponse.json({ error: 'Enter at least 2 characters to search.' }, { status: 400 })
  if (input.kind === 'standard' && !input.areaIds.length) return NextResponse.json({ error: 'Choose at least one research area.' }, { status: 400 })
  const unplaced = input.unitId === UNPLACED_UNIT
  if (unplaced && input.kind !== 'browse') return NextResponse.json({ error: 'Choose a school or department.' }, { status: 400 })
  const units = unplaced ? undefined : await discoveryUnits(auth, input.unitId, input.includeSubunits)
  let areas: Awaited<ReturnType<typeof validateDiscoveryAreas>>
  try { areas = await validateDiscoveryAreas(input.areaIds) } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
  try {
    if (input.kind === 'semantic' || input.kind === 'call') {
      let callRequiresRelease = false
      if (input.kind === 'call') {
        if (!input.callId) return NextResponse.json({ error: 'Choose a funding call first.' }, { status: 400 })
        const call = await prisma.fundingCall.findFirst({ where: { AND: [{ id: input.callId }, visibleFundingCallWhere(auth.tenantId, { includeCatalog: true })] }, select: { id: true, visibility: true } })
        if (!call) return NextResponse.json({ error: 'Funding call not found or not accessible.' }, { status: 404 })
        callRequiresRelease = call.visibility === 'GLOBAL_CATALOG'
      }
      const result = await researcherSearchService.search({ query: input.kind === 'semantic' ? input.query : null,
        fundingCallId: input.kind === 'call' ? input.callId : null, requesterTenantId: auth.tenantId, requesterUserId: auth.user.id,
        filters: { orgUnitIds: units, tenantOnly: true, includeSelf: true,
          designations: input.designation ? [input.designation] : undefined, exactCareerStage: input.careerStage || undefined },
        limit: 50, recordRun: false })
      // Ranked search returns research evidence; placement comes from the profile.
      const placement = new Map((result.results.length ? await prisma.researcherProfile.findMany({
        where: { user_id: { in: result.results.map(p => p.userId) } },
        select: { user_id: true, designation: true, school: true, department: true, org_unit_id: true, career_stage: true },
      }) : []).map(p => [p.user_id, p]))
      const people: DiscoveryPerson[] = result.results.map(p => {
        const where = placement.get(p.userId)
        return { id: p.userId, name: p.displayName,
          designation: where?.designation ?? null, school: where?.school ?? null, department: where?.department ?? p.department,
          unitId: where?.org_unit_id ?? null, careerStage: where?.career_stage ?? p.careerStage,
          summary: p.researchSummary, areas: p.researchAreas, standardAreas: [],
          savedAreas: p.evidence.filter(e => e.source === 'research_area' && e.title).map((e, i) => ({ id: `evidence:${i}`, label: e.title! })),
          matchReason: p.matchReason, matchTier: p.matchTier, score: p.score, eligibilityFlags: p.eligibilityFlags,
          eligibility: input.kind === 'call' && p.eligibility ? { group: eligibilityGroup(p.eligibility), conflicts: eligibilityConflictTexts(p.eligibility),
            toCheck: p.eligibility.reasons.filter(r => r.kind !== 'conflict').map(r => r.text) } : null }
      })
      return NextResponse.json({ people, total: people.length, page: 1, totalPages: 1, basis: 'semantic', bounded: true,
        callRequiresRelease,
        warning: result.degradedMode ? 'Some research indexes are unavailable. Results may be incomplete; retry later.' : 'Ranked research suggestions; eligibility and availability still need checking. These are separate from school report counts.' })
    }
    // All names, areas and counts share the same tenant, active-faculty and unit fence.
    const placementFence = unplaced
      ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM tenant_org_units unit WHERE unit.id = p.org_unit_id AND unit.tenant_id = ${auth.tenantId} AND unit.is_active)`
      : units ? Prisma.sql`AND p.org_unit_id=ANY(${units}::text[])` : Prisma.empty
    const scope = Prisma.sql`u."tenantId"=${auth.tenantId} AND ${discoverablePersonSql('u')} ${placementFence}
      ${input.designation ? Prisma.sql`AND lower(btrim(p.designation)) = lower(${input.designation})` : Prisma.empty}
      ${input.careerStage ? Prisma.sql`AND lower(btrim(p.career_stage)) = lower(${input.careerStage})` : Prisma.empty}`
    const nameMatch = (input.kind === 'person' || (input.kind === 'browse' && input.query)) ? Prisma.sql`AND (
      strpos(lower(concat_ws(' ',u.name,p.display_name)),lower(${input.query}))>0
      OR strpos(lower(u.email),lower(${input.query}))>0
      ${input.kind === 'person' && discoveryCapabilities(auth).canSeeEmployeeIds ? Prisma.sql`OR strpos(lower(coalesce(p.employee_id,'')),lower(${input.query}))>0` : Prisma.empty})` : Prisma.empty
    const areaMatch = input.kind === 'standard' ? Prisma.sql`AND (
      EXISTS(SELECT 1 FROM researcher_saved_research_areas s JOIN effective_saved_research_area_links e ON e.saved_area_id=s.id
        WHERE s.user_id=u.id AND e.area_id=ANY(${areas.map(a => a.id)}::text[]))
      OR EXISTS(SELECT 1 FROM unnest(p.research_areas) label WHERE lower(btrim(label))=ANY(${areas.map(a => a.label.toLowerCase())}::text[])))` : Prisma.empty
    const size = input.kind === 'browse' ? BROWSE_PAGE_SIZE : PAGE_SIZE
    const from = Prisma.sql`FROM users u LEFT JOIN researcher_profiles p ON p.user_id=u.id WHERE ${scope} ${nameMatch} ${areaMatch}`
    const [count] = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT count(*)::int total ${from}`)
    const total = count?.total || 0, totalPages = Math.max(1, Math.ceil(total / size)), page = Math.min(input.page, totalPages)
    const people = await prisma.$queryRaw<DiscoveryPerson[]>(Prisma.sql`SELECT u.id, coalesce(nullif(p.display_name,''),u.name,u.email) name,
      p.designation,p.school,p.department,p.org_unit_id "unitId",p.career_stage "careerStage",p.research_summary summary,coalesce(p.research_areas,ARRAY[]::text[]) areas,
      coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('id',a.id,'label',a.label))
        FROM researcher_saved_research_areas s JOIN effective_saved_research_area_links e ON e.saved_area_id=s.id
        JOIN catalogue_areas a ON a.id=e.area_id WHERE s.user_id=u.id),'[]'::jsonb) "standardAreas",
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'label',s.label) ORDER BY s.label) FROM researcher_saved_research_areas s WHERE s.user_id=u.id),'[]'::jsonb) "savedAreas"
      ${from} ORDER BY lower(coalesce(p.display_name,u.name,u.email)),u.id LIMIT ${size} OFFSET ${(page - 1) * size}`)
    return NextResponse.json({ people: people.map(p => {
      const linked = p.standardAreas.filter(a => input.areaIds.includes(a.id)).map(a => a.label)
      const declared = p.areas.filter(label => areas.some(a => a.label.toLowerCase() === label.trim().toLowerCase()))
      const reasons = [linked.length ? `Linked standard areas: ${linked.join(', ')}` : '', declared.length ? `Declared profile areas: ${declared.join(', ')}` : ''].filter(Boolean)
      return { ...p, matchReason: input.kind === 'standard' ? reasons.join(' · ') : null }
    }),
      total, page, totalPages, basis: input.kind === 'person' ? 'identity' : input.kind === 'browse' ? 'directory' : 'standard' })
  } catch {
    return NextResponse.json({ error: 'People search is temporarily unavailable. Please retry.' }, { status: 503 })
  }
}, 'summary', 'FUNDING_DISCOVERY')
