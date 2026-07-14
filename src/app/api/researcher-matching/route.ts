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
  const { fundingCallId, query, limit } = body

  if (!fundingCallId && !query) {
    return NextResponse.json({ error: 'Provide fundingCallId or query' }, { status: 400 })
  }

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
    filters: { tenantOnly: true, includeSelf: true },
  })

  return NextResponse.json(results)
}
