import { describe, expect, it } from 'vitest'

import {
  buildCanvasComplianceRules,
  buildJournalQualityStandards,
  describeCanvasShape,
} from '../paper-sketch-service'

describe('paper sketch prompt guidance', () => {
  it('describes wide landscape canvases explicitly', () => {
    expect(describeCanvasShape('16:9')).toContain('wide landscape')
    expect(describeCanvasShape('3:1')).toContain('ultra-wide')
  })

  it('builds hard canvas compliance instructions from render directives', () => {
    const rules = buildCanvasComplianceRules({
      aspectRatio: '16:9',
      fillCanvasPercentMin: 85,
      whitespaceMaxPercent: 15,
    })

    expect(rules).toContain('CANVAS COMPLIANCE RULES (HARD)')
    expect(rules).toContain('aspect ratio 16:9')
    expect(rules).toContain('at least 85%')
    expect(rules).toContain('below 15%')
    expect(rules).toContain('Do not place a small central illustration inside a larger blank canvas')
  })

  it('builds journal-grade standards that enforce top-tier scientific figure aesthetics', () => {
    const rules = buildJournalQualityStandards('technical', {
      textPolicy: { maxLabelsTotal: 10, maxWordsPerLabel: 4 },
      stylePolicy: { paletteMode: 'academic_muted' },
      compositionPolicy: { layoutMode: 'STRIP', equalPanels: true, noTextOutsidePanels: true },
    })

    expect(rules).toContain('JOURNAL-GRADE QUALITY BAR (HARD)')
    expect(rules).toContain('color-blind-safe academic palette')
    expect(rules).toContain('printed small or viewed in grayscale')
    expect(rules).toContain('journal column/page figure size')
    expect(rules).toContain('Style mode TECHNICAL')
    expect(rules).toContain('engineering-diagram precision')
  })
})
