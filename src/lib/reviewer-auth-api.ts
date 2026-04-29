import type { NextApiRequest, NextApiResponse } from 'next'

import { verifyJWT } from '@/lib/auth'
import prisma from '@/lib/prisma'

type SessionLike = {
  user: {
    id: string
    email: string | null
    name?: string | null
    tenantId?: string | null
    roles?: string[]
  }
}

function getRequestFromArgs(args: unknown[]): NextApiRequest | null {
  const first = args[0] as { req?: NextApiRequest } | NextApiRequest | undefined
  if (!first) return null
  if ('req' in first && first.req) return first.req
  return first as NextApiRequest
}

export async function getReviewerSession(...args: unknown[]): Promise<SessionLike | null> {
  const req = getRequestFromArgs(args)
  if (!req) return null

  const authHeader = req.headers.authorization
  const token = Array.isArray(authHeader)
    ? authHeader.find((value) => value.startsWith('Bearer '))
    : authHeader

  if (!token || !token.startsWith('Bearer ')) {
    return null
  }

  const payload = verifyJWT(token.slice('Bearer '.length))
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      name: true,
      tenantId: true,
      roles: true,
      status: true,
      tenant: {
        select: { status: true },
      },
    },
  })

  if (!user || user.status !== 'ACTIVE' || (user.tenant && user.tenant.status !== 'ACTIVE')) {
    return null
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      roles: user.roles,
    },
  }
}

export function requireReviewerSession(
  session: SessionLike | null,
  res: NextApiResponse
): session is SessionLike {
  if (session?.user?.id) return true
  res.status(401).json({ error: 'Not authenticated' })
  return false
}
