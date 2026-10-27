/**
 * What a page's latest assessment actually establishes. One definition, used
 * by the page tree and the stage counts alike, so a colour or a number never
 * claims more than the pipeline knows:
 *
 * - "Funding found" needs a positive screening verdict that reached review
 *   with its processing finished — a pending page still waiting for (renewed)
 *   laptop screening, or judged UNSURE, is not a found opportunity.
 * - NEEDS_EVIDENCE is split: a page that could not be read is UNREADABLE; a
 *   page that was read but lacks an invitation, dates, a clear round or host
 *   approval is INCOMPLETE.
 */
export type PageOutcome =
  | 'PUBLISHED'
  | 'FUNDING_FOUND'
  | 'UNSURE'
  | 'INCOMPLETE'
  | 'WAITING_LOCAL'
  | 'SCREENING'
  | 'NOT_FUNDING'
  | 'UNREADABLE'
  | 'LISTING'
  | 'NO_RESULT'
  | 'QUEUED'
  | 'FAILED'
  | 'SKIPPED'

export interface AssessedOpportunity {
  review_state: string
  processing_state: string
  triage_verdict: string | null
  triage_reason?: string | null
  relevance_outcome: string | null
}

export const WAITING_LOCAL_PREFIX = 'Waiting for laptop'

const POSITIVE = ['NEW_OPPORTUNITY', 'UPDATE_TO_EXISTING']
const IN_REVIEW = ['PENDING', 'UPDATE_PROPOSED', 'SNOOZED', 'MERGED']
const SETTLED = ['TRIAGED', 'EXTRACTING', 'DRAFTED', 'DONE']
// Reasons the pipeline writes when it could not read the page at all.
const UNREADABLE_REASONS = [/^Detail evidence could not be read/i, /^Readable source evidence is needed/i, /^Evidence is unreadable/i]

export function classifyOpportunity(o: AssessedOpportunity, resource?: { last_validation_status?: string | null } | null): { outcome: PageOutcome; detail: string } {
  const reason = o.triage_reason ?? ''
  if (o.review_state === 'PUBLISHED') return { outcome: 'PUBLISHED', detail: 'Published to the catalog' }
  if (o.review_state === 'REJECTED') return { outcome: 'NOT_FUNDING', detail: 'Rejected by a reviewer' }
  if (o.triage_verdict === 'NOT_FUNDING') {
    return { outcome: 'NOT_FUNDING', detail: /^Unchanged since/i.test(reason) ? 'Not funding; unchanged, so not analysed again' : 'Screened out as not a funding call' }
  }
  if (!o.triage_verdict && o.relevance_outcome === 'STRONG_NEGATIVE') return { outcome: 'NOT_FUNDING', detail: 'Filtered out by keyword screening' }
  if (reason.startsWith(WAITING_LOCAL_PREFIX)) return { outcome: 'WAITING_LOCAL', detail: 'Waiting for the laptop’s first-pass analysis' }
  if (o.processing_state === 'NEEDS_EVIDENCE') {
    if (resource?.last_validation_status === 'UNREACHABLE' || UNREADABLE_REASONS.some((pattern) => pattern.test(reason))) {
      return { outcome: 'UNREADABLE', detail: 'The page or its documents could not be read' }
    }
    if (/^Related host approval required/i.test(reason)) return { outcome: 'INCOMPLETE', detail: 'Its documents are on a host this site has not approved' }
    if (/^Several calls are listed here/i.test(reason)) return { outcome: 'INCOMPLETE', detail: 'Lists several calls; each is analysed separately' }
    return { outcome: 'INCOMPLETE', detail: 'Read, but the invitation, dates or round are not clear yet' }
  }
  if (o.triage_verdict === 'UNSURE') return { outcome: 'UNSURE', detail: 'Screening was unsure; needs a person' }
  if (o.triage_verdict && POSITIVE.includes(o.triage_verdict) && IN_REVIEW.includes(o.review_state) && SETTLED.includes(o.processing_state)) {
    return { outcome: 'FUNDING_FOUND', detail: o.review_state === 'UPDATE_PROPOSED' ? 'Update to a catalog call, waiting for review' : o.review_state === 'SNOOZED' ? 'Funding opportunity, snoozed' : 'Funding opportunity, waiting for review' }
  }
  if (o.triage_verdict === 'UPDATE_TO_EXISTING' && o.processing_state === 'DONE' && /^Existing verified call/i.test(reason)) {
    return { outcome: 'PUBLISHED', detail: 'Already in the catalog; page unchanged' }
  }
  return { outcome: 'SCREENING', detail: 'Being screened' }
}
