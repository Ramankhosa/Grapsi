import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/middleware'
import { getTenantEntitlementSummary } from '@/lib/entitlement-service'

export const dynamic = 'force-dynamic'

/**
 * Returns the caller's tenant plan + the feature/module access summary so the
 * client can show/hide product modules and render upgrade prompts. This is the
 * per-user read that previously did not exist (UI gating was 403-driven only).
 */
export async function GET(request: NextRequest) {
  const { user, error } = await authenticateRequest(request)
  if (error) return error

  // Platform-scope (super admin) users have no tenant plan; report full access
  // so the platform console isn't gated by tenant entitlements.
  if (!user!.tenant_id || user!.tenant_ati_id === 'PLATFORM') {
    return NextResponse.json({
      plan: { code: 'PLATFORM', name: 'Platform', tier: null },
      featureCodes: [],
      modules: [],
      isPlatform: true
    })
  }

  try {
    const summary = await getTenantEntitlementSummary(user!.tenant_id)
    return NextResponse.json({ ...summary, isPlatform: false })
  } catch (err) {
    console.error('Entitlements summary error:', err)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to load entitlements' },
      { status: 500 }
    )
  }
}
