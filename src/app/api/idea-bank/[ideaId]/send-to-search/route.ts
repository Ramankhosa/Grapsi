import { NextRequest, NextResponse } from 'next/server'
import { IdeaBankService } from '@/lib/idea-bank-service'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ideaBankService = new IdeaBankService()

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

// POST /api/idea-bank/[ideaId]/send-to-search - Send idea to novelty search
export async function POST(
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

    const searchRunId = await ideaBankService.sendToNoveltySearch(requestHeaders, params.ideaId, user)

    return NextResponse.json({
      success: true,
      searchRunId,
      message: 'Idea sent to novelty search pipeline'
    })
  } catch (error) {
    console.error('Failed to send idea to novelty search:', error)
    return NextResponse.json({
      error: 'Failed to send idea to novelty search',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 400 })
  }
}
