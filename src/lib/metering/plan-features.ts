import type { FeatureCode } from './types'

const PLAN_AGNOSTIC_FEATURES = new Set<FeatureCode>()

export function isPlanAgnosticFeature(featureCode: FeatureCode): boolean {
  return PLAN_AGNOSTIC_FEATURES.has(featureCode)
}
