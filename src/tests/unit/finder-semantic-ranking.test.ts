import { afterEach, describe, expect, it, vi } from 'vitest'

import { recommendationSearchService, scoreCandidate } from '@/lib/services/recommendationSearchService'
import { voyageRerankService } from '@/lib/services/voyageRerankService'
import { normalizeRecommendationSearchRequest } from '@/lib/recommendations/utils'
import type { RecommendationCandidate } from '@/lib/recommendations/types'

const normalized = normalizeRecommendationSearchRequest({
  inputMode: 'research_area',
  query: { researchArea: 'marfan syndrome aortic disease' },
  filters: {},
})

function candidate(id: string, semanticSimilarity: number, textRank: number): RecommendationCandidate {
  return {
    id,
    agencyName: `${id} funder`,
    schemeTitle: id,
    shortDescription: null,
    fullDescription: null,
    description: `${id} description`,
    closeDate: null,
    isRolling: true,
    fundingKinds: [],
    disciplines: [],
    eligibleCountries: [],
    eligibleRegions: [],
    hostCountries: [],
    institutionTypes: [],
    careerStages: [],
    sponsorType: null,
    officialUrls: [],
    amountMin: null,
    amountMax: null,
    currency: null,
    eligibilityText: null,
    contactInfo: null,
    geographyScope: null,
    funderCountry: null,
    citizenshipRequirements: [],
    residencyRequirements: [],
    applicationLanguages: [],
    semanticSimilarity,
    textRank,
  }
}

describe('AI advisor ranking on meaning', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a weak keyword hit with no meaning score does not outrank a strong meaning match', () => {
    // The 17 Oct 2026 case: Parkinson's calls matched only "disease" and were
    // never re-ranked; the Marfan award matched on meaning and keywords.
    const keywordOnly = candidate('parkinsons-travel-grant', 0, 2.4)
    const strongMatch = candidate('marfan-innovators-award', 0.81, 5.3)
    expect(scoreCandidate(strongMatch, normalized, null, true)).toBeGreaterThan(
      scoreCandidate(keywordOnly, normalized, null, true)
    )
  })

  it('keeps the keyword formula for a search with no meaning signal at all', () => {
    const keywordOnly = candidate('keyword-hit', 0, 2.4)
    expect(scoreCandidate(keywordOnly, normalized, null, false)).toBeGreaterThan(
      scoreCandidate(keywordOnly, normalized, null, true)
    )
  })

  it('re-ranks every candidate and scores keyword hits on meaning', async () => {
    const service = recommendationSearchService as any
    const vectorHits = Array.from({ length: 60 }, (_, index) => candidate(`vector-${index}`, 0.5, 0))
    const keywordHits = Array.from({ length: 60 }, (_, index) => candidate(`keyword-${index}`, 0.2, 2.4))
    vi.spyOn(service, 'searchByVector').mockResolvedValue({ candidates: vectorHits, degradedMode: null })
    const fullText = vi.spyOn(service, 'searchByFullText').mockResolvedValue(keywordHits)
    vi.spyOn(voyageRerankService, 'isConfigured').mockReturnValue(true)
    const rerank = vi.spyOn(voyageRerankService, 'rerank').mockImplementation(async ({ documents }) =>
      documents.map((_, index) => ({ index, relevanceScore: 0.3 }))
    )

    const execution = await service.executeSearch(normalized, false, undefined, undefined, { queryVectorLiteral: '[0.1]' })

    // The keyword branch gets the query vector, so its hits carry a real similarity.
    expect(fullText.mock.calls[0][3]).toBe('[0.1]')
    // No candidate is left outside the re-ranker's window.
    expect(rerank.mock.calls[0][0].documents).toHaveLength(120)
    expect(execution.candidates).toHaveLength(120)
    expect(execution.candidates.every((item: RecommendationCandidate) => item.semanticSimilarity >= 0.3)).toBe(true)
  })
})
