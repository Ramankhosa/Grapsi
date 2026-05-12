import { describe, expect, it } from 'vitest'

import {
  buildSectionLabelEvidenceForSources,
  buildWorkplanCombinationSuggestion,
  inferVisualIntentFromSectionLabel,
  summarizeSectionLabelCombinations,
} from '../llm-figure-service'

describe('section-label-aware figure planning helpers', () => {
  it('uses LLM-generated labels to distinguish identical section keys', () => {
    expect(inferVisualIntentFromSectionLabel('custom_section', 'Methodology')).toBe('method_workflow')
    expect(inferVisualIntentFromSectionLabel('custom_section', 'Impact Pathway')).toBe('impact_pathway')
    expect(inferVisualIntentFromSectionLabel('custom_section', 'Evaluation Plan')).toBe('evaluation_logic')
  })

  it('detects methodology, deliverables, and timeline label combinations', () => {
    const evidence = buildSectionLabelEvidenceForSources([
      { sectionKey: 'section_1', label: 'Methodology and Work Packages' },
      { sectionKey: 'section_2', label: 'Deliverables and Outputs' },
      { sectionKey: 'section_3', label: 'Project Timeline and Milestones' },
    ])

    expect(evidence.map((entry) => entry.interpretedIntent)).toEqual([
      'method_workflow',
      'deliverable_map',
      'workplan_timeline',
    ])
    expect(summarizeSectionLabelCombinations(evidence).join(' ')).toMatch(/Gantt\/workplan/i)
  })

  it('builds a Gantt workplan suggestion for methodology plus deliverables plus timeline labels', () => {
    const sourceSections = [
      { sectionKey: 'method', label: 'Methodology' },
      { sectionKey: 'outputs', label: 'Deliverables' },
      { sectionKey: 'duration', label: 'Project Duration and Timeline' },
    ]
    const evidence = buildSectionLabelEvidenceForSources(sourceSections, {
      method: 'PRA mobilization, app development, validation, and training.',
      outputs: 'Five hubs, certified youth brokers, validated IKS corpus.',
      duration: 'The project runs for 36 months across three annual phases.',
    })

    const suggestion = buildWorkplanCombinationSuggestion({
      sections: {},
      sourceSections,
    }, evidence)

    expect(suggestion?.category).toBe('DIAGRAM')
    expect(suggestion?.suggestedType).toBe('gantt')
    expect(suggestion?.rendererPreference).toBe('mermaid')
    expect(suggestion?.diagramSpec?.workplanSpec?.timeScale).toBe('relative_months')
    expect(suggestion?.sectionLabelEvidence?.map((entry) => entry.label)).toEqual([
      'Methodology',
      'Deliverables',
      'Project Duration and Timeline',
    ])
  })
})
