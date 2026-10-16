import { NextRequest, NextResponse } from 'next/server'

import { authenticateRequest } from '@/lib/middleware'
import { getTenantLocale } from '@/lib/tenant/locale'

export const dynamic = 'force-dynamic'

/**
 * The signed-in user's organization regional settings (currency, time zone,
 * locale, country), resolved with defaults, for client-side formatting.
 * Any authenticated user may read their own tenant's settings.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await authenticateRequest(request)
  if (error) return error
  return NextResponse.json(await getTenantLocale(user?.tenant_id ?? null))
}
