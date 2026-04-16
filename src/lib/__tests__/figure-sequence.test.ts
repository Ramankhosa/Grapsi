import { describe, expect, test } from 'vitest'
import { normalizeFigureSequence } from '@/lib/figure-sequence'

describe('figure-sequence', () => {
  test('normalizes to include all available figures exactly once', () => {
    const available = [
      { id: 'diagram-1', type: 'diagram' as const, sourceId: 'fp1' },
      { id: 'sketch-a', type: 'sketch' as const, sourceId: 'a' },
      { id: 'diagram-2', type: 'diagram' as const, sourceId: 'fp2' },
    ]

    const input = [
      { id: 'diagram-2', type: 'diagram', sourceId: 'fp2', finalFigNo: 99 },
      { id: 'diagram-2', type: 'diagram', sourceId: 'fp2' }, // dup
      { id: 'sketch-a', type: 'diagram', sourceId: 'a' }, // wrong type
      { id: 'unknown', type: 'diagram', sourceId: 'x' }, // unknown
    ]

    const result = normalizeFigureSequence(input, available)
    expect(result.normalized.map(s => s.id)).toEqual(['diagram-2', 'diagram-1', 'sketch-a'])
    expect(result.normalized.map(s => s.finalFigNo)).toEqual([1, 2, 3])
    expect(result.meta.dedupedCount).toBe(1)
    expect(result.meta.droppedUnknownCount).toBe(1)
    expect(result.meta.droppedTypeMismatchCount).toBe(1)
    expect(result.meta.appendedMissingCount).toBe(2)
  })

  test('drops sourceId mismatches to prevent spoofing', () => {
    const available = [
      { id: 'diagram-1', type: 'diagram' as const, sourceId: 'fp1' },
    ]
    const input = [
      { id: 'diagram-1', type: 'diagram', sourceId: 'fp999' },
    ]
    const result = normalizeFigureSequence(input, available)
    expect(result.normalized).toEqual([{ id: 'diagram-1', type: 'diagram', sourceId: 'fp1', finalFigNo: 1 }])
    expect(result.meta.droppedSourceMismatchCount).toBe(1)
    expect(result.meta.appendedMissingCount).toBe(1)
  })
})


