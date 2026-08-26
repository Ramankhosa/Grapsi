import type { Prisma } from '@/lib/prisma-generated'

/**
 * The one canonical answer to "which funding calls may this viewer see?".
 *
 * Three code paths used to answer this differently (the intake routes, the
 * assignment routes, and researcher matching), which let a TENANT_PRIVATE call
 * that was still a draft be read — and assigned — tenant-wide. Every predicate
 * now derives from here:
 *
 *   - global calls: GLOBAL_PUBLISHED, published (either status column), active
 *   - tenant calls: the caller's own tenant, and published+active unless the
 *     caller is entitled to work drafts (tenant admins, funding-department
 *     members, and the import/dedupe flow — decided by the route, passed in
 *     as `includeTenantDrafts`).
 *
 * `is_active` is treated as "not explicitly deactivated": legacy rows carry
 * NULL and must stay visible.
 */
const PUBLISHED_AND_ACTIVE: Prisma.FundingCallWhereInput[] = [
  { OR: [{ status: 'PUBLISHED' }, { catalog_status: 'PUBLISHED' }] },
  { OR: [{ is_active: true }, { is_active: null }] },
]

export function visibleFundingCallWhere(
  tenantId: string | null,
  options: { includeTenantDrafts?: boolean } = {}
): Prisma.FundingCallWhereInput {
  const branches: Prisma.FundingCallWhereInput[] = [
    { AND: [{ visibility: 'GLOBAL_PUBLISHED' }, ...PUBLISHED_AND_ACTIVE] },
  ]
  if (tenantId) {
    branches.push({
      AND: [
        { visibility: 'TENANT_PRIVATE' },
        { tenantId },
        ...(options.includeTenantDrafts ? [] : PUBLISHED_AND_ACTIVE),
      ],
    })
  }
  return { OR: branches }
}
