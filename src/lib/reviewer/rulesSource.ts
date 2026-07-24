/**
 * Client-safe vocabulary for where a reviewer workspace's rules came from.
 * Kept out of `callContext.ts` so pages can import the labels without pulling
 * Prisma into the browser bundle.
 */
export type ReviewerRulesSource =
  /** Approved funding-call template + manual rubric (richest). */
  | 'template_manual'
  /** Approved/draft guideline pack on a stored call that has no template. */
  | 'guideline_manual'
  /** Stored call with neither template nor guidelines: use its own fields. */
  | 'call_fields'
  /** Rules extracted by the LLM from user-supplied call URLs. */
  | 'url_extracted'

export const REVIEWER_RULES_SOURCES: ReviewerRulesSource[] = [
  'template_manual',
  'guideline_manual',
  'call_fields',
  'url_extracted',
]

export const RULES_SOURCE_LABELS: Record<ReviewerRulesSource, string> = {
  template_manual: 'Approved template plus manual rubric',
  guideline_manual: 'Approved guideline pack plus manual rubric',
  call_fields: 'Stored funding call record',
  url_extracted: 'Extracted from the funding call URL',
}
