import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'

const createSuperAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2)
})

export async function POST(request: NextRequest) {
  try {
    // Check if any Super Admin already exists
    const existingSuperAdmin = await prisma.user.findFirst({
      where: {
        roles: {
          has: 'SUPER_ADMIN'
        }
      }
    })

    if (existingSuperAdmin) {
      return NextResponse.json(
        { message: 'Super Admin already exists. This endpoint is for initial setup only.' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { email, password, name } = createSuperAdminSchema.parse(body)

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { message: 'Email already registered' },
        { status: 400 }
      )
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create Super Admin user (without tenant - platform level)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        roles: ['SUPER_ADMIN'],
        status: 'ACTIVE'
      }
    })

    return NextResponse.json({
      message: 'Super Admin created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        status: user.status
      }
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: 'Invalid input', errors: error.errors },
        { status: 400 }
      )
    }

    console.error('Super Admin creation error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}
