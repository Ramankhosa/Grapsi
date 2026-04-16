import { NextRequest, NextResponse } from 'next/server'
import { IdeaBankService } from '@/lib/idea-bank-service'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { enforceServiceAccess } from '@/lib/service-access-middleware'

const ideaBankService = new IdeaBankService()

// Search ideas schema
const searchSchema = z.object({
  query: z.string().optional(),
  domainTags: z.array(z.string()).optional(),
  technicalField: z.string().optional(),
  status: z.enum(['PUBLIC', 'RESERVED', 'LICENSED', 'ARCHIVED']).optional(),
  noveltyScoreMin: z.number().min(0).max(1).optional(),
  noveltyScoreMax: z.number().min(0).max(1).optional(),
  createdBy: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20)
})

// Create idea schema
const createIdeaSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required'),
  abstract: z.string().optional(),
  domainTags: z.array(z.string()).min(1, 'At least one domain tag is required'),
  technicalField: z.string().optional(),
  keyFeatures: z.array(z.string()).default([]),
  potentialApplications: z.array(z.string()).default([]),
  derivedFromIdeaId: z.string().optional()
})

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload || !payload.sub) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, tenantId: true }
  })

  return user
}

// GET /api/idea-bank - Search and list ideas
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check organizational service access (Tenant Admin controlled)
    if (user.tenantId) {
      const serviceCheck = await enforceServiceAccess(user.id, user.tenantId, 'IDEA_BANK')
      if (!serviceCheck.allowed) {
        return serviceCheck.response
      }
    }

    const url = new URL(request.url)
    const searchParams = Object.fromEntries(url.searchParams)

    // Parse filters
    const filters = searchSchema.parse({
      query: searchParams.query,
      domainTags: searchParams.domainTags ? searchParams.domainTags.split(',') : undefined,
      technicalField: searchParams.technicalField,
      status: searchParams.status,
      noveltyScoreMin: searchParams.noveltyScoreMin ? parseFloat(searchParams.noveltyScoreMin) : undefined,
      noveltyScoreMax: searchParams.noveltyScoreMax ? parseFloat(searchParams.noveltyScoreMax) : undefined,
      createdBy: searchParams.createdBy,
      page: searchParams.page ? parseInt(searchParams.page) : 1,
      limit: searchParams.limit ? parseInt(searchParams.limit) : 20
    })


    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const result = await ideaBankService.searchIdeas(requestHeaders, filters, user, filters.page, filters.limit)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }

    console.error('Failed to search ideas:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// POST /api/idea-bank - Create new idea
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check organizational service access (Tenant Admin controlled)
    if (user.tenantId) {
      const serviceCheck = await enforceServiceAccess(user.id, user.tenantId, 'IDEA_BANK')
      if (!serviceCheck.allowed) {
        return serviceCheck.response
      }
    }

    const body = await request.json()
    const ideaData = createIdeaSchema.parse(body)

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const idea = await ideaBankService.createIdea(undefined, ideaData, user)

    return NextResponse.json({ idea }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }

    console.error('Failed to create idea:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
