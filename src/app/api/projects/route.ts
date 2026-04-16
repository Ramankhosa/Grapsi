import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { authenticateUser } from '@/lib/auth-middleware'
import { listAccessibleProjects } from '@/lib/project-access'
import { prisma } from '@/lib/prisma'

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(200, 'Project name too long'),
})

const allowedRoles = ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    const projects = await listAccessibleProjects(user.id, user.tenantId)
    return NextResponse.json({ projects })
  } catch (error) {
    console.error('Failed to fetch projects:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    if (!user.tenantId) {
      return NextResponse.json(
        { error: 'A tenant-scoped account is required to create projects', code: 'TENANT_REQUIRED' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name } = createProjectSchema.parse(body)

    const hasPermission = user.roles?.some((role: string) => allowedRoles.includes(role))
    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const project = await prisma.project.create({
      data: {
        name,
        userId: user.id,
        tenantId: user.tenantId,
      },
    })

    return NextResponse.json(
      {
        project: {
          ...project,
          accessLevel: 'owner',
          isOwner: true,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }

    console.error('Failed to create project:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
