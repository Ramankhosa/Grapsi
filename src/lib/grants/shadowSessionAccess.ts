import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'

export interface ShadowSessionUser {
  id: string
  roles?: string[]
  tenantId?: string | null
}

export type ShadowSessionCapability = 'read' | 'editContent'

type DraftingSessionEnvelope = {
  id: string
  userId: string
  tenantId: string | null
  grantSession: {
    projectId: string
    tenantId: string
  } | null
}

async function getDraftingSessionEnvelope(sessionId: string): Promise<DraftingSessionEnvelope | null> {
  return prisma.draftingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      tenantId: true,
      grantSession: {
        select: {
          projectId: true,
          tenantId: true,
        },
      },
    },
  })
}

export async function canAccessDraftingSession(
  sessionId: string,
  user: ShadowSessionUser,
  capability: ShadowSessionCapability = 'read'
): Promise<boolean> {
  const envelope = await getDraftingSessionEnvelope(sessionId)
  if (!envelope) return false

  if (user.roles?.includes('SUPER_ADMIN')) {
    return true
  }

  if (envelope.userId === user.id) {
    return true
  }

  if (!envelope.grantSession) {
    return false
  }

  try {
    await assertProjectCapability(
      envelope.grantSession.projectId,
      user.id,
      user.tenantId ?? envelope.grantSession.tenantId ?? envelope.tenantId,
      capability
    )
    return true
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return false
    }
    throw error
  }
}

export async function getDraftingSessionForUser<T extends Prisma.DraftingSessionFindFirstArgs>(
  sessionId: string,
  user: ShadowSessionUser,
  capability: ShadowSessionCapability,
  args: T
): Promise<Prisma.DraftingSessionGetPayload<T> | null> {
  const allowed = await canAccessDraftingSession(sessionId, user, capability)
  if (!allowed) {
    return null
  }

  const nextArgs = {
    ...args,
    where: {
      ...(args.where || {}),
      id: sessionId,
    },
  } as Prisma.DraftingSessionFindFirstArgs

  return prisma.draftingSession.findFirst(nextArgs) as Promise<Prisma.DraftingSessionGetPayload<T> | null>
}
