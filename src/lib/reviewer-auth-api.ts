import type { NextApiRequest, NextApiResponse } from 'next'

import { verifyJWT } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { checkServiceAccess } from '@/lib/org-access-service'

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

/**
 * Enforces the GRANT_REVIEW module (Pro tier) for the reviewer surface. Call
 * this after `requireReviewerSession` in reviewer API routes. Super admins and
 * platform-scope users bypass tenant feature gates. Returns true when access is
 * allowed; otherwise writes a 403 and returns false.
 */
export async function requireGrantReviewFeature(
  session: SessionLike,
  res: NextApiResponse
): Promise<boolean> {
  const roles = session.user.roles || []
  if (roles.includes('SUPER_ADMIN') || roles.includes('SUPER_ADMIN_VIEWER')) {
    return true
  }

  const tenantId = session.user.tenantId
  if (!tenantId) {
    res.status(403).json({ error: 'A tenant-scoped account is required', code: 'TENANT_REQUIRED' })
    return false
  }

  const access = await checkServiceAccess(session.user.id, tenantId, 'GRANT_REVIEW')
  if (!access.allowed) {
    res.status(403).json({
      error: access.reason || 'AI grant review is not included in your plan',
      code: 'SERVICE_ACCESS_DENIED',
    })
    return false
  }

  return true
}

export async function requireReviewerCallAccess(
  callId: string,
  session: SessionLike,
  res: NextApiResponse,
  capability: 'read' | 'editContent' = 'read'
) {
  // Hard-enforce the GRANT_REVIEW module before any call-scoped operation.
  if (!(await requireGrantReviewFeature(session, res))) {
    return null
  }

  const call = await prisma.reviewerCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      user_id: true,
      tenantId: true,
      projectId: true,
      grantSessionId: true,
    },
  })

  if (!call) {
    res.status(404).json({ error: 'Call not found' })
    return null
  }

  if (call.user_id === session.user.id) {
    return call
  }

  if (call.projectId && call.tenantId && session.user.tenantId === call.tenantId) {
    try {
      await assertProjectCapability(call.projectId, session.user.id, session.user.tenantId, capability)
      return call
    } catch (error) {
      if (error instanceof ProjectAccessError) {
        res.status(error.status).json({ error: error.message, code: error.code })
        return null
      }
      throw error
    }
  }

  // A workspace opened by the proposal desk belongs to the department, not to
  // the one officer who happened to press the button. A colleague covering the
  // school, a deputy standing in during leave, or the department head must be
  // able to open it — otherwise a review started on Friday is unreachable by
  // whoever is at the desk on Monday.
  //
  // Faculty are deliberately NOT admitted here. They read the frozen snapshot
  // the officer chose to share, through the proposal routes; the live workspace
  // holds the department's working state.
  if (call.tenantId && session.user.tenantId === call.tenantId) {
    const proposal = await prisma.grantProposal.findUnique({
      where: { reviewer_call_id: callId },
      select: { tenant_id: true, org_unit_id: true },
    })
    if (proposal && proposal.tenant_id === session.user.tenantId) {
      const { resolveManagedScope } = await import('@/lib/orgUnits/scope')
      const { canOpenSchoolWork } = await import('@/lib/fundingDept/shared')
      const tenant = await prisma.tenant.findUnique({
        where: { id: proposal.tenant_id },
        select: { org_scope_enforced: true },
      })
      const roles = session.user.roles || []
      const scope = await resolveManagedScope({
        tenantId: proposal.tenant_id,
        userId: session.user.id,
        roles,
        enforceScope: Boolean(tenant?.org_scope_enforced),
      })
      const isTenantAdmin = roles.some((role) => ['OWNER', 'ADMIN', 'CALL_ADMIN'].includes(role))
      if (
        isTenantAdmin ||
        (scope.fundingDept.isMember && canOpenSchoolWork(scope, proposal.org_unit_id))
      ) {
        return call
      }
    }
  }

  res.status(403).json({ error: 'Not authorized to access this call' })
  return null
}
