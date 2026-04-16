import { describe, expect, it } from 'vitest'

import { resolveExportConfigWithSources } from '@/lib/export/export-config-resolver'

describe('export-config-resolver', () => {
  it('applies merge priority as overrides > llm > venue > defaults', () => {
    const resolved = resolveExportConfigWithSources(
      {
        fontFamily: 'Arial',
        fontSizePt: 10,
        fieldConfidences: {
          fontFamily: 0.95,
          fontSizePt: 0.88,
        },
      },
      {
        fontFamily: 'Palatino',
      },
      {
        fontFamily: 'Times New Roman',
        fontSizePt: 12,
        lineSpacing: 2,
      },
    )

    expect(resolved.config.fontFamily).toBe('Palatino')
    expect(resolved.config.fontSizePt).toBe(10)
    expect(resolved.config.lineSpacing).toBe(2)
    expect(resolved.fieldSources.fontFamily).toEqual({ source: 'override', confidence: null })
    expect(resolved.fieldSources.fontSizePt).toEqual({ source: 'llm', confidence: 0.88 })
    expect(resolved.fieldSources.lineSpacing).toEqual({ source: 'default', confidence: null })
  })

  it('falls back cleanly when no llm profile exists', () => {
    const resolved = resolveExportConfigWithSources(
      null,
      {},
      {
        columnLayout: 2,
        pageSize: 'LETTER',
      },
    )

    expect(resolved.config.columnLayout).toBe(2)
    expect(resolved.config.pageSize).toBe('LETTER')
    expect(resolved.fieldSources.columnLayout.source).toBe('default')
    expect(resolved.fieldSources.pageSize.source).toBe('default')
    expect(resolved.fieldSources.fontFamily.source).toBe('default')
  })
})
