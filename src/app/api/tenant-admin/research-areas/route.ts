import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantUser } from '@/lib/auth/tenantAccess'
import { researchAreaTaxonomyService } from '@/lib/services/researchAreaTaxonomyService'

export const dynamic = 'force-dynamic'

/**
 * The active discipline catalog, for tenant-side pickers.
 *
 * The researcher-facing equivalent sits behind the recommendation entitlement,
 * which is the wrong gate here: mapping the org structure is administrative
 * setup, not a research feature a tenant might not have bought.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  try {
    const taxonomy = await researchAreaTaxonomyService.listActiveTaxonomy()
    return NextResponse.json({
      hasActiveTaxonomy: taxonomy.hasActiveTaxonomy,
      groups: taxonomy.groups,
      areas: taxonomy.areas,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Could not load the research-area catalog.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
