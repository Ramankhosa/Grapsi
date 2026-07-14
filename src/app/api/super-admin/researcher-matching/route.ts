import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { researcherSearchService } from '@/lib/services/researcherSearchService'
import { prisma } from '@/lib/prisma'

async function verifySuperAdmin(request: NextRequest) {
  const authResult = await authenticateUser(request)
  if (!authResult.user) {
    return { error: authResult.error!.message, status: authResult.error!.status }
  }

  const isSuperAdmin = authResult.user.roles?.some(
    (role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER'
  )

  if (!isSuperAdmin) {
    return { error: 'Super admin access required', status: 403 }
  }

  return { user: authResult.user }
}

/**
 * GET — list funding calls for the search dropdown
 */
export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'stats') {
    const [profileCount, areaCount, pubCount, callCount] = await Promise.all([
      prisma.researcherProfile.count(),
      prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM researcher_saved_research_areas`,
      prisma.referenceLibrary.count({ where: { tags: { has: 'my-publication' }, isActive: true } }),
      prisma.fundingCall.count({ where: { status: 'PUBLISHED' } }),
    ])

    const [profilesWithEmbedding, areasWithEmbedding, pubsWithEmbedding] = await Promise.all([
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM researcher_profiles
        WHERE embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM researcher_saved_research_areas
        WHERE embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM reference_library
        WHERE 'my-publication' = ANY(tags) AND "isActive" = true
          AND (funding_embedding IS NOT NULL OR funding_embedding_voyage_1024 IS NOT NULL)
      `,
    ])

    return NextResponse.json({
      researchers: Number(profileCount),
      researchersWithEmbedding: Number(profilesWithEmbedding[0].count),
      researchAreas: Number(areaCount[0].count),
      researchAreasWithEmbedding: Number(areasWithEmbedding[0].count),
      publications: Number(pubCount),
      publicationsWithEmbedding: Number(pubsWithEmbedding[0].count),
      fundingCalls: Number(callCount),
    })
  }

  // Default: list published funding calls for the dropdown
  const q = searchParams.get('q') || ''
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)

  const where: any = { status: 'PUBLISHED' }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { scheme_title: { contains: q, mode: 'insensitive' } },
      { agencyName: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
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
 * POST — search researchers matching a funding call or free-text query
 */
export async function POST(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const { fundingCallId, query, limit } = body

  if (!fundingCallId && !query) {
    return NextResponse.json(
      { error: 'Provide fundingCallId or query' },
      { status: 400 }
    )
  }

  const results = await researcherSearchService.search({
    fundingCallId: fundingCallId || null,
    query: query || null,
    limit: Math.min(Number(limit) || 50, 50),
    filters: { includeSelf: true },
  })

  return NextResponse.json(results)
}
