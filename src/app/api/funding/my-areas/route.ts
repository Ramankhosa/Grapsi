import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import {
  findCallsInMyAreas,
  type MyAreasStatus,
} from '@/lib/funding/myAreasService'

export const dynamic = 'force-dynamic'

/**
 * The calls that match the signed-in researcher.
 *
 * Deliberately the plainest endpoint in the funding surface: it takes no query
 * text, makes no paid model call, because it compares vectors both
 * sides already have. That is the whole point — the researcher should be able
 * to press a button and see their calls, rather than describe their own work to
 * a chatbot to be told what the system already knew.
 *
 * Always scoped to the caller. There is no `userId` parameter, so this cannot
 * become a way to read someone else's research profile by proxy.
 */
async function catalogueGET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (auth.error || !auth.user) {
    return NextResponse.json(
      { error: auth.error || 'Session missing or expired. Please log in again.' },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(request.url)
  const requested = (searchParams.get('status') || 'active').toLowerCase()
  const status: MyAreasStatus =
    requested === 'expired' || requested === 'all' ? (requested as MyAreasStatus) : 'active'

  const limitParam = Number(searchParams.get('limit'))
  const limit = Math.min(50,Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 12)
  const offset = Math.max(0,Math.min(10000,Math.floor(Number(searchParams.get('offset'))||0)))

  try {
    const result = await findCallsInMyAreas(auth.user.id, auth.user.tenantId ?? null, {
      status,
      limit,
      offset,
    })
    return NextResponse.json({ status, ...result })
  } catch (error) {
    console.error('Funding in my areas failed', error)
    return NextResponse.json({ error: 'Could not work out your matching calls.' }, { status: 500 })
  }
}

export const GET = withCatalogueProtection(catalogueGET, 'summary', 'FUNDING_DISCOVERY')
