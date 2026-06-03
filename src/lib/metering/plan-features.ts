import type { FeatureCode, TaskCode } from './types'

const PLAN_AGNOSTIC_FEATURES = new Set<FeatureCode>()
const QUOTA_EXEMPT_FEATURE_TASKS = new Set<string>([
  'GRANT_PREP:GRANT_PREP_CHAT',
])

export function isPlanAgnosticFeature(featureCode: FeatureCode): boolean {
  return PLAN_AGNOSTIC_FEATURES.has(featureCode)
}

export function isFeatureQuotaExempt(featureCode: FeatureCode, taskCode?: TaskCode | null): boolean {
  return QUOTA_EXEMPT_FEATURE_TASKS.has(`${featureCode}:${taskCode || ''}`)
}
