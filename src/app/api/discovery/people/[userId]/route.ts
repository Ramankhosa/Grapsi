import { NextRequest, NextResponse } from 'next/server'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { isAccessError } from '@/lib/auth/tenantAccess'
import { discoveryCapabilities, requireDiscoveryPeople } from '@/lib/discovery/server'
import { loadFacultyProfile } from '@/lib/faculty/profile'

export const dynamic = 'force-dynamic'

/**
 * A colleague's profile for Research Discovery: any member, own organisation
 * only, active people only. Staff numbers stay with administrators, heads and
 * the funding department.
 */
export const GET = withCatalogueProtection(async (request: NextRequest, context: { params: { userId: string } }) => {
  const auth = await requireDiscoveryPeople(request)
  if (isAccessError(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const userId = String(context?.params?.userId || '').slice(0, 120)
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  const profile = await loadFacultyProfile({
    tenantId: auth.tenantId,
    userId,
    activeOnly: true,
    includeEmployeeId: discoveryCapabilities(auth).canSeeEmployeeIds,
  })
  if (!profile) return NextResponse.json({ error: 'This person is not in your organisation.' }, { status: 404 })
  return NextResponse.json({ profile }, { headers: { 'Cache-Control': 'private, no-store' } })
}, 'metadata')
