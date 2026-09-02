import { NextRequest, NextResponse } from 'next/server'
import { researcherSearchService } from '@/lib/services/researcherSearchService'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope, type TenantScopeContext } from '@/lib/auth/tenantAccess'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { intersectRequestedUnits } from '@/lib/orgUnits/scope'

/**
 * Tenant-scoped researcher matching.
 *
 * This is an assigner's tool: it surfaces other people's research summaries,
 * areas and publication evidence, so it is limited to callers who can act on
 * the answer — tenant-wide admins, org-unit heads, and funding-department
 * members with coverage. Everything a non-tenant-wide caller sees is clamped
 * to the schools they manage, mirroring the assignment fence in
 * `canAssignToUser`: discovery and assignment must draw the same boundary.
 */
async function requireMatchingAccess(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return context
  }
  const { scope } = context
  if (!scope.isTenantWide && !scope.canAssign && !scope.canViewReports) {
    return {
      error: 'Researcher matching is available to funding-department members and administrators.',
      status: 403,
    }
  }
  return context
}

/** The org-unit filter a caller is allowed to search within. */
function scopedOrgUnitIds(context: TenantScopeContext, requested: string[] | undefined) {
  const clamped = intersectRequestedUnits(context.scope, requested ?? [])
  if (context.scope.isTenantWide) {
    // Tenant-wide callers keep whatever they asked for (possibly nothing).
    return clamped.length > 0 ? clamped : undefined
  }
  // Scoped callers always get a predicate. An out-of-reach request intersects
  // to [], which must stay an impossible filter rather than widen to "all".
  return clamped.length > 0 ? clamped : ['__none__']
}

/**
 * Calls this tenant is allowed to match against — the canonical published-only
 * predicate. Tenant-wide admins also see the tenant's drafts, so they can
 * preview who a call would reach before publishing it.
 */
function tenantVisibleCallWhere(context: TenantScopeContext) {
  return visibleFundingCallWhere(context.tenantId, {
    includeTenantDrafts: context.scope.isTenantWide,
  })
}

/**
 * GET — tenant stats (?action=stats) or the tenant-visible funding call list (?q=).
 */
