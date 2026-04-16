import { NextRequest, NextResponse } from 'next/server'
import { IdeaBankService } from '@/lib/idea-bank-service'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const ideaBankService = new IdeaBankService()

const sendToDraftingSchema = z.object({
  projectId: z.string().optional()
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

// POST /api/idea-bank/[ideaId]/send-to-drafting - Send idea to drafting pipeline
export async function POST(
  request: NextRequest,
  { params }: { params: { ideaId: string } }
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { projectId } = sendToDraftingSchema.parse(body)

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const draftingSessionId = await ideaBankService.sendToDrafting(requestHeaders, params.ideaId, user, projectId)

    return NextResponse.json({
      success: true,
      draftingSessionId,
      message: 'Idea sent to drafting pipeline'
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }

    console.error('Failed to send idea to drafting:', error)
    return NextResponse.json({
      error: 'Failed to send idea to drafting',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 400 })
  }
}
