import { describe, expect, it } from 'vitest'

import { buildStrictSourceOnlyFigureSuggestionRequest } from '../llm-figure-service'

describe('buildStrictSourceOnlyFigureSuggestionRequest', () => {
  it('removes broad paper context and keeps only the selected section', () => {
    const request = buildStrictSourceOnlyFigureSuggestionRequest({
      paperTitle: 'Broad project title that should not reach the prompt',
      paperAbstract: 'Abstract content that should not reach the prompt.',
      researchType: 'grant proposal',
      datasetDescription: 'Dataset description that should not reach the prompt.',
      sections: {
        methodology: 'Selected methodology workflow content.',
        impact: 'Impact content that should not reach the prompt.'
      },
      sectionScope: { mode: 'selected_sections', sectionKeys: ['methodology'] },
      sourceSections: [{ sectionKey: 'methodology', label: 'Methodology' }],
      paperBlueprint: {
        thesisStatement: 'Blueprint thesis that should not reach the prompt.',
        centralObjective: 'Blueprint objective that should not reach the prompt.',
        keyContributions: ['Hidden contribution'],
        sectionPlan: [{ sectionKey: 'methodology', mustCover: ['Hidden constraint'] }]
      },
      existingFigures: [{ title: 'Existing figure that should not reach the prompt', type: 'gantt' }]
    })

    expect(request.paperTitle).toBeUndefined()
    expect(request.paperAbstract).toBeUndefined()
    expect(request.researchType).toBeUndefined()
    expect(request.datasetDescription).toBeUndefined()
    expect(request.paperBlueprint).toBeUndefined()
    expect(request.existingFigures).toEqual([])
    expect(request.sections).toEqual({ methodology: 'Selected methodology workflow content.' })
    expect(request.sourceSections).toEqual([{ sectionKey: 'methodology', label: 'Methodology' }])
  })

  it('uses only highlighted focus text when a selected excerpt is provided', () => {
    const request = buildStrictSourceOnlyFigureSuggestionRequest({
      sections: {
        methodology: 'Full section content that should not reach the prompt.'
      },
      sectionScope: { mode: 'selected_sections', sectionKeys: ['methodology'] },
      sourceSections: [{ sectionKey: 'methodology', label: 'Methodology' }],
      focusText: 'Highlighted workflow excerpt only.',
      focusSection: 'methodology',
      focusMode: 'selection'
    })

    expect(request.sections).toEqual({ methodology: 'Highlighted workflow excerpt only.' })
    expect(request.sourceSections).toEqual([{ sectionKey: 'methodology', label: 'Methodology' }])
    expect(request.sectionScope).toEqual({ mode: 'selected_sections', sectionKeys: ['methodology'] })
  })
})
