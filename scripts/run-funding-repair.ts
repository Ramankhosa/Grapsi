import 'dotenv/config'

import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

async function main() {
  const fundingLimit = Number(process.env.FUNDING_EMBEDDING_REPAIR_LIMIT || '50')
  const researchAreaLimit = Number(process.env.RESEARCH_AREA_EMBEDDING_REPAIR_LIMIT || '50')

  const [fundingResult, researchAreaResult, archivedCount] = await Promise.all([
    fundingCatalogService.backfillPublishedEmbeddings(fundingLimit),
    researcherProfileService.backfillResearchAreaEmbeddings(researchAreaLimit),
    fundingCatalogService.archiveExpiredPublishedCalls(),
  ])

  const summary = {
    fundingEmbeddings: fundingResult,
    researchAreaEmbeddings: researchAreaResult,
    archivedCount,
    completedAt: new Date().toISOString(),
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error('[funding-repair] failed', error)
  process.exit(1)
})
