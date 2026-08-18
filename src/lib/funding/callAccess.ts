import type { Prisma } from '@prisma/client'

import type { RecommendationAccessScope } from '@/lib/recommendations/types'

/**
 * Prisma `where` fragment that scopes a `fundingCall` read to what the actor may
 * see. Mirrors the raw-SQL predicate used by the recommendation search
 * (`recommendationSearchService.ts` buildBaseConditions/buildAccessCondition) and
 * by document-chunk retrieval (`fundingDocuments/retrieval.ts`):
 *
 *   published (status or catalog_status) AND active AND
 *   (GLOBAL_PUBLISHED OR (TENANT_PRIVATE AND own tenant))
 *
 * Super admins see everything. Use this on any single-call read reached from a
 * conversation snapshot (e.g. call-document Q&A) so a call that has since been
 * unpublished or made tenant-private stops being readable through old chats.
 */
export function fundingCallAccessWhere(access?: RecommendationAccessScope | null): Prisma.FundingCallWhereInput {
  if (access?.isSuperAdmin) return {}

  const visibility: Prisma.FundingCallWhereInput[] = [{ visibility: 'GLOBAL_PUBLISHED' }]
  if (access?.tenantId) {
    visibility.push({ visibility: 'TENANT_PRIVATE', tenantId: access.tenantId })
  }

  return {
    AND: [
      { OR: [{ status: 'PUBLISHED' }, { catalog_status: 'PUBLISHED' }] },
      { OR: [{ is_active: true }, { is_active: null }] },
      { OR: visibility },
    ],
  }
}
