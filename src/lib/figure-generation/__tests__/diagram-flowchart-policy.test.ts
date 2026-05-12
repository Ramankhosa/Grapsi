import { describe, expect, it } from 'vitest'

import { chooseDiagramRenderer } from '../diagram-renderer-policy'
import {
  buildFallbackSpecFromDescription,
  normalizeMermaidTemplateType,
  normalizePlantUMLTemplateType,
} from '../llm-figure-service'

describe('flowchart diagram generation policy', () => {
  it('keeps ordinary flowcharts on the Mermaid path for vertical process layouts', () => {
    const decision = chooseDiagramRenderer({
      diagramType: 'flowchart',
      title: 'Year 1 documentation workflow',
      description: 'Document oral histories, validate narratives, train stewards, and publish outputs.',
    })

    expect(decision.renderer).toBe('mermaid')
    expect(decision.plantUMLRequired).toBe(false)
    expect(decision.reason).toMatch(/stay vertical/i)
  })

  it('maps PlantUML flowchart fallback to activity rather than architecture', () => {
    expect(normalizePlantUMLTemplateType('flowchart').templateType).toBe('activity')
  })

  it('marks non-topology Mermaid flowcharts as process flows', () => {
    const selection = normalizeMermaidTemplateType('flowchart', 'consent, documentation, validation, publication')

    expect(selection.templateType).toBe('flowchart')
    expect(selection.flowchartVariant).toBe('process')
  })

  it('builds source-grounded vertical fallback specs from selected grant text', () => {
    const spec = buildFallbackSpecFromDescription(
      `DRAFT CONTEXT:
Selected draft content only:
Document oral histories with consent. Validate narratives with community elders. Train youth stewards. Publish IKS database outputs.

FIGURE REQUEST:
Create a flowchart for the selected methodology.`,
      'Year 1 documentation workflow'
    )

    const labels = (spec.nodes || []).map((node) => node.label)

    expect(spec.layout).toBe('TD')
    expect(spec.composition).toBe('short_procedure')
    expect(labels.join(' ')).toMatch(/Document oral histories/i)
    expect(labels.join(' ')).toMatch(/Validate narratives/i)
    expect(labels.join(' ')).not.toMatch(/Input Stage|Processing Stage|Output Stage/i)
  })
})
