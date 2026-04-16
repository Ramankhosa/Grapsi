import { prisma } from '@/lib/prisma'
import type { ProjectCapability, ProjectAccessCapabilities, ProjectAccessLevel } from '@/types/project-access'

export class ProjectAccessError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export interface ResolvedProjectAccess {
  projectId: string
  tenantId: string
  ownerUserId: string
  isOwner: boolean
  collaborator: {
    id: string
    userId: string
    role: string
    addedBy: string
  } | null
  accessLevel: ProjectAccessLevel
  capabilities: ProjectAccessCapabilities
}

function mapCollaboratorRoleToAccessLevel(role?: string | null): ProjectAccessLevel | null {
  if (!role) return null

  switch (role) {
    case 'viewer':
      return 'viewer'
    case 'collaborator':
    case 'editor':
      return 'editor'
    default:
      return 'viewer'
  }
}

function buildCapabilities(accessLevel: ProjectAccessLevel): ProjectAccessCapabilities {
  return {
    read: true,
    editContent: accessLevel === 'owner' || accessLevel === 'editor',
    renameProject: accessLevel === 'owner',
    deleteProject: accessLevel === 'owner',
    manageCollaborators: accessLevel === 'owner',
  }
}

export function canAccessCapability(
  access: Pick<ResolvedProjectAccess, 'capabilities'>,
  capability: ProjectCapability
): boolean {
  return access.capabilities[capability]
}

export async function resolveProjectAccess(
  projectId: string,
  userId: string,
  tenantId?: string | null
): Promise<ResolvedProjectAccess | null> {
  if (!tenantId) {
    return null
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      collaborators: {
        where: { userId },
        select: {
          id: true,
          userId: true,
          role: true,
          addedBy: true,
        },
        take: 1,
      },
    },
  })

  if (!project || project.tenantId !== tenantId) {
    return null
  }

  const isOwner = project.userId === userId
  const collaborator = project.collaborators[0] ?? null
  const accessLevel = isOwner ? 'owner' : mapCollaboratorRoleToAccessLevel(collaborator?.role)

  if (!accessLevel) {
    return null
  }

  return {
    projectId: project.id,
    tenantId: project.tenantId,
    ownerUserId: project.userId,
    isOwner,
    collaborator,
    accessLevel,
    capabilities: buildCapabilities(accessLevel),
  }
}

export async function assertProjectCapability(
  projectId: string,
  userId: string,
  tenantId: string | null | undefined,
  capability: ProjectCapability
): Promise<ResolvedProjectAccess> {
  const access = await resolveProjectAccess(projectId, userId, tenantId)

  if (!access) {
    throw new ProjectAccessError('Project not found or access denied', 404, 'PROJECT_ACCESS_DENIED')
  }

  if (!canAccessCapability(access, capability)) {
    throw new ProjectAccessError('Insufficient project permissions', 403, 'PROJECT_CAPABILITY_DENIED')
  }

  return access
}

export async function listAccessibleProjects(userId: string, tenantId?: string | null) {
  if (!tenantId) {
    return []
  }

  const projects = await prisma.project.findMany({
    where: {
      tenantId,
      OR: [
        { userId },
        { collaborators: { some: { userId } } },
      ],
    },
    include: {
      patents: {
        select: {
          id: true,
          title: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          patents: true,
          collaborators: true,
        },
      },
      applicantProfile: {
        select: {
          id: true,
          applicantLegalName: true,
        },
      },
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
    orderBy: {
      updatedAt: 'desc',
    },
  })

  return projects.map((project) => {
    const isOwner = project.userId === userId
    const collaborator = project.collaborators.find((entry) => entry.userId === userId) ?? null
    const accessLevel = isOwner ? 'owner' : (mapCollaboratorRoleToAccessLevel(collaborator?.role) ?? 'viewer')

    return {
      ...project,
      accessLevel,
      isOwner,
    }
  })
}
