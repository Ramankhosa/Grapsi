import type { GrantPrepIdeationDecision, GrantPrepMarkerPayload } from '@/lib/grantPrep/types'

/**
 * Synthetic marker covering the ideation points when an idea is finalized.
 * Shared by the ideation decision route and the Draft Zero generate route so
 * both apply the same thin-anchor quality check (a thin anchor is marked
 * 'weak', which keeps ideation in review in expert mode).
 */
export function buildGrantPrepIdeationDecisionMarker(
  anchor: GrantPrepIdeationDecision['anchor'],
  selectedPriorityAreas: string[],
  anchorAssessmentReason: string = 'The user explicitly selected this idea.'
): GrantPrepMarkerPayload {
  const ideaFacts = [anchor.oneSentenceSummary, anchor.problemOrOpportunity, anchor.coreApproach].filter(Boolean)
  const fundabilityFacts = [...anchor.distinguishingFeatures, ...anchor.funderFit].filter(Boolean)
  const priorityFacts = [...anchor.funderFit, ...selectedPriorityAreas].filter(Boolean)
  const summaryWordCount = anchor.oneSentenceSummary.trim().split(/\s+/).filter(Boolean).length
  const isThin = summaryWordCount < 12 || !anchor.problemOrOpportunity || !anchor.coreApproach || priorityFacts.length === 0
  return {
    version: 'brainstorm_marker_v1',
    stageKey: 'ideation',
    pointsCovered: [
      {
        pointKey: 'idea_core',
        keywords: [],
        factBullets: ideaFacts,
        confidence: 1,
        captureBasis: ['user_confirmed'],
        ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
      },
      {
        pointKey: 'fundability_signals',
        keywords: [],
        factBullets: fundabilityFacts,
        confidence: 0.95,
        captureBasis: ['user_confirmed'],
        ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
      },
      {
        pointKey: 'selected_priority_fit',
        keywords: selectedPriorityAreas,
        thrustLinkage: selectedPriorityAreas,
        factBullets: priorityFacts,
        confidence: 0.9,
        captureBasis: ['user_confirmed'],
        ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
      },
    ],
    currentPoint: null,
    suggestedAnswers: null,
    qualityAssessment: isThin ? 'weak' : 'strong',
    steeringEvents: [],
    anchorAssessment: { status: 'aligned', reason: anchorAssessmentReason },
  }
}
