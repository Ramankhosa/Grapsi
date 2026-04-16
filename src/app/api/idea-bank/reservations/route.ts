import { NextRequest, NextResponse } from 'next/server'
import { IdeaBankService } from '@/lib/idea-bank-service'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ideaBankService = new IdeaBankService()

// Force dynamic rendering since we access request headers
export const dynamic = 'force-dynamic'

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

// GET /api/idea-bank/reservations - Get user's active reservations
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const reservations = await ideaBankService.getUserReservations(requestHeaders, user)

    return NextResponse.json({ reservations })
  } catch (error) {
    console.error('Failed to get user reservations:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
