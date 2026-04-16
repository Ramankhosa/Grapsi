import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const UpsertSchema = z.object({
  provider: z.string().min(1),
  modelClass: z.string().min(1),
  inputPricePerMTokens: z.number().nonnegative(),
  outputPricePerMTokens: z.number().nonnegative(),
  currency: z.string().min(1).default('USD')
})

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()

    const user = await prisma.user.findUnique({
      where: { email: userData.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isSuperAdmin = user.roles?.some(
      (role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER'
    )

    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const prices = await prisma.lLMModelPrice.findMany({
      orderBy: [{ provider: 'asc' }, { modelClass: 'asc' }]
    })

    return NextResponse.json(prices)
  } catch (error) {
    console.error('Model costs GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()

    const user = await prisma.user.findUnique({
      where: { email: userData.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isSuperAdmin = user.roles?.some(
      (role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER'
    )

    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpsertSchema.parse(body)

    const upserted = await prisma.lLMModelPrice.upsert({
      where: {
        provider_modelClass: {
          provider: parsed.provider,
          modelClass: parsed.modelClass
        }
      },
      update: {
        inputPricePerMTokens: parsed.inputPricePerMTokens,
        outputPricePerMTokens: parsed.outputPricePerMTokens,
        currency: parsed.currency
      },
      create: {
        provider: parsed.provider,
        modelClass: parsed.modelClass,
        inputPricePerMTokens: parsed.inputPricePerMTokens,
        outputPricePerMTokens: parsed.outputPricePerMTokens,
        currency: parsed.currency
      }
    })

    return NextResponse.json(upserted, { status: 201 })
  } catch (error) {
    console.error('Model costs POST error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

