import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, requirePlatformScope } from '@/lib/middleware'
import { setUserRoles, setUserStatus } from '@/lib/platform-user-service'
import { resendActivation } from '@/lib/user-provisioning'
import { issuePasswordReset, requirePasswordChange, setTemporaryPassword } from '@/lib/admin-password-reset'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Per-user platform actions: set roles, suspend/reactivate, reissue the
 * set-password link, and the password-recovery trio for people who cannot get
 * back in on their own (reset link, temporary password, force a change).
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
  }),
  // The three password-recovery actions below are for accounts that cannot
  // self-serve — see `admin-password-reset` for why each exists.
  z.object({
    action: z.literal('send_password_reset'),
    send_email: z.boolean().default(true)
  }),
  z.object({
    action: z.literal('set_temporary_password'),
    // Omitted means "generate one". An empty string is the same thing, since
    // that is what an untouched input posts.
    password: z.string().max(200).optional().nullable(),
    require_change: z.boolean().default(true)
  }),
  z.object({
    action: z.literal('require_password_change'),
    required: z.boolean().default(true),
    revoke_sessions: z.boolean().default(true)
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

    if (body.action === 'send_password_reset') {
      const result = await issuePasswordReset({
        targetUserId: params.userId,
        actorUserId: authUser!.sub,
        sendEmail: body.send_email,
        ip
      })

      if (!result.ok) {
        return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
      }

      // Same shape as the activation response so the console can render both
      // through one banner.
      return NextResponse.json({
        email: result.email,
        activation_link: result.resetLink,
        activation_expires_at: result.expiresAt.toISOString(),
        activation_email_sent: result.emailSent,
        activation_email_error: result.emailError
      })
    }

    if (body.action === 'set_temporary_password') {
      const supplied = body.password?.trim()
      const result = await setTemporaryPassword({
        targetUserId: params.userId,
        actorUserId: authUser!.sub,
        password: supplied ? supplied : null,
        requireChange: body.require_change,
        ip
      })

      if (!result.ok) {
        return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
      }

      // The only time this password exists in plaintext anywhere. The console
      // shows it once and the admin passes it on out of band.
      return NextResponse.json({
        email: result.email,
        temporary_password: result.temporaryPassword,
        must_change_password: result.mustChangePassword,
        sessions_revoked: result.sessionsRevoked,
        added_password_login: result.addedPasswordLogin,
        oauth_provider: result.oauthProvider
      })
    }

    if (body.action === 'require_password_change') {
      const result = await requirePasswordChange({
        targetUserId: params.userId,
        actorUserId: authUser!.sub,
        required: body.required,
        revokeSessions: body.revoke_sessions,
        ip
      })

      if (!result.ok) {
        return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
      }

      return NextResponse.json({
        email: result.email,
        must_change_password: result.mustChangePassword,
        sessions_revoked: result.sessionsRevoked
      })
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
