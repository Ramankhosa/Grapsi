import { NextRequest, NextResponse } from 'next/server'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { isAccessError } from '@/lib/auth/tenantAccess'
import { requireDiscoveryPeople } from '@/lib/discovery/server'
import { loadDiscoveryOrg } from '@/lib/discovery/org'

export const dynamic = 'force-dynamic'

/** The organisation's schools, departments and their people counts, for any member. */
export const GET = withCatalogueProtection(async (request: NextRequest) => {
  const auth = await requireDiscoveryPeople(request)
  if (isAccessError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    return NextResponse.json(await loadDiscoveryOrg(auth.tenantId), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'The organisation could not be loaded. Please retry.' }, { status: 503 })
  }
}, 'metadata')
