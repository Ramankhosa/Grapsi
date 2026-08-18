import type { FeatureCode, TaskCode } from './types'

const PLAN_AGNOSTIC_FEATURES = new Set<FeatureCode>([
  'FUNDING_DISCOVERY',
  'FUNDING_CHAT',
  'FUNDING_INTELLIGENCE',
  'GRANT_PREP',
  'GRANT_DRAFTING',
])
/**
 * Individual LLM calls that are not metered against a plan feature, because the
 * unit the tenant is billed for is the run, not the call: a funding chat turn,
 * an idea analysis, or a grant section. Those runs are counted and enforced in
 * `ServiceCompletionUsage` (see `service-usage-tracker.ts`).
 */
const QUOTA_EXEMPT_FEATURE_TASKS = new Set<string>([
  'GRANT_PREP:GRANT_PREP_CHAT',
  'GRANT_PREP:GRANT_BLUEPRINT_GENERATE',
  'GRANT_DRAFTING:GRANT_SECTION_GENERATE',
  'FUNDING_CHAT:FUNDING_CHAT',
  'FUNDING_INTELLIGENCE:IDEA_INTELLIGENCE',
  'FUNDING_DISCOVERY:FUNDING_CALL_INGEST',
  'FUNDING_DISCOVERY:FUNDING_TEMPLATE_EXTRACT',
  'FUNDING_DISCOVERY:FUNDING_GUIDELINE_EXTRACT',
])

export function isPlanAgnosticFeature(featureCode: FeatureCode): boolean {
  return PLAN_AGNOSTIC_FEATURES.has(featureCode)
}

export function isFeatureQuotaExempt(featureCode: FeatureCode, taskCode?: TaskCode | null): boolean {
  return QUOTA_EXEMPT_FEATURE_TASKS.has(`${featureCode}:${taskCode || ''}`)
}
