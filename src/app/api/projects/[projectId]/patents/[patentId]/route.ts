import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { prisma } from '@/lib/prisma'

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Project patent route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
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

    const patent = await prisma.patent.findFirst({
      where: {
        id: params.patentId,
        projectId: params.projectId,
      },
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true, name: true },
    })

    return NextResponse.json({ patent, project })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
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

    const patent = await prisma.patent.findFirst({
      where: {
        id: params.patentId,
        projectId: params.projectId,
      },
      include: {
        draftingSessions: true,
      },
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    for (const session of patent.draftingSessions) {
      await prisma.annexureDraft.deleteMany({ where: { sessionId: session.id } })
      await prisma.diagramSource.deleteMany({ where: { sessionId: session.id } })
      await prisma.figurePlan.deleteMany({ where: { sessionId: session.id } })
      await prisma.referenceMap.deleteMany({ where: { sessionId: session.id } })
      await prisma.ideaRecord.deleteMany({ where: { sessionId: session.id } })
      await prisma.draftingSession.delete({ where: { id: session.id } })
    }

    await prisma.patent.delete({
      where: { id: params.patentId },
    })

    return NextResponse.json({ message: 'Patent deleted successfully' })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}
