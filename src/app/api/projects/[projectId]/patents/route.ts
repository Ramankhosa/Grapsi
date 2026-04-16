import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { prisma } from '@/lib/prisma'

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Project patents route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'read')

    const patents = await prisma.patent.findMany({
      where: { projectId: params.projectId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ patents })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'editContent')

    const body = await request.json()
    const title = typeof body.title === 'string' ? body.title.trim() : ''

    if (!title) {
      return NextResponse.json({ error: 'Patent title is required' }, { status: 400 })
    }

    const patent = await prisma.patent.create({
      data: {
        title,
        projectId: params.projectId,
        createdBy: user.id,
      },
    })

    return NextResponse.json({ patent }, { status: 201 })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}
