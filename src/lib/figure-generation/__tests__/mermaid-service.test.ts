import { describe, expect, it } from 'vitest'

import { buildFullMermaidCode, hasMermaidDiagramDeclaration } from '../mermaid-service'

describe('mermaid service declaration handling', () => {
  it('recognizes gantt declarations as already complete Mermaid code', () => {
    const code = `gantt
dateFormat YYYY-MM-DD
section Planning
Literature Review :a1, 2024-01-05, 2024-02-02`

    expect(hasMermaidDiagramDeclaration(code)).toBe(true)

    const fullCode = buildFullMermaidCode({
      diagramType: 'gantt',
      code,
    })

    expect(fullCode).toBe(code)
    expect((fullCode.match(/^gantt$/gm) || []).length).toBe(1)
  })

  it('preserves init directives and avoids inserting a duplicate gantt declaration', () => {
    const code = `%%{init: {'theme': 'default'}}%%
gantt
dateFormat YYYY-MM-DD
section Delivery
Implementation :a1, 2024-03-01, 2024-03-14`

    const fullCode = buildFullMermaidCode({
      diagramType: 'gantt',
      code,
    })

    expect(fullCode).toBe(code)
    expect((fullCode.match(/^gantt$/gm) || []).length).toBe(1)
  })

  it('inserts the missing declaration after Mermaid preamble when needed', () => {
    const code = `%%{init: {'theme': 'neutral'}}%%
dateFormat YYYY-MM-DD
section Planning
Literature Review :a1, 2024-01-05, 2024-02-02`

    const fullCode = buildFullMermaidCode({
      diagramType: 'gantt',
      code,
    })

    expect(fullCode).toContain(`%%{init: {'theme': 'neutral'}}%%
gantt`)
    expect((fullCode.match(/^gantt$/gm) || []).length).toBe(1)
  })
})
