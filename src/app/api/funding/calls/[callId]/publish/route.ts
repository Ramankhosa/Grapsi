import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { prisma } from '@/lib/prisma'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Publish one of the tenant's OWN calls to the tenant's faculty.
 *
 * This is the missing half of the tenant intake flow: uploads land as drafts,
 * and until now only platform publishers could flip a call to PUBLISHED — so a
 * tenant's own calls sat visible to nobody's alerts forever. Publishing here
 * reuses the exact catalog publish path the platform uses (readiness check,
 * embedding, then background alert dispatch), and the dispatcher already
 * limits a TENANT_PRIVATE call's alerts to this tenant's researchers.
 *
 * Who may publish: tenant admins (OWNER/ADMIN/CALL_ADMIN) and the funding
 * department head. Members prepare drafts; publishing is an announcement to up
 * to 50 matched faculty, so it stays with the people who answer for it.
 */
export async function POST(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const mayPublish = context.isAdmin || context.isCallAdmin || context.scope.fundingDept.isHead
  if (!mayPublish) {
    return NextResponse.json(
      { error: 'Only tenant administrators or the funding department head can publish a call.' },
      { status: 403 }
    )
  }

  const call = await prisma.fundingCall.findFirst({
    where: { id: params.callId, tenantId: context.tenantId, visibility: 'TENANT_PRIVATE' },
    select: { id: true, catalog_status: true, status: true },
  })
  if (!call) {
    return NextResponse.json(
      { error: 'Funding call not found in your organization.' },
      { status: 404 }
    )
  }
  if (call.catalog_status === 'PUBLISHED') {
    return NextResponse.json({ ok: true, alreadyPublished: true })
  }

  try {
    const result = await fundingCatalogService.publishFundingCall(call.id, {
      userId: context.user.id,
      email: context.user.email,
      role: 'USER',
      tenantId: context.tenantId,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: 'This call is missing required fields and cannot be published yet.',
          requiredFieldsRemaining: result.requiredFieldsRemaining || [],
        },
        { status: 422 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[FUNDING] Tenant publish failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish failed.' },
      { status: 500 }
    )
  }
}
