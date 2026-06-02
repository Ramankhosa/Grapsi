import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { grantTenantEntitlement } from '@/lib/entitlement-service'
import { createAuditLog } from '@/lib/auth'
import { authenticateRequest, requirePlatformScope } from '@/lib/middleware'

const grantSchema = z.object({
  tenant_id: z.string().min(1),
  plan_code: z.string().min(1),
  effective_from: z.string().datetime().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  reference: z.string().min(1).optional(),
  notes: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const { user } = await authenticateRequest(request)
    const body = grantSchema.parse(await request.json())
    const entitlement = await grantTenantEntitlement({
      tenantId: body.tenant_id,
      planCode: body.plan_code,
      source: 'SUPERADMIN_GRANT',
      sourceRef: body.reference,
      effectiveFrom: body.effective_from ? new Date(body.effective_from) : undefined,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      metadata: body.notes ? { notes: body.notes } : null
    })

    await createAuditLog({
      actorUserId: user!.sub,
      tenantId: body.tenant_id,
      action: 'TENANT_ENTITLEMENT_GRANT',
      resource: `tenant_plan:${entitlement.id}`,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      meta: {
        planCode: body.plan_code,
        source: 'SUPERADMIN_GRANT',
        sourceRef: body.reference || null,
        effectiveFrom: entitlement.effectiveFrom,
        expiresAt: entitlement.expiresAt
      }
    })

    return NextResponse.json({ entitlement }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { code: 'ENTITLEMENT_GRANT_FAILED', message: error instanceof Error ? error.message : 'Failed to grant entitlement' },
      { status: 400 }
    )
  }
}
