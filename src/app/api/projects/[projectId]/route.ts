import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { buildGrantProjectOpenUrl } from '@/lib/grants/workspaceNavigation'
import { prisma } from '@/lib/prisma'

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Project route error:', error)
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

    const access = await assertProjectCapability(params.projectId, user.id, user.tenantId, 'read')

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        applicantProfile: true,
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
        patents: {
          select: {
            id: true,
            title: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        grantSessions: {
          orderBy: {
            updatedAt: 'desc',
          },
          take: 1,
          select: {
            id: true,
            status: true,
            fundingCallId: true,
            updatedAt: true,
          },
        },
        grantPrepSessions: {
          where: {
            status: {
              not: 'archived',
            },
          },
          orderBy: {
            updated_at: 'desc',
          },
          take: 1,
          select: {
            id: true,
            status: true,
            grant_session_id: true,
            funding_call_id: true,
            overall_readiness: true,
            updated_at: true,
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const latestGrantSession = project.grantSessions[0] ?? null
    const latestGrantPrepSession = project.grantPrepSessions[0] ?? null

    return NextResponse.json({
      project: {
        ...project,
        latestGrantSession,
        latestGrantPrepSession,
        grantOpenUrl: project.projectType === 'GRANT'
          ? buildGrantProjectOpenUrl({
              projectId: project.id,
              prepSession: latestGrantPrepSession,
              grantSession: latestGrantSession,
            })
          : null,
        accessLevel: access.accessLevel,
        isOwner: access.isOwner,
      },
    })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}

export async function PATCH(
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

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'renameProject')

    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!name) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
    }

    const updatedProject = await prisma.project.update({
      where: { id: params.projectId },
      data: { name },
      include: {
        applicantProfile: true,
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
        patents: {
          select: {
            id: true,
            title: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
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

export async function DELETE(
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

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'deleteProject')

    await prisma.project.delete({
      where: { id: params.projectId },
    })

    return NextResponse.json({ message: 'Project deleted successfully' })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}