export async function GET(request: NextRequest) {
  const auth = await requireMatchingAccess(request)
  if (isAccessError(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { tenantId } = auth

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'stats') {
    const [researchers, researchersWithEmbedding, researchAreas, publications, publicationsWithEmbedding] =
      await Promise.all([
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM researcher_profiles rp
          JOIN users u ON u.id = rp.user_id
          WHERE u."tenantId" = ${tenantId}
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM researcher_profiles rp
          JOIN users u ON u.id = rp.user_id
          WHERE u."tenantId" = ${tenantId}
            AND (rp.embedding IS NOT NULL OR rp.embedding_voyage_1024 IS NOT NULL)
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM researcher_saved_research_areas a
          JOIN users u ON u.id = a.user_id
          WHERE u."tenantId" = ${tenantId}
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM reference_library ref
          JOIN users u ON u.id = ref.user_id
          WHERE u."tenantId" = ${tenantId}
            AND 'my-publication' = ANY(ref.tags) AND ref."isActive" = true
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM reference_library ref
          JOIN users u ON u.id = ref.user_id
          WHERE u."tenantId" = ${tenantId}
            AND 'my-publication' = ANY(ref.tags) AND ref."isActive" = true
            AND (ref.funding_embedding IS NOT NULL OR ref.funding_embedding_voyage_1024 IS NOT NULL)
        `,
      ])

    const fundingCalls = await prisma.fundingCall.count({ where: tenantVisibleCallWhere(auth) })

    return NextResponse.json({
      researchers: Number(researchers[0].count),
      researchersWithEmbedding: Number(researchersWithEmbedding[0].count),
      researchAreas: Number(researchAreas[0].count),
      publications: Number(publications[0].count),
      publicationsWithEmbedding: Number(publicationsWithEmbedding[0].count),
      fundingCalls,
    })
  }

  // Filter facets: the tenant's School -> Department tree plus the distinct
  // profile attributes actually present, so the UI never offers a dead filter.
  if (action === 'facets') {
    const [units, attributes] = await Promise.all([
      prisma.tenantOrgUnit.findMany({
        where: { tenant_id: tenantId, is_active: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, kind: true, parent_id: true },
      }),
      prisma.$queryRaw<
        Array<{
          careerStage: string | null
          institutionType: string | null
          country: string | null
          designation: string | null
        }>
      >`
        SELECT DISTINCT
          rp.career_stage AS "careerStage",
          rp.institution_type AS "institutionType",
          rp.country_of_residence AS "country",
          rp.designation
        FROM researcher_profiles rp
        JOIN users u ON u.id = rp.user_id
        WHERE u."tenantId" = ${tenantId}
      `,
    ])

    // A scoped caller's facet tree only shows the units they manage — offering
    // a school outside their reach would be a filter that silently returns
    // nothing (POST clamps it to an impossible predicate).
    const managed = new Set(auth.scope.managedUnitIds)
    const visibleUnits = auth.scope.isTenantWide
      ? units
      : units.filter((unit) => managed.has(unit.id))

    const departmentsBySchool = new Map<string, Array<{ id: string; name: string }>>()
    for (const unit of visibleUnits) {
      if (unit.kind !== 'DEPARTMENT' || !unit.parent_id) continue
      const list = departmentsBySchool.get(unit.parent_id) || []
      list.push({ id: unit.id, name: unit.name })
      departmentsBySchool.set(unit.parent_id, list)
    }

    const schools = visibleUnits
      .filter((unit) => unit.kind === 'SCHOOL')
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        departments: departmentsBySchool.get(unit.id) || [],
      }))

    const distinct = (key: 'careerStage' | 'institutionType' | 'country' | 'designation') =>
      Array.from(
        new Set(attributes.map((row) => (row[key] || '').trim()).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right))

    // Agencies and disciplines of the calls this caller can match against, so
    // the call picker can be narrowed the same way the people list can.
    const callRows = await prisma.fundingCall.findMany({
      where: tenantVisibleCallWhere(auth),
      select: { agencyName: true, agency_name: true, disciplines: true, funding_kinds: true },
    })
    const sortedUnique = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right)
      )

    return NextResponse.json({
      schools,
      careerStages: distinct('careerStage'),
      institutionTypes: distinct('institutionType'),
      countries: distinct('country'),
      designations: distinct('designation'),
      callAgencies: sortedUnique(callRows.map((row) => row.agency_name || row.agencyName)),
      callDisciplines: sortedUnique(callRows.flatMap((row) => row.disciplines)),
      callFundingKinds: sortedUnique(callRows.flatMap((row) => row.funding_kinds)),
    })
  }

  // One researcher's stored profile — powers "View profile" beside Assign.
  // Same fence as discovery: a scoped caller can only open profiles inside
  // their managed schools, mirroring who they could assign to.
  if (action === 'profile') {
    const userId = (searchParams.get('userId') || '').trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    const managed = auth.scope.managedUnitIds
    const profile = await prisma.researcherProfile.findFirst({
      where: {
        user_id: userId,
        user: { tenantId },
        ...(auth.scope.isTenantWide
          ? {}
          : { org_unit_id: { in: managed.length > 0 ? managed : ['__none__'] } }),
      },
      select: {
        user: { select: { id: true, name: true, email: true } },
        display_name: true,
        employee_id: true,
        designation: true,
        school: true,
        department: true,
        institution_name: true,
        career_stage: true,
        years_of_experience: true,
        country_of_residence: true,
        application_languages: true,
        research_summary: true,
        research_areas: true,
        keywords: true,
        linkedin_url: true,
        google_scholar_url: true,
        scopus_url: true,
        orcid_url: true,
      },
    })
    if (!profile) {
      return NextResponse.json(
        { error: 'Researcher not found or outside your schools.' },
        { status: 404 }
      )
    }

    const publications = await prisma.referenceLibrary.findMany({
      where: { userId, isActive: true, tags: { has: 'my-publication' } },
      select: { id: true, title: true, authors: true, year: true, venue: true, doi: true, url: true },
      orderBy: [{ year: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 25,
    })

    return NextResponse.json({
      profile: {
        userId: profile.user.id,
        name: profile.display_name || profile.user.name || profile.user.email,
        email: profile.user.email,
        employeeId: profile.employee_id,
        designation: profile.designation,
        school: profile.school,
        department: profile.department,
        institution: profile.institution_name,
        careerStage: profile.career_stage,
        yearsOfExperience: profile.years_of_experience,
        country: profile.country_of_residence,
        languages: profile.application_languages,
        summary: profile.research_summary,
        researchAreas: profile.research_areas,
        keywords: profile.keywords,
        links: {
          googleScholar: profile.google_scholar_url,
          scopus: profile.scopus_url,
          orcid: profile.orcid_url,
          linkedin: profile.linkedin_url,
        },
        publications: publications.map((p) => ({
          id: p.id,
          title: p.title,
          authors: p.authors,
          year: p.year,
          venue: p.venue,
          doi: p.doi,
          url: p.url,
        })),
      },
    })
  }

  // Default: list funding calls visible to this tenant for the dropdown.
  // ?callId= resolves one specific call — the deep link the DSR dashboards use
  // for "find faculty for this call".
  const callId = (searchParams.get('callId') || '').trim()
  const q = searchParams.get('q') || ''
  const callAgency = (searchParams.get('agency') || '').trim()
  const callDiscipline = (searchParams.get('discipline') || '').trim()
  const callFundingKind = (searchParams.get('fundingKind') || '').trim()
  const closingInDays = Number(searchParams.get('closingInDays')) || 0
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)

  const where: any = callId
    ? { AND: [{ id: callId }, tenantVisibleCallWhere(auth)] }
    : tenantVisibleCallWhere(auth)
  if (!callId) {
    // A resolved ?callId= is a deep link to one specific call, so the browse
    // filters below only apply to the list form.
    const callFilters: any[] = []
    if (q) {
      callFilters.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { scheme_title: { contains: q, mode: 'insensitive' } },
          { agencyName: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      })
    }
    if (callAgency) {
      callFilters.push({
        OR: [
          { agency_name: { equals: callAgency, mode: 'insensitive' } },
          { agencyName: { equals: callAgency, mode: 'insensitive' } },
        ],
      })
    }
    if (callDiscipline) {
      callFilters.push({ disciplines: { has: callDiscipline } })
    }
    if (callFundingKind) {
      callFilters.push({ funding_kinds: { has: callFundingKind } })
    }
    if (closingInDays > 0) {
      const now = new Date()
      const until = new Date(now.getTime() + closingInDays * 24 * 60 * 60 * 1000)
      callFilters.push({ close_date: { gte: now, lte: until } })
    }
    if (callFilters.length > 0) {
      where.AND = callFilters
    }
  }

  const rows = await prisma.fundingCall.findMany({
    where,
    select: {
      id: true,
      title: true,
      scheme_title: true,
      agencyName: true,
      description: true,
      close_date: true,
      disciplines: true,
      funding_kinds: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })

  const calls = rows.map((c) => ({
    id: c.id,
    schemeTitle: c.scheme_title || c.title,
    agencyName: c.agencyName,
    description: c.description,
    closeDate: c.close_date,
    disciplines: c.disciplines,
    fundingKinds: c.funding_kinds,
  }))

  return NextResponse.json({ calls })
}

/**
 * POST — search researchers within the caller's tenant, by funding call or free text.
 */
export async function POST(request: NextRequest) {
  const auth = await requireMatchingAccess(request)
  if (isAccessError(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { user, tenantId } = auth

  const body = await request.json()
  const { fundingCallId, query, limit, filters } = body

  if (!fundingCallId && !query) {
    return NextResponse.json({ error: 'Provide fundingCallId or query' }, { status: 400 })
  }

  // Client-supplied facets are sanitised into plain string arrays. Passing an
  // org unit from another tenant is harmless: the search is already constrained
  // to this tenant, so a foreign id simply matches nothing.
  const requested = filters && typeof filters === 'object' ? filters : {}
  const stringList = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, 50)
      : undefined

  // Only allow matching against a call this tenant is permitted to see.
  if (fundingCallId) {
    const visible = await prisma.fundingCall.findFirst({
      where: { AND: [{ id: fundingCallId }, tenantVisibleCallWhere(auth)] },
      select: { id: true },
    })
    if (!visible) {
      return NextResponse.json({ error: 'Funding call not found or not accessible.' }, { status: 404 })
    }
  }

  const results = await researcherSearchService.search({
    fundingCallId: fundingCallId || null,
    query: query || null,
    limit: Math.min(Number(limit) || 20, 50),
    requesterUserId: user.id,
    requesterTenantId: tenantId,
    filters: {
      // Clamped to the caller's managed units for scoped callers: discovery
      // may never reach further than assignment does.
      orgUnitIds: scopedOrgUnitIds(auth, stringList(requested.orgUnitIds)),
      researchAreas: stringList(requested.researchAreas),
      countries: stringList(requested.countries),
      institutionTypes: stringList(requested.institutionTypes),
      careerStages: stringList(requested.careerStages),
      designations: stringList(requested.designations),
      person: typeof requested.person === 'string' ? requested.person.trim().slice(0, 120) : null,
      includeBelowThreshold: requested.includeBelowThreshold === true,
      // Tenant scope is enforced here and can never be widened by the client.
      tenantOnly: true,
      includeSelf: true,
    },
  })

  return NextResponse.json(results)
}
