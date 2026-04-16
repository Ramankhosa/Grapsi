export type DiagramRenderer = 'plantuml' | 'mermaid'

export interface DiagramRendererPolicyInput {
  diagramType?: string
  title?: string
  description?: string
  rendererPreference?: DiagramRenderer | 'auto'
  hasRecentMermaidFailure?: boolean
  hasRecentPlantUMLFailure?: boolean
  specLooksMermaidLike?: boolean
}

export interface DiagramRendererPolicyDecision {
  renderer: DiagramRenderer
  reason: string
  plantUMLRequired: boolean
}

function normalize(value?: string): string {
  return (value || '').toLowerCase().trim()
}

function hasHeavyPunctuationOrMath(text: string): boolean {
  if (!text) return false
  const punctuationMatches = text.match(/[=+\-*/^%<>{}\[\]():;|\\]/g) || []
  const longTokenMatches = text.match(/\b[A-Za-z0-9_]{20,}\b/g) || []
  const mathPattern = /(?:\b\d+\s*[\+\-\*\/]\s*\d+\b|[a-z]\s*=\s*[a-z0-9+\-*/^]+)/i.test(text)
  return punctuationMatches.length >= 14 || longTokenMatches.length >= 3 || mathPattern
}

function isLikelySimpleER(diagramType: string, text: string): boolean {
  if (diagramType !== 'er') return false
  const complexitySignals = /(complex|deep|many-to-many|star schema|snowflake|normalization|polyglot|federated)/i
  return !complexitySignals.test(text)
}

function requestsMermaidExplicitly(text: string, rendererPreference?: string): boolean {
  return rendererPreference === 'mermaid' || /\bmermaid\b/.test(text)
}

function requestsPlantUMLExplicitly(text: string, rendererPreference?: string): boolean {
  return rendererPreference === 'plantuml' || /\bplantuml\b/.test(text)
}

export function chooseDiagramRenderer(input: DiagramRendererPolicyInput): DiagramRendererPolicyDecision {
  const diagramType = normalize(input.diagramType)
  const title = normalize(input.title)
  const description = normalize(input.description)
  const text = `${diagramType} ${title} ${description}`.trim()
  const rendererPreference = normalize(input.rendererPreference)

  const umlIntent = /\b(class|component|usecase|use case|state|activity|uml)\b/.test(text)
  const systemIntent = /\b(architecture|deployment|topology|system overview|pipeline|framework)\b/.test(text)
  const heavySyntax = hasHeavyPunctuationOrMath(text)
  const recentMermaidFailure = !!input.hasRecentMermaidFailure
  const recentPlantUMLFailure = !!input.hasRecentPlantUMLFailure
  const mermaidLikeSpec = !!input.specLooksMermaidLike || /\b(subgraph|flowchart|sequencediagram|erdiagram|statediagram|gantt)\b/.test(text)

  if (requestsMermaidExplicitly(text, rendererPreference)) {
    return {
      renderer: 'mermaid',
      reason: 'User explicitly requested Mermaid.',
      plantUMLRequired: false
    }
  }

  if (requestsPlantUMLExplicitly(text, rendererPreference)) {
    return {
      renderer: 'plantuml',
      reason: 'User explicitly requested PlantUML.',
      plantUMLRequired: true
    }
  }

  if (diagramType === 'gantt') {
    return {
      renderer: 'mermaid',
      reason: 'Gantt diagrams are Mermaid-native and should stay on the Mermaid path.',
      plantUMLRequired: false
    }
  }

  const plantUMLRequired = umlIntent || systemIntent || recentMermaidFailure || heavySyntax
  if (plantUMLRequired) {
    if (recentMermaidFailure) {
      return {
        renderer: 'plantuml',
        reason: 'A recent Mermaid render failure was detected for this case.',
        plantUMLRequired: true
      }
    }
    if (umlIntent) {
      return {
        renderer: 'plantuml',
        reason: 'UML-style intent detected (class/component/usecase/state/activity).',
        plantUMLRequired: true
      }
    }
    if (systemIntent) {
      return {
        renderer: 'plantuml',
        reason: 'System/architecture intent detected where PlantUML is more reliable.',
        plantUMLRequired: true
      }
    }
    return {
      renderer: 'plantuml',
      reason: 'Input appears punctuation/math-heavy or label-heavy; PlantUML chosen for reliability.',
      plantUMLRequired: true
    }
  }

  if (isLikelySimpleER(diagramType, text)) {
    return {
      renderer: 'mermaid',
      reason: 'Simple ER diagram detected; Mermaid erDiagram is preferred.',
      plantUMLRequired: false
    }
  }

  if (mermaidLikeSpec && recentPlantUMLFailure) {
    return {
      renderer: 'mermaid',
      reason: 'Mermaid-like spec detected and PlantUML recently failed for this case.',
      plantUMLRequired: false
    }
  }

  return {
    renderer: 'plantuml',
    reason: 'PlantUML default selected for reliability.',
    plantUMLRequired: false
  }
}
