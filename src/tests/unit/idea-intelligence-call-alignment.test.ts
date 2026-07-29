import { describe, expect, it } from 'vitest'

import { calculateCallAlignments, type FundingCallFacetAssessment } from '@/lib/ideaIntelligence/callSignals'

function callItem(overrides: Partial<FundingCallFacetAssessment> = {}): FundingCallFacetAssessment {
  return {
    fundingCallId: 'call-1',
    role: 'anchored',
    summary: 'Supports AI-driven public health screening pilots',
    callPriorities: ['AI in healthcare', 'rural deployment'],
    facetAssessments: [
      { facet: 'Smartphone fundus imaging', status: 'PRESENT', evidence: 'point-of-care imaging invited', reason: 'explicit theme' },
      { facet: 'On-device AI screening model', status: 'PARTIAL', evidence: 'AI tools mentioned broadly', reason: 'related' },
      { facet: 'PHC deployment in rural Punjab', status: 'ABSENT', evidence: 'urban tertiary centres only', reason: 'scope mismatch' },
      { facet: 'Community health worker training', status: 'UNASSESSED', evidence: '', reason: '' },
    ],
    ...overrides,
  }
}

describe('calculateCallAlignments', () => {
  it('scores alignment over assessed facets only (PRESENT=1, PARTIAL=0.5)', () => {
    const [alignment] = calculateCallAlignments([callItem()])
    // (1 + 0.5 + 0) / 3 assessed facets = 50%
    expect(alignment.alignment).toBe(50)
    expect(alignment.assessedFacets).toBe(3)
    expect(alignment.invitedFacets).toEqual(['Smartphone fundus imaging'])
    expect(alignment.partialFacets).toEqual(['On-device AI screening model'])
    expect(alignment.outsideScopeFacets).toEqual(['PHC deployment in rural Punjab'])
    expect(alignment.unassessedFacets).toEqual(['Community health worker training'])
    expect(alignment.role).toBe('anchored')
    expect(alignment.callPriorities).toEqual(['AI in healthcare', 'rural deployment'])
  })

  it('returns 0 alignment when nothing was assessed', () => {
    const [alignment] = calculateCallAlignments([
      callItem({
        facetAssessments: [
          { facet: 'Facet A', status: 'UNASSESSED', evidence: '', reason: '' },
          { facet: 'Facet B', status: 'UNASSESSED', evidence: '', reason: '' },
        ],
      }),
    ])
    expect(alignment.alignment).toBe(0)
    expect(alignment.assessedFacets).toBe(0)
    expect(alignment.unassessedFacets).toHaveLength(2)
  })

  // A review with no call chosen produces no callItems, so this empty result is
  // what makes the Call fit section disappear instead of grading the idea
  // against a call the user never picked.
  it('produces nothing when no call was compared', () => {
    expect(calculateCallAlignments([])).toEqual([])
  })

  it('keeps one entry per call and preserves ids', () => {
    const alignments = calculateCallAlignments([
      callItem({ fundingCallId: 'call-1', role: 'anchored' }),
      callItem({ fundingCallId: 'call-2', role: 'matched' }),
    ])
    expect(alignments.map((item) => item.fundingCallId)).toEqual(['call-1', 'call-2'])
    expect(alignments[1].role).toBe('matched')
  })
})
