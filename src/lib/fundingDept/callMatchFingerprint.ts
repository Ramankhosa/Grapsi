import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { callAreaRowsSql } from '@/lib/researchAreas/queries'
import { CALL_MATCH_CENSUS_VERSION, RESEARCHER_SEARCH_SCORING_VERSION } from '@/lib/researcherMatching/config'
import { ELIGIBILITY_ASSESSMENT_VERSION } from '@/lib/funding/eligibilityAssessment'
import { voyageRerankService } from '@/lib/services/voyageRerankService'

/**
 * Which reranker scored the census. A census scored without the reranker, or by
 * another model, must not be reused once that changes. Never the key itself.
 */
export function rerankerIdentity() {
  return voyageRerankService.isConfigured() ? `voyage:${voyageRerankService.getModelName()}` : 'none'
}

/**
 * Read-only cache identity; importing it never initialises a model provider.
 *
 * Only what the census actually reads goes in: the call's scored text and
 * eligibility columns, each person's profile, placement, saved interests and
 * tagged publications. Row versions of the users table are deliberately left
 * out — a sign-in writes lastLoginAt, and that used to invalidate every open
 * call's census in the tenant. Profile row versions stay, because embeddings
 * are written by raw SQL without touching updated_at.
 */
export async function callFingerprint(tenantId: string, callId: string, db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma) {
  const rows = await db.$queryRaw<Array<{ fingerprint: string }>>(Prisma.sql`
    SELECT md5(concat_ws('|', ${CALL_MATCH_CENSUS_VERSION}, ${RESEARCHER_SEARCH_SCORING_VERSION},
      ${ELIGIBILITY_ASSESSMENT_VERSION}, ${rerankerIdentity()},
      (SELECT md5(row(fc.id, fc.title, fc.agency_name, fc.scheme_title, fc.description, fc.eligibility_text,
                      fc.disciplines, fc.funding_kinds, fc.career_stages, fc.institution_types,
                      fc.applicant_scope, fc.applicant_country_codes, fc.applicant_excluded_codes, fc.applicant_region_codes,
                      fc.residence_scope, fc.residence_country_codes, fc.residence_excluded_codes, fc.residence_region_codes,
                      fc.citizenship_scope, fc.citizenship_country_codes, fc.citizenship_excluded_codes, fc.citizenship_region_codes,
                      fc.host_scope, fc.host_country_codes, fc.host_excluded_codes, fc.host_region_codes)::text)
         FROM funding_calls fc WHERE fc.id = ${callId}),
      (SELECT string_agg(concat_ws(':', a.taxonomy_area_id, a.taxonomy_level2_name, a.taxonomy_level1_name), ',' ORDER BY a.taxonomy_area_id)
         FROM ${callAreaRowsSql()} a WHERE a.funding_call_id=${callId}),
      (SELECT string_agg(concat_ws(':', u.id, u.name, u.status, p.updated_at, p.org_unit_id, p.xmin::text)::text, ',' ORDER BY u.id)
         FROM users u LEFT JOIN researcher_profiles p ON p.user_id = u.id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', a.id, a.updated_at, a.xmin::text)::text, ',' ORDER BY a.id)
         FROM researcher_saved_research_areas a JOIN users u ON u.id = a.user_id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', r.id, r."updatedAt", r.xmin::text)::text, ',' ORDER BY r.id)
         FROM reference_library r JOIN users u ON u.id = r.user_id
        WHERE u."tenantId" = ${tenantId} AND 'my-publication' = ANY(r.tags)),
      (SELECT string_agg(concat_ws(':', id, updated_at, xmin::text)::text, ',' ORDER BY id) FROM tenant_org_units WHERE tenant_id = ${tenantId}),
      ${process.env.RESEARCHER_MATCH_MIN_SIMILARITY || ''}, ${process.env.RESEARCHER_MATCH_RERANK_GATE || ''},
      ${process.env.RESEARCHER_MATCH_RERANK_STRONG || ''}, ${process.env.RESEARCHER_MATCH_RERANK_MODERATE || ''},
      ${process.env.RESEARCHER_MATCH_VECTOR_GAP || ''},
      ${process.env.EMBEDDING_PROVIDER || 'gemini'}, ${process.env.VOYAGE_OUTPUT_DIMENSIONS || '1024'},
      ${process.env.GOOGLE_EMBEDDINGS_DIMENSIONS || '768'}
    )) fingerprint`)
  return rows[0].fingerprint
}
