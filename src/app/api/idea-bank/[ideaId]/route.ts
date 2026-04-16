import { NextRequest, NextResponse } from 'next/server'
import { IdeaBankService } from '@/lib/idea-bank-service'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const ideaBankService = new IdeaBankService()

// Clone and edit schema
const cloneEditSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long').optional(),
  description: z.string().min(1, 'Description is required').optional(),
  abstract: z.string().optional(),
  domainTags: z.array(z.string()).optional(),
  technicalField: z.string().optional(),
  keyFeatures: z.array(z.string()).optional(),
  potentialApplications: z.array(z.string()).optional()
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

// GET /api/idea-bank/[ideaId] - Get idea details
export async function GET(
  request: NextRequest,
  { params }: { params: { ideaId: string } }
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const idea = await ideaBankService.getIdeaById(requestHeaders, params.ideaId, user)

    if (!idea) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
    }

    return NextResponse.json({ idea })
  } catch (error) {
    console.error('Failed to get idea:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// PATCH /api/idea-bank/[ideaId] - Clone and edit idea
export async function PATCH(
  request: NextRequest,
  { params }: { params: { ideaId: string } }
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const editData = cloneEditSchema.parse(body)

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const newIdea = await ideaBankService.cloneAndEditIdea(undefined, params.ideaId, editData, user)

    return NextResponse.json({ idea: newIdea }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }

    console.error('Failed to clone and edit idea:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
