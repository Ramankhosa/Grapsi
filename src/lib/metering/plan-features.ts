import type { FeatureCode, TaskCode } from './types'

const PLAN_AGNOSTIC_FEATURES = new Set<FeatureCode>([
  'FUNDING_DISCOVERY',
  'GRANT_PREP',
  'GRANT_DRAFTING',
])
const QUOTA_EXEMPT_FEATURE_TASKS = new Set<string>([
  'GRANT_PREP:GRANT_PREP_CHAT',
  'GRANT_PREP:GRANT_BLUEPRINT_GENERATE',
  'GRANT_DRAFTING:GRANT_SECTION_GENERATE',
])

export function isPlanAgnosticFeature(featureCode: FeatureCode): boolean {
  return PLAN_AGNOSTIC_FEATURES.has(featureCode)
}

export function isFeatureQuotaExempt(featureCode: FeatureCode, taskCode?: TaskCode | null): boolean {
  return QUOTA_EXEMPT_FEATURE_TASKS.has(`${featureCode}:${taskCode || ''}`)
}
