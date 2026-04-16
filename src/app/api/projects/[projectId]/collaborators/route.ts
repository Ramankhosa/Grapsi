import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { prisma } from '@/lib/prisma'

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Collaborator route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

function normalizeCollaboratorRole(role?: string): 'collaborator' | 'viewer' {
  return role === 'viewer' ? 'viewer' : 'collaborator'
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

    const access = await assertProjectCapability(params.projectId, user.id, user.tenantId, 'manageCollaborators')

    const body = await request.json()
    const rawUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const collaboratorRole = normalizeCollaboratorRole(typeof body.role === 'string' ? body.role.trim() : undefined)

    if (!rawUserId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const userToAdd = await prisma.user.findFirst({
      where: {
        OR: [{ id: rawUserId }, { email: rawUserId }],
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
      },
    })

    if (!userToAdd) {
      return NextResponse.json(
        { error: 'User not found. Please enter a valid user ID or email address.' },
        { status: 404 }
      )
    }

    if (!userToAdd.tenantId || userToAdd.tenantId !== access.tenantId) {
      return NextResponse.json(
        { error: 'Collaborators must belong to the same tenant as the project' },
        { status: 403 }
      )
    }

    if (userToAdd.id === access.ownerUserId) {
      return NextResponse.json({ error: 'Project owner cannot be added as a collaborator' }, { status: 400 })
    }

    const existingCollaborator = await prisma.projectCollaborator.findFirst({
      where: {
        projectId: params.projectId,
        userId: userToAdd.id,
      },
    })

    if (existingCollaborator) {
      return NextResponse.json({ error: 'User is already a collaborator on this project' }, { status: 400 })
    }

    await prisma.projectCollaborator.create({
      data: {
        projectId: params.projectId,
        userId: userToAdd.id,
        role: collaboratorRole,
        addedBy: user.id,
      },
    })

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
