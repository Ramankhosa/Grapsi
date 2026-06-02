export const FUNDING_BATCH_SOURCE_KEYS = ['source_1', 'source_2', 'source_3'] as const

export type FundingBatchSourceKey = typeof FUNDING_BATCH_SOURCE_KEYS[number]

export function isFundingBatchSourceKey(value: string): value is FundingBatchSourceKey {
  return (FUNDING_BATCH_SOURCE_KEYS as readonly string[]).includes(value)
}

export function resolveBatchSourceAssignments(input: {
  sources: Array<{ sourceKey: string }>
  detailsSourceKey?: string | null
  guidelinesSourceKey?: string | null
  templateSourceKey?: string | null
}) {
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error('At least one source is required')
  }
  if (input.sources.length > FUNDING_BATCH_SOURCE_KEYS.length) {
    throw new Error('A funding call can include at most 3 sources')
  }

  const sourceKeys = input.sources.map((source) => String(source.sourceKey || '').trim())
  const uniqueKeys = new Set(sourceKeys)
  if (uniqueKeys.size !== sourceKeys.length) {
    throw new Error('Source keys must be unique')
  }

  for (const sourceKey of sourceKeys) {
    if (!isFundingBatchSourceKey(sourceKey)) {
      throw new Error(`Invalid source key: ${sourceKey}`)
    }
  }

  const detailsSourceKey = String(input.detailsSourceKey || '').trim()
  if (!detailsSourceKey) {
    throw new Error('detailsSourceKey is required')
  }
  if (!uniqueKeys.has(detailsSourceKey)) {
    throw new Error(`source key ${detailsSourceKey} does not exist`)
  }

  const guidelinesSourceKey = String(input.guidelinesSourceKey || '').trim() || detailsSourceKey
  const templateSourceKey = String(input.templateSourceKey || '').trim() || detailsSourceKey

  for (const sourceKey of [guidelinesSourceKey, templateSourceKey]) {
    if (!isFundingBatchSourceKey(sourceKey)) {
      throw new Error(`Invalid source key: ${sourceKey}`)
    }
    if (!uniqueKeys.has(sourceKey)) {
      throw new Error(`source key ${sourceKey} does not exist`)
    }
  }

  return {
    detailsSourceKey,
    guidelinesSourceKey,
    templateSourceKey,
  }
}
