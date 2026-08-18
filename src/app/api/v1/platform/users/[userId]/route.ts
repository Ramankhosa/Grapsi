import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, requirePlatformScope } from '@/lib/middleware'
import { setUserRoles, setUserStatus } from '@/lib/platform-user-service'
import { resendActivation } from '@/lib/user-provisioning'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Per-user platform actions: set roles, suspend/reactivate, reissue the
 * set-password link.
 *
 * This is the only path that can grant or revoke SUPER_ADMIN. The tenant-side
 * role helpers refuse those roles outright and reject any actor from a
 * different tenant, which is correct for a tenant admin and leaves platform
 * staff with no way to manage themselves — see `platform-user-service` for the
 * three invariants that replace the tenant hierarchy checks here.
 *
 * `requirePlatformScope` gates every non-GET method to a full SUPER_ADMIN, so
 * SUPER_ADMIN_VIEWER can read the directory but reach none of this.
 */

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_roles'),
    // The complete intended role array, not a delta — the editor sends primary
    // plus tags together so nothing is dropped as a side effect.
    roles: z.array(z.string().min(1)).min(1).max(6)
  }),
  z.object({
    action: z.literal('set_status'),
    status: z.enum(['ACTIVE', 'SUSPENDED'])
  }),
  z.object({
    action: z.literal('resend_activation'),
    send_email: z.boolean().default(true)
  })
])

export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const { user: authUser } = await authenticateRequest(request)
    const body = patchSchema.parse(await request.json())
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    if (body.action === 'set_roles') {
      const result = await setUserRoles({
        actorUserId: authUser!.sub,
        targetUserId: params.userId,
        roles: body.roles as UserRole[],
        ip
      })

      if (!result.ok) {
        return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
      }

      return NextResponse.json({
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          roles: result.user.roles,
          previous_roles: result.user.previousRoles
        },
        platform_tenant_attached: result.tenantAttached
      })
    }

    if (body.action === 'set_status') {
      const result = await setUserStatus({
        actorUserId: authUser!.sub,
        targetUserId: params.userId,
        status: body.status,
        ip
      })

      if (!result.ok) {
        return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
      }

      return NextResponse.json({ user: result.user })
    }

    const result = await resendActivation({
      targetUserId: params.userId,
      actorUserId: authUser!.sub,
      sendEmail: body.send_email,
      ip
    })

    if (!result.ok) {
      return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
    }

    return NextResponse.json({
      activation_link: result.activationLink,
      activation_expires_at: result.activationExpiresAt.toISOString(),
      activation_email_sent: result.activationEmailSent,
      activation_email_error: result.activationEmailError
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: error.errors[0]?.message || 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Platform user update error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
