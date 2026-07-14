import 'dotenv/config'

import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { researcherProfileService } from '@/lib/services/researcherProfileService'
import { fundingPublicationService } from '@/lib/researcherProfile/funding-publications'

// Runs ONE embedding per target (limit 1) to verify the pipeline end-to-end.
// The funding-call backfill is the one whose candidate query had the
// `column "updated_at" does not exist` bug — if it runs without erroring, the
// fix is confirmed.
async function main() {
  console.log('Running one embedding per target (limit 1)…\n')

  const funding = await fundingCatalogService.backfillPublishedEmbeddings(1)
  console.log('funding_calls        →', JSON.stringify(funding))

  const profiles = await researcherProfileService.backfillResearcherProfileEmbeddings(1)
  console.log('researcher_profiles  →', JSON.stringify(profiles))

  const areas = await researcherProfileService.backfillResearchAreaEmbeddings(1)
  console.log('research_areas       →', JSON.stringify(areas))

  const pubs = await fundingPublicationService.backfillEmbeddings(1)
  console.log('funding_publications →', JSON.stringify(pubs))

  console.log('\nCoverage after:')
  console.log('  funding calls      :', JSON.stringify(await fundingCatalogService.getEmbeddingCoverageSummary()))
  console.log('  researcher profiles:', JSON.stringify(await researcherProfileService.getResearcherProfileEmbeddingCoverage()))
  console.log('  research areas     :', JSON.stringify(await researcherProfileService.getResearchAreaEmbeddingCoverage()))
  console.log('  publications       :', JSON.stringify(await fundingPublicationService.getEmbeddingCoverage()))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFAILED:', e)
    process.exit(1)
  })
