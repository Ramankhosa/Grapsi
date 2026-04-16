export type FigureSequenceItemType = 'diagram' | 'sketch'

export interface FigureSequenceItemInput {
  id: string
  type: FigureSequenceItemType
  sourceId: string
  finalFigNo?: number
}

export interface AvailableFigure {
  id: string
  type: FigureSequenceItemType
  sourceId: string
}

export interface NormalizeFigureSequenceResult {
  normalized: Array<{ id: string; type: FigureSequenceItemType; sourceId: string; finalFigNo: number }>
  meta: {
    droppedUnknownCount: number
    droppedTypeMismatchCount: number
    droppedSourceMismatchCount: number
    dedupedCount: number
    appendedMissingCount: number
  }
}

function isValidType(value: unknown): value is FigureSequenceItemType {
  return value === 'diagram' || value === 'sketch'
}

/**
 * Normalize a proposed sequence against the actual set of figures available in a session.
 *
 * Guarantees:
 * - Output contains each available figure exactly once
 * - Output has sequential finalFigNo starting at 1
 * - Unknown/mismatched items from input are dropped
 * - Missing available figures are appended at the end (stable order by availableFigures input)
 */
export function normalizeFigureSequence(
  input: unknown,
  availableFigures: AvailableFigure[]
): NormalizeFigureSequenceResult {
  const byId = new Map<string, AvailableFigure>()
  for (const f of availableFigures) {
    if (f?.id && typeof f.id === 'string') byId.set(f.id, f)
  }

  const meta = {
    droppedUnknownCount: 0,
    droppedTypeMismatchCount: 0,
    droppedSourceMismatchCount: 0,
    dedupedCount: 0,
    appendedMissingCount: 0
  }

  const normalizedOrder: AvailableFigure[] = []
  const seen = new Set<string>()

  const items: any[] = Array.isArray(input) ? input : []
  for (const item of items) {
    const id = item?.id
    if (typeof id !== 'string' || !id.trim()) continue

    if (seen.has(id)) {
      meta.dedupedCount++
      continue
    }

    const actual = byId.get(id)
    if (!actual) {
      meta.droppedUnknownCount++
      continue
    }

    const type = item?.type
    if (!isValidType(type) || type !== actual.type) {
      meta.droppedTypeMismatchCount++
      continue
    }

    const sourceId = item?.sourceId
    if (typeof sourceId !== 'string' || sourceId !== actual.sourceId) {
      meta.droppedSourceMismatchCount++
      continue
    }

    seen.add(id)
    normalizedOrder.push(actual)
  }

  for (const f of availableFigures) {
    if (!seen.has(f.id)) {
      meta.appendedMissingCount++
      normalizedOrder.push(f)
      seen.add(f.id)
    }
  }

  const normalized = normalizedOrder.map((f, idx) => ({
    id: f.id,
    type: f.type,
    sourceId: f.sourceId,
    finalFigNo: idx + 1
  }))

  return { normalized, meta }
}


