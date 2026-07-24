import { normalizeBucketKey } from '@/lib/reviewer/buckets'

type JsonRecord = Record<string, unknown>

export interface ReviewerManualRubric {
  evaluationCriteria: string[]
  reviewerSignals: string[]
  mustAddress: string[]
  avoid: string[]
  formatRules: string[]
  sectionOverrides: Record<string, Partial<Omit<ReviewerManualRubric, 'sectionOverrides' | 'mappingOverrides'>>>
  mappingOverrides: Record<string, string>
}

export const EMPTY_MANUAL_RUBRIC: ReviewerManualRubric = {
  evaluationCriteria: [],
  reviewerSignals: [],
  mustAddress: [],
  avoid: [],
  formatRules: [],
  sectionOverrides: {},
  mappingOverrides: {},
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean)
  const text = asString(value)
  return text ? [text] : []
}

/**
 * The manual rubric is operator-authored JSON layered on top of whatever rules
 * the call itself provides. Everything is optional; unknown keys are dropped.
 */
export function normalizeManualRubric(value: unknown): ReviewerManualRubric {
  const record = asObject(value)
  const sectionOverridesRecord = asObject(record.sectionOverrides)
  const sectionOverrides: ReviewerManualRubric['sectionOverrides'] = {}

  for (const [bucketKey, overrideValue] of Object.entries(sectionOverridesRecord)) {
    const override = asObject(overrideValue)
    sectionOverrides[bucketKey] = {
      evaluationCriteria: asStringArray(override.evaluationCriteria),
      reviewerSignals: asStringArray(override.reviewerSignals),
      mustAddress: asStringArray(override.mustAddress),
      avoid: asStringArray(override.avoid),
      formatRules: asStringArray(override.formatRules),
    }
  }

  const mappingOverridesRecord = asObject(record.mappingOverrides)
  const mappingOverrides: Record<string, string> = {}
  for (const [sectionKey, bucketKey] of Object.entries(mappingOverridesRecord)) {
    const normalizedSectionKey = asString(sectionKey)
    const normalizedBucketKey = normalizeBucketKey(asString(bucketKey))
    if (normalizedSectionKey && normalizedBucketKey) {
      mappingOverrides[normalizedSectionKey] = normalizedBucketKey
    }
  }

  return {
    evaluationCriteria: asStringArray(record.evaluationCriteria),
    reviewerSignals: asStringArray(record.reviewerSignals),
    mustAddress: asStringArray(record.mustAddress),
    avoid: asStringArray(record.avoid),
    formatRules: asStringArray(record.formatRules),
    sectionOverrides,
    mappingOverrides,
  }
}
