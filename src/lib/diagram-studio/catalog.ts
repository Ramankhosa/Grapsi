/**
 * Grant Diagram Studio — recommendation catalog.
 *
 * Maps grant sections (by key/label heuristics) to the diagram kinds that
 * strengthen them, with default titles and generation hints.
 */

import type { DiagramStudioKind } from './spec-types'

export interface DiagramRecommendation {
  kind: DiagramStudioKind
  label: string
  defaultTitle: string
  hint: string
}

export const DIAGRAM_KIND_LABELS: Record<DiagramStudioKind, string> = {
  gantt: 'Gantt chart',
  flowchart: 'Flowchart',
  logic_model: 'Logic model',
  chart: 'Chart',
  plot: 'Statistical plot',
  sketch: 'Concept sketch',
  freeform: 'Freeform diagram',
}

interface CatalogRule {
  pattern: RegExp
  recommendations: DiagramRecommendation[]
}

const CATALOG_RULES: CatalogRule[] = [
  {
    pattern: /work\s*plan|workplan|timeline|milestone|schedule|deliverable|implementation\s+plan/i,
    recommendations: [
      {
        kind: 'gantt',
        label: 'Workplan Gantt',
        defaultTitle: 'Project Workplan and Milestones',
        hint: 'Work packages, tasks with month ranges, and key milestones from the workplan.',
      },
      {
        kind: 'flowchart',
        label: 'Deliverable map',
        defaultTitle: 'Work Package Dependencies',
        hint: 'How work packages and deliverables feed each other.',
      },
    ],
  },
  {
    pattern: /method|approach|design|procedure|technical|research\s+plan/i,
    recommendations: [
      {
        kind: 'flowchart',
        label: 'Methodology flow',
        defaultTitle: 'Methodology Overview',
        hint: 'The end-to-end research/implementation workflow with decision points.',
      },
      {
        kind: 'sketch',
        label: 'Concept figure',
        defaultTitle: 'Conceptual Framework',
        hint: 'An illustrative overview figure of the proposed system or study design.',
      },
    ],
  },
  {
    pattern: /impact|outcome|benefit|dissemination|exploitation/i,
    recommendations: [
      {
        kind: 'logic_model',
        label: 'Logic model',
        defaultTitle: 'Impact Pathway',
        hint: 'Inputs, activities, outputs, outcomes, and long-term impact.',
      },
    ],
  },
  {
    pattern: /objective|aim|goal|purpose/i,
    recommendations: [
      {
        kind: 'flowchart',
        label: 'Aims framework',
        defaultTitle: 'Objectives and Their Relationships',
        hint: 'How specific objectives build toward the overall goal.',
      },
    ],
  },
  {
    pattern: /budget|cost|financial|funding\s+request/i,
    recommendations: [
      {
        kind: 'chart',
        label: 'Budget chart',
        defaultTitle: 'Budget Distribution',
        hint: 'Cost categories or per-year budget breakdown. Uses only figures present in the section.',
      },
    ],
  },
  {
    pattern: /team|consortium|partner|personnel|management|governance/i,
    recommendations: [
      {
        kind: 'flowchart',
        label: 'Team structure',
        defaultTitle: 'Project Team and Governance',
        hint: 'Roles, partners, and reporting/coordination lines.',
      },
    ],
  },
  {
    pattern: /risk|contingency|sustainability|mitigation/i,
    recommendations: [
      {
        kind: 'flowchart',
        label: 'Risk & mitigation',
        defaultTitle: 'Risk Management Approach',
        hint: 'Key risks, their triggers, and mitigation paths.',
      },
    ],
  },
  {
    pattern: /evaluation|assessment|monitoring|quality|kpi/i,
    recommendations: [
      {
        kind: 'flowchart',
        label: 'Evaluation logic',
        defaultTitle: 'Evaluation and Monitoring Framework',
        hint: 'What is measured, when, and how results feed back.',
      },
      {
        kind: 'chart',
        label: 'KPI targets',
        defaultTitle: 'Key Performance Targets',
        hint: 'Target indicators as a chart. Uses only figures present in the section.',
      },
    ],
  },
  {
    pattern: /problem|need|background|state\s+of\s+the\s+art|significance|context/i,
    recommendations: [
      {
        kind: 'sketch',
        label: 'Problem illustration',
        defaultTitle: 'Problem and Opportunity',
        hint: 'An illustrative figure contrasting the current gap with the proposed solution.',
      },
    ],
  },
]

const GENERIC_RECOMMENDATIONS: DiagramRecommendation[] = [
  {
    kind: 'flowchart',
    label: 'Flowchart',
    defaultTitle: 'Process Overview',
    hint: 'A process or relationship diagram grounded in this section.',
  },
]

export function recommendDiagramsForSection(params: {
  sectionKey: string
  label: string
}): DiagramRecommendation[] {
  const haystack = `${params.sectionKey} ${params.label}`
  const seen = new Set<string>()
  const results: DiagramRecommendation[] = []
  for (const rule of CATALOG_RULES) {
    if (rule.pattern.test(haystack)) {
      for (const rec of rule.recommendations) {
        if (!seen.has(rec.kind + rec.label)) {
          seen.add(rec.kind + rec.label)
          results.push(rec)
        }
      }
    }
  }
  return results.length > 0 ? results : GENERIC_RECOMMENDATIONS
}
