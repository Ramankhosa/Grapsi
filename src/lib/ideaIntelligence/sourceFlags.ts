// Which evidence corpora the idea-intelligence review pass is allowed to touch.
//
// The review pass reads the local sanctioned-project corpus and the patent
// corpus. Publications and web search stay off — they add volume without
// changing a decision — and no funding call is retrieved unless the user
// anchored one. Calls enter through the user-driven "Find funding
// opportunities" step instead, so the report can never grade an idea against a
// call nobody picked.
//
// The provider code stays in place regardless — this only decides whether it is
// called.

function enabled(name: string) {
  return String(process.env[name] || '').toLowerCase() === 'true'
}

function enabledUnlessDisabled(name: string) {
  return String(process.env[name] || '').toLowerCase() !== 'false'
}

export const IDEA_SOURCE_FLAGS = {
  publications: enabled('IDEA_INTELLIGENCE_ENABLE_PUBLICATIONS'),
  // Covers both patent providers: Google Patents (SerpAPI) and PatentNest.
  // On by default: a live patent over an unfunded aspect is the single most
  // decision-changing fact in a run, so the read is wrong without it. Set
  // IDEA_INTELLIGENCE_ENABLE_PATENTS=false to switch the paid lookups off.
  patents: enabledUnlessDisabled('IDEA_INTELLIGENCE_ENABLE_PATENTS'),
  web: enabled('IDEA_INTELLIGENCE_ENABLE_WEB'),
  // Call matching during the review pass. Off means calls arrive only via an
  // explicit anchorFundingCallId or the user-driven funding-match step.
  callsDuringReview: enabled('IDEA_INTELLIGENCE_ENABLE_REVIEW_CALL_MATCH'),
} as const

export type IdeaSourceFlags = typeof IDEA_SOURCE_FLAGS

export function anyExternalEvidenceEnabled(flags: IdeaSourceFlags = IDEA_SOURCE_FLAGS) {
  return flags.publications || flags.patents || flags.web
}

// Persisted with each run so the workspace can hide the tabs and table columns
// for corpora that were never searched, without breaking older runs.
export type IdeaSourcesUsed = {
  projects: boolean
  publications: boolean
  patents: boolean
  web: boolean
  calls: boolean
}
