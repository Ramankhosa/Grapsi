export const FUNDING_BATCH_SOURCE_KEYS = ['source_1', 'source_2', 'source_3'] as const

export type FundingBatchSourceKey = typeof FUNDING_BATCH_SOURCE_KEYS[number]

export function isFundingBatchSourceKey(value: string): value is FundingBatchSourceKey {
  return (FUNDING_BATCH_SOURCE_KEYS as readonly string[]).includes(value)
}

export const FUNDING_INTAKE_DOCUMENT_KINDS = ['call_document', 'guideline_document', 'template_document'] as const

export type FundingIntakeSourceDocumentKind = typeof FUNDING_INTAKE_DOCUMENT_KINDS[number]

export function isFundingIntakeDocumentKind(value: unknown): value is FundingIntakeSourceDocumentKind {
  return typeof value === 'string' && (FUNDING_INTAKE_DOCUMENT_KINDS as readonly string[]).includes(value)
}

/**
 * Record a source's resolved document role on its fetch metadata.
 *
 * JSON and CSV intake keep `json_upload` / `json_artifacts` (the imported
 * template, guideline pack and document URLs) in this same blob, so the merge
 * must preserve every existing key. Non-object values — including
 * `Prisma.JsonNull` for sources that carry no metadata yet — start from empty.
 */
export function stampSourceDocumentKind(
  metadata: unknown,
  documentKind: FundingIntakeSourceDocumentKind
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}
  return { ...base, document_kind: documentKind }
}

export function resolveBatchSourceAssignments(input: {
  sources: Array<{ sourceKey: string; documentKind?: string | null }>
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

  const kindBySourceKey = new Map<string, string | null>()
  for (const source of input.sources) {
    const rawKind = source.documentKind ? String(source.documentKind).trim() : ''
    if (rawKind && !isFundingIntakeDocumentKind(rawKind)) {
      throw new Error(`Invalid document kind for ${source.sourceKey}: ${rawKind}`)
    }
    kindBySourceKey.set(String(source.sourceKey || '').trim(), rawKind || null)
  }
  const firstKeyWithKind = (kind: FundingIntakeSourceDocumentKind) =>
    sourceKeys.find((key) => kindBySourceKey.get(key) === kind) || ''

  const detailsSourceKey = String(input.detailsSourceKey || '').trim() || firstKeyWithKind('call_document')
  if (!detailsSourceKey) {
    throw new Error('detailsSourceKey is required')
  }
  if (!uniqueKeys.has(detailsSourceKey)) {
    throw new Error(`source key ${detailsSourceKey} does not exist`)
  }
  const detailsKind = kindBySourceKey.get(detailsSourceKey)
  if (detailsKind && detailsKind !== 'call_document') {
    throw new Error('The details source must be a call document')
  }

  const guidelinesSourceKey =
    String(input.guidelinesSourceKey || '').trim() || firstKeyWithKind('guideline_document') || detailsSourceKey
  const templateSourceKey =
    String(input.templateSourceKey || '').trim() || firstKeyWithKind('template_document') || detailsSourceKey

  for (const sourceKey of [guidelinesSourceKey, templateSourceKey]) {
    if (!isFundingBatchSourceKey(sourceKey)) {
      throw new Error(`Invalid source key: ${sourceKey}`)
    }
    if (!uniqueKeys.has(sourceKey)) {
      throw new Error(`source key ${sourceKey} does not exist`)
    }
  }

  // Every source ends up with a document role: explicit tag first, otherwise
  // derived from the slot it was assigned to, otherwise an additional call doc.
  const documentKinds: Record<string, FundingIntakeSourceDocumentKind> = {}
  for (const sourceKey of sourceKeys) {
    const explicit = kindBySourceKey.get(sourceKey)
    documentKinds[sourceKey] = (explicit as FundingIntakeSourceDocumentKind | null)
      || (sourceKey === guidelinesSourceKey && sourceKey !== detailsSourceKey
        ? 'guideline_document'
        : sourceKey === templateSourceKey && sourceKey !== detailsSourceKey
          ? 'template_document'
          : 'call_document')
  }

  return {
    detailsSourceKey,
    guidelinesSourceKey,
    templateSourceKey,
    documentKinds,
  }
}
