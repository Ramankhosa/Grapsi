import { describe, expect, it } from 'vitest'
import { chooseDiagramRenderer } from '@/lib/figure-generation/diagram-renderer-policy'

describe('chooseDiagramRenderer', () => {
  it('prefers PlantUML for UML-ish intents', () => {
    const decision = chooseDiagramRenderer({
      diagramType: 'class',
      description: 'Create a class diagram for domain entities and relationships.'
    })
    expect(decision.renderer).toBe('plantuml')
  })

  it('prefers PlantUML for architecture/system intents', () => {
    const decision = chooseDiagramRenderer({
      diagramType: 'architecture',
      description: 'System overview pipeline across services and framework modules.'
    })
    expect(decision.renderer).toBe('plantuml')
  })

  it('uses Mermaid when explicitly requested', () => {
    const decision = chooseDiagramRenderer({
      diagramType: 'flowchart',
      description: 'Please generate this in Mermaid.',
      rendererPreference: 'auto'
    })
    expect(decision.renderer).toBe('mermaid')
  })

  it('uses Mermaid for gantt diagrams by default', () => {
    const decision = chooseDiagramRenderer({
      diagramType: 'gantt',
      description: 'Project phases and milestones by month.'
    })
    expect(decision.renderer).toBe('mermaid')
  })

  it('keeps gantt diagrams on Mermaid even when the description sounds system-like', () => {
    const decision = chooseDiagramRenderer({
      diagramType: 'gantt',
      description: 'System rollout timeline across services, gateway, and deployment milestones.'
    })
    expect(decision.renderer).toBe('mermaid')
  })

  it('uses Mermaid for Mermaid-like specs only after recent PlantUML failure', () => {
    const decision = chooseDiagramRenderer({
      diagramType: 'flowchart',
      description: 'Need subgraph clusters for ingestion and output blocks.',
      specLooksMermaidLike: true,
      hasRecentPlantUMLFailure: true
    })
    expect(decision.renderer).toBe('mermaid')
  })
})
