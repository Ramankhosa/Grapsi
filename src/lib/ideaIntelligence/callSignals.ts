// Pure, dependency-free scoring helpers for call-aware idea validation.
// Kept out of service.ts (which imports prisma / embeddings / server-only) so
// the deterministic scoring can be unit-tested without the server import graph.

export type FacetStatus = 'PRESENT' | 'PARTIAL' | 'ABSENT' | 'UNASSESSED'

export type FacetAssessment = {
  facet: string
  status: FacetStatus
  evidence: string
  reason: string
}

// For funding calls the facet statuses read as: PRESENT = the call text explicitly
// invites/prioritizes this facet, PARTIAL = related but not exact, ABSENT = the call
// text suggests it is out of scope, UNASSESSED = the supplied call text does not say.
export type FundingCallFacetAssessment = {
  fundingCallId: string
  role: 'anchored' | 'matched'
  summary: string
  callPriorities: string[]
  facetAssessments: FacetAssessment[]
}

export function statusValue(status: FacetStatus) {
  return status === 'PRESENT' ? 1 : status === 'PARTIAL' ? 0.5 : status === 'ABSENT' ? 0 : null
}

export function calculateCallAlignments(callItems: FundingCallFacetAssessment[]) {
  return callItems.map((item) => {
    const assessed = item.facetAssessments.filter((cell) => cell.status !== 'UNASSESSED')
    const alignment = assessed.length
      ? assessed.reduce((sum, cell) => sum + (statusValue(cell.status) || 0), 0) / assessed.length
      : 0
    return {
      fundingCallId: item.fundingCallId,
      role: item.role,
      alignment: Math.round(alignment * 100),
      assessedFacets: assessed.length,
      invitedFacets: item.facetAssessments.filter((cell) => cell.status === 'PRESENT').map((cell) => cell.facet),
      partialFacets: item.facetAssessments.filter((cell) => cell.status === 'PARTIAL').map((cell) => cell.facet),
      outsideScopeFacets: item.facetAssessments.filter((cell) => cell.status === 'ABSENT').map((cell) => cell.facet),
      unassessedFacets: item.facetAssessments.filter((cell) => cell.status === 'UNASSESSED').map((cell) => cell.facet),
      callPriorities: item.callPriorities,
      methodology: 'Share of assessed idea facets the call text explicitly invites (PRESENT=1, PARTIAL=0.5). Descriptive only, not a funding prediction.',
    }
  })
}
