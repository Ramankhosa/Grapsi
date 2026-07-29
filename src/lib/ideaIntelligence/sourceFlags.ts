// Which evidence corpora the idea-intelligence review pass is allowed to touch.
//
// The review pass is deliberately narrowed to the local sanctioned-project
// corpus: publications, patents and web search are switched off, and no funding
// call is retrieved unless the user anchored one. Calls now enter through the
// user-driven "Find funding opportunities" step instead, so the report can no
// longer grade an idea against a call nobody picked.
//
// Every source is off by default and re-enabled per environment. The provider
// code stays in place — this only decides whether it is called.

function enabled(name: string) {
  return String(process.env[name] || '').toLowerCase() === 'true'
}

export const IDEA_SOURCE_FLAGS = {
  publications: enabled('IDEA_INTELLIGENCE_ENABLE_PUBLICATIONS'),
  // Covers both patent providers: Google Patents (SerpAPI) and PatentNest.
  patents: enabled('IDEA_INTELLIGENCE_ENABLE_PATENTS'),
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
