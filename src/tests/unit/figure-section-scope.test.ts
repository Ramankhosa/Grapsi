import { describe, expect, it } from 'vitest'

import {
  buildFigureSuggestionSectionScopeError,
  buildSingleFigureSuggestionSectionScopeError,
  resolveFigureSuggestionSectionScope
} from '@/lib/figure-generation/section-scope'

describe('figure suggestion section scope', () => {
  it('filters selected sections to the requested non-empty section keys', () => {
    const resolved = resolveFigureSuggestionSectionScope(
      {
        workplan: 'Work package timeline and milestones.',
        impact: 'Impact pathway and expected outcomes.',
        budget: 'Budget notes.'
      },
      { mode: 'selected_sections', sectionKeys: ['impact', 'workplan'] },
      { workplan: 'Workplan', impact: 'Impact' }
    )

    expect(resolved.mode).toBe('selected_sections')
    expect(Object.keys(resolved.sections)).toEqual(['workplan', 'impact'])
    expect(resolved.sourceSections).toEqual([
      { sectionKey: 'workplan', label: 'Workplan' },
      { sectionKey: 'impact', label: 'Impact' }
    ])
    expect(buildFigureSuggestionSectionScopeError(resolved)).toBeUndefined()
    expect(buildSingleFigureSuggestionSectionScopeError(resolved)).toBe('Select exactly one source section before requesting figure suggestions.')
  })

  it('allows the one-section figure suggestion contract', () => {
    const resolved = resolveFigureSuggestionSectionScope(
      {
        methodology: 'Workflow and implementation plan.',
        impact: 'Impact pathway and expected outcomes.'
      },
      { mode: 'selected_sections', sectionKeys: ['methodology'] },
      { methodology: 'Methodology' }
    )

    expect(resolved.mode).toBe('selected_sections')
    expect(Object.keys(resolved.sections)).toEqual(['methodology'])
    expect(resolved.sourceSections).toEqual([{ sectionKey: 'methodology', label: 'Methodology' }])
    expect(buildFigureSuggestionSectionScopeError(resolved)).toBeUndefined()
    expect(buildSingleFigureSuggestionSectionScopeError(resolved)).toBeUndefined()
  })

  it('keeps full draft behavior by including every non-empty section', () => {
    const resolved = resolveFigureSuggestionSectionScope(
      {
        introduction: 'Problem and rationale.',
        methodology: 'Method pipeline.',
        empty: '   '
      },
      { mode: 'full_draft' }
    )

    expect(resolved.mode).toBe('full_draft')
    expect(Object.keys(resolved.sections)).toEqual(['introduction', 'methodology'])
    expect(resolved.sourceSections.map((section) => section.sectionKey)).toEqual(['introduction', 'methodology'])
    expect(buildFigureSuggestionSectionScopeError(resolved)).toBeUndefined()
  })

  it('reports invalid or empty selected sections cleanly', () => {
    const missing = resolveFigureSuggestionSectionScope(
      { workplan: 'Milestones.' },
      { mode: 'selected_sections', sectionKeys: ['impact'] }
    )
    expect(buildFigureSuggestionSectionScopeError(missing)).toBe('Selected source sections were not found in this draft.')

    const empty = resolveFigureSuggestionSectionScope(
      { workplan: '   ' },
      { mode: 'selected_sections', sectionKeys: ['workplan'] }
    )
    expect(buildFigureSuggestionSectionScopeError(empty)).toBe('Selected source sections do not contain draft text yet.')
  })
})
