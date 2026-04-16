import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { prisma } from '@/lib/prisma'

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Collaborator delete route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; collaboratorId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'manageCollaborators')

    const result = await prisma.projectCollaborator.deleteMany({
      where: {
        id: params.collaboratorId,
        projectId: params.projectId,
      },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: 'Collaborator not found' }, { status: 404 })
    }

    const updatedProject = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        collaborators: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    })

    return NextResponse.json({
      project: {
        ...updatedProject,
        accessLevel: 'owner',
        isOwner: true,
      },
    })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}
