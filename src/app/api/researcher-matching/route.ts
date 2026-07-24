import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { researcherSearchService } from '@/lib/services/researcherSearchService'
import { prisma } from '@/lib/prisma'

/**
 * Tenant-scoped researcher matching.
 *
 * Available to every authenticated user that belongs to a tenant. Unlike the
 * super-admin variant, all reads and searches are constrained to the caller's
 * own tenant, so a user only ever sees researchers within their organization.
 */
async function requireTenantUser(request: NextRequest) {
  const authResult = await authenticateUser(request)
  if (!authResult.user) {
    return { error: authResult.error!.message, status: authResult.error!.status }
  }
  const tenantId: string | null = authResult.user.tenantId || null
  if (!tenantId) {
    return { error: 'A tenant account is required to use researcher matching.', status: 403 }
  }
  return { user: authResult.user, tenantId }
}

/** Calls this tenant is allowed to see: its own private calls + global published calls. */
function tenantVisibleCallWhere(tenantId: string) {
  return {
    OR: [
      { tenantId },
      { tenantId: null, visibility: 'GLOBAL_PUBLISHED' as const, status: 'PUBLISHED' as const },
    ],
  }
}

/**
 * GET — tenant stats (?action=stats) or the tenant-visible funding call list (?q=).
 */
export async function GET(request: NextRequest) {
  const auth = await requireTenantUser(request)
  if ('error' in auth) {
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

    const fundingCalls = await prisma.fundingCall.count({ where: tenantVisibleCallWhere(tenantId) })

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
      prisma.$queryRaw<Array<{ careerStage: string | null; institutionType: string | null; country: string | null }>>`
        SELECT DISTINCT
          rp.career_stage AS "careerStage",
          rp.institution_type AS "institutionType",
          rp.country_of_residence AS "country"
        FROM researcher_profiles rp
        JOIN users u ON u.id = rp.user_id
        WHERE u."tenantId" = ${tenantId}
      `,
    ])

    const departmentsBySchool = new Map<string, Array<{ id: string; name: string }>>()
    for (const unit of units) {
      if (unit.kind !== 'DEPARTMENT' || !unit.parent_id) continue
      const list = departmentsBySchool.get(unit.parent_id) || []
      list.push({ id: unit.id, name: unit.name })
      departmentsBySchool.set(unit.parent_id, list)
    }

    const schools = units
      .filter((unit) => unit.kind === 'SCHOOL')
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        departments: departmentsBySchool.get(unit.id) || [],
      }))

    const distinct = (key: 'careerStage' | 'institutionType' | 'country') =>
      Array.from(
        new Set(attributes.map((row) => (row[key] || '').trim()).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right))

    return NextResponse.json({
      schools,
      careerStages: distinct('careerStage'),
      institutionTypes: distinct('institutionType'),
      countries: distinct('country'),
    })
  }

  // Default: list funding calls visible to this tenant for the dropdown
  const q = searchParams.get('q') || ''
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)

  const where: any = tenantVisibleCallWhere(tenantId)
  if (q) {
    where.AND = [
      {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { scheme_title: { contains: q, mode: 'insensitive' } },
          { agencyName: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
    ]
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
  const auth = await requireTenantUser(request)
  if ('error' in auth) {
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
      where: { AND: [{ id: fundingCallId }, tenantVisibleCallWhere(tenantId)] },
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
      orgUnitIds: stringList(requested.orgUnitIds),
      researchAreas: stringList(requested.researchAreas),
      countries: stringList(requested.countries),
      institutionTypes: stringList(requested.institutionTypes),
      careerStages: stringList(requested.careerStages),
      includeBelowThreshold: requested.includeBelowThreshold === true,
      // Tenant scope is enforced here and can never be widened by the client.
      tenantOnly: true,
      includeSelf: true,
    },
  })

  return NextResponse.json(results)
}
