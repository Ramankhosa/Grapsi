import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { callAreaRowsSql } from '@/lib/researchAreas/queries'
import { CALL_MATCH_CENSUS_VERSION, RESEARCHER_SEARCH_SCORING_VERSION } from '@/lib/researcherMatching/config'

/** Read-only cache identity; importing it never initialises a model provider. */
export async function callFingerprint(tenantId: string, callId: string, db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma) {
  const rows = await db.$queryRaw<Array<{ fingerprint: string }>>(Prisma.sql`
    SELECT md5(concat_ws('|', ${CALL_MATCH_CENSUS_VERSION}, ${RESEARCHER_SEARCH_SCORING_VERSION},
      (SELECT concat_ws(':', id, "updatedAt", xmin::text) FROM funding_calls WHERE id = ${callId}),
      (SELECT string_agg(concat_ws(':', a.taxonomy_area_id, a.taxonomy_level2_name, a.taxonomy_level1_name), ',' ORDER BY a.taxonomy_area_id)
         FROM ${callAreaRowsSql()} a WHERE a.funding_call_id=${callId}),
      (SELECT string_agg(concat_ws(':', u.id, u."updatedAt", p.updated_at, p.org_unit_id, u.status, u.xmin::text, p.xmin::text)::text, ',' ORDER BY u.id)
         FROM users u LEFT JOIN researcher_profiles p ON p.user_id = u.id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', a.id, a.updated_at, a.xmin::text)::text, ',' ORDER BY a.id)
         FROM researcher_saved_research_areas a JOIN users u ON u.id = a.user_id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', r.id, r."updatedAt", r.xmin::text)::text, ',' ORDER BY r.id)
         FROM reference_library r JOIN users u ON u.id = r.user_id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', id, updated_at, xmin::text)::text, ',' ORDER BY id) FROM tenant_org_units WHERE tenant_id = ${tenantId}),
      ${process.env.RESEARCHER_MATCH_MIN_SIMILARITY || ''}, ${process.env.RESEARCHER_MATCH_RERANK_GATE || ''},
      ${process.env.RESEARCHER_MATCH_RERANK_STRONG || ''}, ${process.env.RESEARCHER_MATCH_RERANK_MODERATE || ''},
      ${process.env.RESEARCHER_MATCH_VECTOR_GAP || ''},
      ${process.env.EMBEDDING_PROVIDER || 'gemini'}, ${process.env.VOYAGE_OUTPUT_DIMENSIONS || '1024'},
      ${process.env.GOOGLE_EMBEDDINGS_DIMENSIONS || '768'}
    )) fingerprint`)
  return rows[0].fingerprint
}
