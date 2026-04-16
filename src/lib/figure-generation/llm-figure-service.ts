/**
 * LLM-Powered Figure Generation Service
 * 
 * Uses configured LLM models (via Super Admin) to generate:
 * - Chart configurations (Chart.js) from natural language descriptions
 * - Mermaid diagram code from descriptions
 * - PlantUML code from descriptions
 * - AI-powered figure suggestions based on paper content
 * 
 * Stage Codes (for Super Admin model configuration):
 * - PAPER_FIGURE_SUGGESTION: AI suggestions for figures based on paper content
 * - PAPER_CHART_GENERATOR: Generate Chart.js configs from descriptions/data
 * - PAPER_DIAGRAM_GENERATOR: Generate Mermaid/PlantUML code from descriptions
 */

import { llmGateway } from '@/lib/metering/gateway'
import type { TaskCode } from '@prisma/client'
import {
  coercePaperFigureInferenceMeta,
  type PaperFigureInferenceMeta
} from './paper-figure-metadata'
import type {
  FigureCategory,
  DataChartType,
  DiagramType,
  FigureSuggestion,
  DiagramStructuredSpec,
  ChartStructuredSpec,
  IllustrationStructuredSpec,
  IllustrationStructuredSpecV2,
  IllustrationFigureGenre,
  IllustrationRenderDirectives,
  FigureRenderSpec,
  FigureRole,
  PaperProfile
} from './types'
import { normalizeFigurePreferences, type FigureSuggestionPreferences } from './preferences'
import { chooseDiagramRenderer } from './diagram-renderer-policy'

// =============================================================================
// TYPES
// =============================================================================

type SectionType =
  | 'introduction'
  | 'literature_review'
  | 'methodology'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'selected_content'

export interface ChartGenerationRequest {
  description: string
  chartType?: DataChartType
  title?: string
  sectionType?: SectionType | string
  figureRole?: FigureRole
  paperGenre?: string
  studyType?: PaperProfile['studyType']
  chartSpec?: ChartStructuredSpec
  data?: {
    labels?: string[]
    values?: number[]
    datasets?: Array<{
      label: string
      data: Array<number | { x: number; y: number; r?: number }>
      errors?: number[]
    }>
    pointDatasets?: Array<{
      label: string
      data: Array<{ x: number; y: number; r?: number }>
    }>
    datasetLabel?: string
  }
  rawDataText?: string
  style?: 'academic' | 'nature' | 'ieee' | 'minimal' | 'modern'
}

export interface ChartGenerationResult {
  success: boolean
  config?: {
    type: string
    data: {
      labels: string[]
      datasets: Array<{
        label: string
        data: Array<number | { x: number; y: number; r?: number }>
        backgroundColor?: string | string[]
        borderColor?: string | string[]
        borderWidth?: number
      }>
    }
    options?: Record<string, any>
  }
  inferredMeta?: PaperFigureInferenceMeta | null
  error?: string
  tokensUsed?: number
  model?: string
}

export interface DiagramGenerationRequest {
  description: string
  diagramType?: DiagramType
  title?: string
  sectionType?: SectionType | string
  figureRole?: FigureRole
  paperGenre?: string
  elements?: string[] // Optional list of elements to include
  style?: 'default' | 'forest' | 'dark' | 'neutral'
  diagramSpec?: DiagramStructuredSpec
  rendererPreference?: 'plantuml' | 'mermaid' | 'auto'
  hasRecentMermaidFailure?: boolean
  hasRecentPlantUMLFailure?: boolean
  specLooksMermaidLike?: boolean
}

export interface DiagramGenerationResult {
  success: boolean
  code?: string
  diagramType?: 'mermaid' | 'plantuml'
  error?: string
  tokensUsed?: number
  model?: string
  diagramSpec?: DiagramStructuredSpec
}

export interface FigureSuggestionRequest {
  paperTitle?: string
  paperAbstract?: string
  sections?: Record<string, string>
  researchType?: string
  datasetDescription?: string
  paperProfile?: Partial<PaperProfile>
  paperBlueprint?: {
    thesisStatement?: string
    centralObjective?: string
    keyContributions?: string[]
    sectionPlan?: Array<{
      sectionKey: string
      mustCover?: string[]
      mustAvoid?: string[]
    }>
  }
  preferences?: Partial<FigureSuggestionPreferences>
  existingFigures?: Array<{ title: string; type: string }>
  maxSuggestions?: number

  /**
   * When set, the suggestions are constrained to visualize THIS specific
   * text excerpt only. The LLM will use broader paper context for grounding
   * but every suggestion must directly illustrate the focused content.
   */
  focusText?: string
  /** Which section the focus text was selected from */
  focusSection?: string
  /** 'selection' = user highlighted text, 'section' = full section focus */
  focusMode?: 'selection' | 'section'
  /** Optional structured anchors extracted from focusText */
  focusHints?: {
    entities?: string[]
    metrics?: string[]
    verbs?: string[]
  }
}

export interface FigureSuggestionResult {
  success: boolean
  suggestions?: FigureSuggestion[]
  error?: string
  tokensUsed?: number
  model?: string
}

// =============================================================================
// PROMPTS
// =============================================================================

const SECTION_AWARE_ACADEMIC_FIGURE_POLICY = `SECTION-AWARE ACADEMIC FIGURE POLICY (GLOBAL)

You must choose and generate figures that are academically appropriate for the paper's SECTION and STUDY TYPE.
Do NOT optimize for "looks technical"; optimize for reviewer-expected rhetorical function:
- Introduction: orient/motivate/preview approach
- Literature Review: taxonomy/positioning/gaps
- Methodology: reproducibility/pipeline/experimental design
- Results: quantitative evidence/comparisons/ablations/error analysis
- Discussion/Conclusion: interpretation/limitations/implications/boundary conditions

FIGURE CATEGORIES (allowed outputs):
A) DATA_CHART / STATISTICAL_PLOT (Chart.js)
B) DIAGRAM (PlantUML or Mermaid)
C) ILLUSTRATED_FIGURE (infographic-style overview: icons + arrows + short labels; NOT UML syntax; NOT a plot)

CRITICAL GROUNDING RULE:
Every figure must be grounded in actual paper content. If data is missing, clearly request the exact data needed; if placeholders are permitted, they must be explicitly labeled as placeholders and must look plausible (no miracle trends).

SECTION FIT RULES (HARD CONSTRAINTS)
1) INTRODUCTION:
- Allowed: max 1 ILLUSTRATED_FIGURE, simple DIAGRAM flow/pipeline, high-level architecture only when explicitly system/framework contribution.
- Default disallow: class/component/sequence/ER unless intro explicitly introduces named software structure.
- Charts are rare: only when motivating statistics are explicitly present.

2) LITERATURE REVIEW:
- Allowed: taxonomy/evidence-map/PRISMA DIAGRAMS, trend/distribution DATA_CHARTs, max 1 ILLUSTRATED_FIGURE for framework summary.
- Default disallow: UML class/component/sequence unless literature explicitly compares software structures/interactions.

3) METHODOLOGY:
- Required: at least one pipeline/flowchart/activity DIAGRAM.
- Allowed: flowchart/activity/pipeline, architecture/deployment, ER (if schema-central), sequence (protocol-central), optional ILLUSTRATED_FIGURE.
- Default disallow: class/component unless framework/library structure is core contribution.

4) RESULTS:
- HARD MIX: at least 70% of suggestions must be DATA_CHART or STATISTICAL_PLOT when quantitative evidence exists.
- IF quantitative evidence is missing, suggest zero charts and provide DIAGRAM alternatives plus exact missing data fields in dataNeeded.
- Allowed: comparisons, ablations, error analysis, sensitivity/boundary plots.
- HARD BAN: class/component/sequence/usecase/state; architecture-overview by default.
- Placeholder realism: modest/noisy/plausible trends only unless dramatic jumps are explicitly claimed in paper text.

5) DISCUSSION/CONCLUSION:
- Allowed: error/failure/limits plots, implication/limitations DIAGRAMS, max 1 ILLUSTRATED_FIGURE summary.
- Default disallow: class diagrams unless maintainability/extensibility discussion explicitly requires them.

DIAGRAM TYPE SELECTION RULES:
- FLOWCHART/ACTIVITY/PIPELINE for process steps (default for Methodology).
- SEQUENCE only when interaction protocol/time order is central.
- CLASS/COMPONENT only for named software structure contribution.
- ER only when data schema is central.
- ARCHITECTURE/DEPLOYMENT only for system papers, high-level unless detailed methodology requires.

ILLUSTRATED_FIGURE RULES:
- Academic infographic overview, not art.
- Layout: 3-5 panels OR single strip with 4-7 numbered steps.
- Visual language: flat vector schematic; icons/boxes/arrows only.
- Text: max 4 words per label; no paragraphs; no hype.
- No photorealism, no 3D, no dramatic lighting, no people (silhouettes only for explicitly human-centric studies).
- Must map to inputs -> method -> outputs -> evaluation if present.

BUDGET & SPEC DISCIPLINE:
- Diagrams: nodes <= 12 (hard max 15), edges <= 18. If larger, split Fig X(a)/X(b).
- Every DIAGRAM must have deterministic diagramSpec.
- Every ILLUSTRATED_FIGURE must have deterministic illustrationSpec.
- Every DATA_CHART must define exact axes and data mapping.

FAIL FAST:
If requested figure type conflicts with section rules, propose the closest academically correct alternative for that section and state missing data/spec needed.
`

const PAPER_FIGURE_METADATA_OUTPUT_GUIDE = `{
  "summary": "1-2 sentence figure summary grounded in the supplied data and intended chart",
  "visibleElements": ["up to 8 concrete visual elements expected in the final chart"],
  "visibleText": ["up to 10 labels expected to be visible, such as axes, legend entries, category labels, or annotations"],
  "keyVariables": ["up to 8 variables, metrics, axes, or entities represented"],
  "comparedGroups": ["up to 8 methods, conditions, cohorts, categories, or series being compared"],
  "numericHighlights": ["up to 8 exact values, ranges, percentages, counts, or ranks taken directly from the supplied data"],
  "observedPatterns": ["up to 8 direct trends, contrasts, rankings, peaks, lows, or distributions implied by the supplied data"],
  "resultDetails": ["up to 8 concise, result-safe observations the Results section may report"],
  "methodologyDetails": ["up to 8 setup details only if the chart structure itself makes them explicit"],
  "discussionCues": ["up to 8 restrained interpretation cues, anomalies, caveats, or implications suggested by the data"],
  "chartSignals": ["up to 8 direct chart signals such as upward trends, separation, clustering, spread, or imbalance"],
  "claimsSupported": ["up to 8 conservative claims directly supported by the supplied data and intended chart"],
  "claimsToAvoid": ["up to 8 claims that would overreach the supplied data or chart alone"]
}`

function summarizeChartPromptComplexity(request: ChartGenerationRequest): string[] {
  const notes: string[] = []
  const labelsCount = Array.isArray(request.data?.labels) ? request.data.labels.length : 0
  const datasetCount = Array.isArray(request.data?.datasets) ? request.data.datasets.length : 0
  const pointDatasetCount = Array.isArray(request.data?.pointDatasets) ? request.data.pointDatasets.length : 0
  const maxSeriesLength = Array.isArray(request.data?.datasets)
    ? Math.max(0, ...request.data.datasets.map((dataset) => Array.isArray(dataset.data) ? dataset.data.length : 0))
    : 0
  const pointCount = Array.isArray(request.data?.pointDatasets)
    ? request.data.pointDatasets.reduce((sum, dataset) => sum + (Array.isArray(dataset.data) ? dataset.data.length : 0), 0)
    : 0
  const errorSeriesCount = Array.isArray(request.data?.datasets)
    ? request.data.datasets.filter((dataset) => Array.isArray(dataset.errors) && dataset.errors.length > 0).length
    : 0

  if (labelsCount > 0) notes.push(`- Category labels: ${labelsCount}`)
  if (datasetCount > 0) notes.push(`- Numeric datasets/series: ${datasetCount} (max ${maxSeriesLength} values per series)`)
  if (pointDatasetCount > 0) notes.push(`- Point datasets: ${pointDatasetCount} (${pointCount} total points)`)
  if (errorSeriesCount > 0) notes.push(`- Uncertainty/error arrays present in ${errorSeriesCount} series`)
  if (request.rawDataText?.trim()) {
    const rawLines = request.rawDataText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length
    notes.push(`- Raw numeric/request text lines: ${rawLines}`)
  }

  if (labelsCount > 12) {
    notes.push('- Dense category axis: preserve every label; adapt with horizontal bars, rotated ticks, or compact label handling instead of dropping labels.')
  }
  if (datasetCount > 4) {
    notes.push('- Multi-series comparison is dense: preserve all series and reduce ornamentation rather than simplifying the data.')
  }
  if (pointCount > 40) {
    notes.push('- Dense point cloud: keep all points; reduce marker size or opacity instead of filtering.')
  }

  return notes
}

const CHART_GENERATION_PROMPT = `${SECTION_AWARE_ACADEMIC_FIGURE_POLICY}

You are an expert data visualization designer specializing in publication-quality academic figures.

Your task: generate a valid Chart.js configuration object that produces an accurate, publication-ready chart and return drafting metadata in the same response.

CRITICAL RULES:
1. Return ONLY valid JSON. No markdown fences, no explanation, no comments in the JSON.
2. NEVER invent or hallucinate data. Use only the exact numeric values and labels provided in the request. Do not fabricate placeholder series, placeholder labels, or synthetic results.
2a. If the request includes raw CSV, TSV, JSON, x/y rows, pasted metrics, or lightly messy table text, normalize that content into the chart config using the exact values present in the request.
2b. Preserve every provided category, row, series, point, and legend entry. Never drop, merge, downsample, reorder, or aggregate data unless the request explicitly asks for it.
3. The chart MUST have:
   - Properly labeled axes with units where applicable (e.g., "Accuracy (%)", "Time (seconds)")
   - A legend with descriptive dataset labels
   - Colors from this academic palette: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7"]
3a. IMPORTANT FOR PAPER FIGURES: do NOT render a title above the chart. The paper title/caption is handled outside the image. Keep axis titles, but disable the in-chart top title.
4. For bar charts: use semi-transparent fills (rgba with 0.8 opacity), solid borders
5. For line charts: use solid lines (borderWidth: 2.5), small point radius (3-4px), no fill unless area chart
6. For pie/doughnut: use the full 8-color palette, add percentage labels via datalabels plugin
7. For scatter: use distinct markers per dataset, point radius 5-6px, and dataset.data must be an array of { "x": number, "y": number } objects.
7a. For bubble: dataset.data must be an array of { "x": number, "y": number, "r": number } objects.
8. Font sizes: title 16px bold, axis labels 13px, tick labels 11px, legend 12px
9. Use font family: "'Helvetica Neue', 'Arial', sans-serif"
10. Grid lines: light gray (#E5E7EB), width 0.5
11. White background (#FFFFFF) with clean spacing
12. You will receive sectionType and figureRole context. Respect it.
13. If sectionType=results:
   - prioritize baseline vs proposed comparisons and uncertainty-ready layouts
   - avoid visually misleading scaling, clutter, or exaggerated contrast
14. If chartSpec is provided, follow chartSpec axis labels and field mappings exactly.
15. Respect any DATA COMPLEXITY / PRESERVATION SIGNALS in the prompt. Adapt label rotation, orientation, font sizes, and legend placement to keep all supplied data visible.
16. If labels are long or numerous, prefer horizontal bars or rotated ticks over truncation. If the plot is dense, simplify styling, not data.
17. If values span positive and negative ranges, do not force an artificial zero baseline that distorts the comparison.

METADATA RULES:
- Return a top-level "metadata" object with this exact shape: ${PAPER_FIGURE_METADATA_OUTPUT_GUIDE}
- The metadata must be derived from the supplied data, labels, chartSpec, and intended rendered chart. No second-pass image verification is available.
- Assume the final chart will visibly contain the axes, legend labels, category labels, and annotations defined in your config.
- "numericHighlights" must quote exact values, ranges, percentages, counts, or ranks from the supplied data.
- "observedPatterns", "resultDetails", and "claimsSupported" must stay conservative and strictly proportional to the supplied data.
- "claimsToAvoid" must block causal, significance, generalization, or performance claims not proven by the supplied data alone.

OUTPUT FORMAT (return ONLY this JSON):
{
  "type": "bar|horizontalBar|line|scatter|bubble|pie|doughnut|radar|polarArea",
  "data": {
    "labels": ["Label1", "Label2", ...],
    "datasets": [{
      "label": "Dataset Name",
      "data": [value1, value2, ...] or [{"x": 1, "y": 2}, ...] for scatter or [{"x": 1, "y": 2, "r": 5}, ...] for bubble,
      "backgroundColor": ["#color1", ...] or "rgba(r,g,b,0.8)",
      "borderColor": ["#color1", ...] or "#color",
      "borderWidth": 1.5
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": { "display": false, "text": "", "font": { "size": 16, "weight": "bold", "family": "'Helvetica Neue', Arial, sans-serif" }, "color": "#1F2937", "padding": { "bottom": 16 } },
      "legend": { "position": "bottom", "labels": { "font": { "size": 12, "family": "'Helvetica Neue', Arial, sans-serif" }, "usePointStyle": true, "padding": 16 } }
    },
    "scales": {
      "y": { "beginAtZero": true, "title": { "display": true, "text": "Y-Axis Label", "font": { "size": 13 } }, "grid": { "color": "#E5E7EB" }, "ticks": { "font": { "size": 11 } } },
      "x": { "title": { "display": true, "text": "X-Axis Label", "font": { "size": 13 } }, "grid": { "color": "#E5E7EB" }, "ticks": { "font": { "size": 11 } } }
    }
  },
  "metadata": ${PAPER_FIGURE_METADATA_OUTPUT_GUIDE}
}

IMPORTANT: For pie, doughnut, radar, and polarArea charts, do NOT include the "scales" key in options.

USER REQUEST:
`

const DIAGRAM_GENERATION_PROMPT = `${SECTION_AWARE_ACADEMIC_FIGURE_POLICY}

You are an expert at creating compact, publication-quality Mermaid diagrams for academic papers. The output must render reliably on Kroki (Mermaid renderer).

OUTPUT RULES (STRICT):
1) Return ONLY valid Mermaid code. No markdown fences, no explanations, no extra text.
2) Use ONLY Kroki-compatible Mermaid syntax. Avoid experimental or newer features.
3) Keep diagrams compact: target 8-12 nodes (15 max). Keep subgraphs 2-3 (4 max). Avoid deep nesting.
4) Labels must be short and safe: 2-4 words, max 28 characters, ASCII only; use letters/digits/spaces/hyphen only.
   - Avoid parentheses, brackets, commas, colons, math symbols in labels.
5) IDs must be valid and stable:
   - IDs must match: ^[A-Za-z][A-Za-z0-9_]*$
   - IDs must be unique.
   - Do not use single-letter IDs unless unavoidable; prefer short meaningful IDs (ingest, preprocess, model).
6) Prefer left-to-right layouts for pipelines/architectures/topology unless explicitly requested otherwise.
7) Do NOT chain arrows on one line if it causes ambiguity. Prefer one edge per line.
8) Do NOT add Mermaid init directives, themes, or CSS. Styling is handled externally.
9) TEMPLATE RULE: You MUST choose exactly ONE canonical template below that matches diagramType and ONLY fill/adjust its placeholders.
   - Do NOT mix templates.
   - Do NOT introduce syntax beyond what appears in the chosen template.
   - If the request is under-specified, use a minimal template with generic nodes.
10) You will receive sectionType and paperGenre. Enforce section fit:
   - Results: never output class/component/sequence/usecase/state.
   - Methodology: prefer flowchart/activity/pipeline.
   - Introduction: keep high-level only.
11) Labels must be academic and neutral. Avoid marketing/hype words.
12) If the request includes raw CSV, TSV, JSON, metrics, or pasted data rows, use that content to name entities, stages, comparisons, and relationships instead of ignoring it.

SUPPORTED DIAGRAM TYPES (Mermaid fallback):
- flowchart (default for non-UML process/architecture)
- sequence
- state
- er
- gantt

CANONICAL TEMPLATES (choose exactly ONE; fill placeholders only):

[TEMPLATE 1: FLOWCHART / ARCHITECTURE (PIPELINE)]
flowchart LR
  subgraph Input
    dataSources[Data Sources]
    ingestion[Ingestion]
    dataSources --> ingestion
  end
  subgraph Core
    preprocess[Preprocess]
    model[Model]
    preprocess --> model
  end
  subgraph Output
    results[Results]
  end
  ingestion --> preprocess
  model --> results

[TEMPLATE 2: FLOWCHART / TOPOLOGY (HUB AND SPOKE)]
flowchart LR
  client[Client] --> gateway[Gateway]
  gateway --> serviceA[Service A]
  gateway --> serviceB[Service B]
  serviceA --> db[DB]
  serviceB --> db

[TEMPLATE 3: SEQUENCE]
sequenceDiagram
  participant UI as UI
  participant API as API
  participant SVC as Service
  participant DB as DB
  UI->>API: submit
  API->>SVC: process
  SVC->>DB: read
  DB-->>SVC: data
  SVC-->>API: result
  API-->>UI: response

[TEMPLATE 4: STATE]
stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Done: finish
  Done --> [*]

[TEMPLATE 5: ER]
erDiagram
  PAPER ||--o{ SECTION : has
  SECTION ||--o{ CITATION : cites
  PAPER {
    string title
  }
  SECTION {
    string heading
  }
  CITATION {
    string doi
  }

[TEMPLATE 6: GANTT]
gantt
  dateFormat YYYY-MM-DD
  section Work
  Task A :a1, 2026-01-01, 10d
  Task B :a2, after a1, 7d

YOUR TASK:
- You will receive a diagramType and a short user request describing what the diagram should show.
- Choose exactly one template that matches diagramType:
  * flowchart -> TEMPLATE 1 (or TEMPLATE 2 if topology-like)
  * sequence  -> TEMPLATE 3
  * state     -> TEMPLATE 4
  * er        -> TEMPLATE 5
  * gantt     -> TEMPLATE 6
- Replace placeholder labels with compact, safe labels.
- Ensure all IDs are unique and valid.
- Add/remove nodes minimally to match the request while staying within compactness limits.
- Keep edge labels minimal; omit unless essential.
- Output only Mermaid code.

USER REQUEST:
`

const PLANTUML_GENERATION_PROMPT = `${SECTION_AWARE_ACADEMIC_FIGURE_POLICY}

You are an expert at creating compact, publication-quality PlantUML diagrams for top-tier academic papers (IEEE/ACM/Springer/Elsevier). You must optimize for space efficiency and Kroki compatibility.

OUTPUT RULES (STRICT):
1) Return ONLY PlantUML code starting with @startuml and ending with @enduml.
2) No markdown fences, no explanations, no extra text.
3) Always include the exact GLOBAL COMPACT STYLE block provided below (verbatim) after @startuml.
4) Use ONLY the allowed palette and styling rules below. Do not invent new colors.
5) Keep diagrams compact: target 8-12 nodes (15 max). Keep groups/packages/nodes 2-3 (4 max). Avoid deep nesting.
6) Labels must be short and safe: 2-4 words, max 28 characters, ASCII only; use letters/digits/spaces/hyphen only.
   - Avoid parentheses, brackets, commas, colons, math symbols in labels.
   - Keep edge labels 0-2 words (optional; only if essential).
7) Prefer left-to-right layouts for pipelines/architectures/topology/deployment unless explicitly requested otherwise.
8) Do NOT chain arrows on one line (never write: A --> B --> C). Always write one edge per line.
9) Avoid advanced PlantUML features that may break on Kroki (no sprites, no includes, no external files, no macros).
10) TEMPLATE RULE: You MUST choose exactly ONE canonical template below that matches diagramType and ONLY fill/adjust its placeholders.
    - Do NOT mix templates.
    - Do NOT introduce syntax beyond what appears in the chosen template.
    - If the request is under-specified, use a minimal template with generic nodes.
11) You will receive sectionType and paperGenre. Enforce section fit:
    - Results: never output class/component/sequence/usecase/state.
    - Methodology: prefer architecture/pipeline/activity; sequence only if protocol-centric.
    - Introduction: high-level only (6-10 nodes).
12) Use short academic labels only. No marketing adjectives.

SUPPORTED DIAGRAM TYPES (PlantUML-first):
- architecture (default for system overviews)
- topology (network/service interaction as compact architecture)
- deployment (edge/cloud/on-prem nodes)
- activity (workflow)
- sequence (interaction over time)
- class
- component
- state
- usecase
- er (conservative: entities as rectangles + labeled associations)

ALLOWED PALETTE (ONLY):
- BlueAccent:   #1F77B4
- OrangeAccent: #F28E2B
- DarkText:     #111111
- LineGray:     #5A5A5A
- PageWhite:    #FFFFFF
- SoftBlueBg:   #EEF5FF
- SoftOrangeBg: #FFF2E8
- SoftGroupBg:  #F3F4F6
- NodeBg:       #FBFBFC

GLOBAL COMPACT STYLE (ALWAYS include this exact block after @startuml):
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20
skinparam RectangleBackgroundColor #FBFBFC
skinparam RectangleBorderColor #5A5A5A
skinparam PackageBackgroundColor #F3F4F6
skinparam PackageBorderColor #7A7A7A

CANONICAL TEMPLATES (choose exactly ONE; fill placeholders only):

[TEMPLATE 1: ARCHITECTURE / PIPELINE]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20
skinparam RectangleBackgroundColor #FBFBFC
skinparam RectangleBorderColor #5A5A5A
skinparam PackageBackgroundColor #F3F4F6
skinparam PackageBorderColor #7A7A7A

left to right direction

package "Input" #EEF5FF {
  rectangle "Node A" as a
  rectangle "Node B" as b
}
package "Core" #FFF2E8 {
  rectangle "Node C" as c
  rectangle "Node D" as d
}
package "Output" #EEF5FF {
  rectangle "Node E" as e
}

a --> b
b --> c
c --> d
d --> e
@enduml

[TEMPLATE 2: TOPOLOGY (HUB AND SPOKE)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20
skinparam RectangleBackgroundColor #FBFBFC
skinparam RectangleBorderColor #5A5A5A
skinparam PackageBackgroundColor #F3F4F6
skinparam PackageBorderColor #7A7A7A

left to right direction

rectangle "Client" as C #EEF5FF
rectangle "Gateway" as G #FFF2E8
rectangle "Service A" as A #FBFBFC
rectangle "Service B" as B #FBFBFC
database "DB" as D #EEF5FF

C --> G : req
G --> A : route
G --> B : route
A --> D : read
B --> D : read
@enduml

[TEMPLATE 3: DEPLOYMENT (EDGE AND CLOUD)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20

left to right direction

node "Edge" as Edge #EEF5FF {
  artifact "App" as App
  database "Cache" as Cache
}
node "Cloud" as Cloud #FFF2E8 {
  artifact "API" as API
  artifact "Model" as ML
  database "DB" as DB
}

App --> API : send
API --> ML : infer
API --> DB : store
App --> Cache : buffer
@enduml

[TEMPLATE 4: ACTIVITY (WORKFLOW)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20

skinparam ActivityBackgroundColor #EEF5FF
skinparam ActivityBorderColor #1F77B4
skinparam ActivityFontColor #0F2A43
skinparam DiamondBackgroundColor #FFF2E8
skinparam DiamondBorderColor #F28E2B
skinparam DiamondFontColor #5A3A00

start
:Step One;
:Step Two;
if (Decision?) then (Yes)
  :Step Three;
else (No)
  :Fix Step;
endif
:Finish;
stop
@enduml

[TEMPLATE 5: SEQUENCE (INTERACTION)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #2A6F97
skinparam ArrowThickness 1
skinparam maxMessageSize 70

skinparam participant {
  BackgroundColor #FBFBFC
  BorderColor #5A5A5A
  FontColor #1A1A1A
}

participant "UI" as UI
participant "API" as API
participant "Service" as SVC
database "DB" as DB

UI -> API : submit
API -> SVC : process
SVC -> DB : read
DB --> SVC : data
SVC --> API : result
API --> UI : response
@enduml

[TEMPLATE 6: CLASS]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1

skinparam class {
  BackgroundColor #FBFBFC
  BorderColor #5A5A5A
  FontColor #1A1A1A
}

class "Entity A" as A {
  +field1
}
class "Entity B" as B {
  +field2
}
A --> B
@enduml

YOUR TASK:
- You will receive a diagramType and a short user request describing what the diagram should show.
- Choose exactly one template that matches diagramType:
  * architecture -> TEMPLATE 1
  * topology     -> TEMPLATE 2
  * deployment   -> TEMPLATE 3
  * activity     -> TEMPLATE 4
  * sequence     -> TEMPLATE 5
  * class        -> TEMPLATE 6
- Replace placeholder labels and IDs with compact, safe labels and IDs.
- Add/remove nodes minimally to match the request while staying within the compactness limits.
- Keep all rules above.

USER REQUEST:
`

const FIGURE_SUGGESTION_PROMPT = `${SECTION_AWARE_ACADEMIC_FIGURE_POLICY}

You are a senior academic figure editor for peer-reviewed papers. You analyze research papers and recommend figures that are section-fit, reviewer-expected, grounded in the paper, and immediately renderable by our generators.

Your job: suggest 5-8 specific, actionable figures grounded in actual paper content (or 2-4 under focus constraints).

CRITICAL RULES:
1. Return ONLY a valid JSON array. No markdown fences, no explanation outside JSON.
2. Every suggestion MUST be grounded in the provided PAPER CONTENT, explicitly referencing the relevant section and the concrete entities/variables/method steps described.
3. Never output generic figure ideas. Tie each suggestion to this paper's claims, variables, entities, and methods.
4. Respect the provided Paper Profile (paperGenre, studyType, dataAvailability) and section-fit rules.

DATA AVAILABILITY HARD GATE (MUST FOLLOW):
5. If the paper draft DOES NOT contain explicit quantitative values (numbers, metrics, tables, counts, distributions) AND the user has NOT provided data separately, then you MUST NOT suggest any DATA_CHART or STATISTICAL_PLOT figures.
   - In this case, suggest only DIAGRAM and/or ILLUSTRATED_FIGURE alternatives.
   - Set "dataNeeded" to the exact missing data fields/columns required to enable plots later.
   - Do NOT invent placeholder numeric values or pretend results exist.
6. Only suggest DATA_CHART / STATISTICAL_PLOT when (a) the paper content includes quantitative results OR (b) the user explicitly provided data for plotting. When allowed, include a deterministic chartSpec with explicit axes and variable mapping.

SECTION-FIT GOVERNANCE (hard):
7. RESULTS section: when quantitative results exist, prioritize comparisons/ablations/error analysis plots; otherwise propose results-appropriate DIAGRAM alternatives (e.g., evaluation protocol schematic, error taxonomy diagram) and request missing data in dataNeeded.
8. METHODOLOGY: include at least one DIAGRAM explaining the method pipeline (reviewer-expected).
9. LITERATURE_REVIEW: prefer taxonomy maps, PRISMA-like flow, evidence maps (DIAGRAM), and trends only if quantitative evidence counts exist.
10. INTRODUCTION/DISCUSSION: allow ONE ILLUSTRATED_FIGURE only if it clarifies real-world usage or conceptual framing; keep text minimal.

DIAGRAM RENDERER POLICY:
11. For every DIAGRAM suggestion include rendererPreference ("plantuml" or "mermaid") with this policy:
   - Prefer plantuml for UML-ish diagrams (class/component/usecase/state/activity/sequence) and architecture/deployment/topology/system overview/pipeline.
   - Use mermaid only for simple gantt or simple er when appropriate.

DETERMINISTIC SPEC REQUIREMENT (hard):
12. category must be one of: DATA_CHART, STATISTICAL_PLOT, DIAGRAM, ILLUSTRATED_FIGURE.
13. suggestedType must be one of:
   - Charts: bar, line, pie, scatter, radar, doughnut
   - Diagrams: flowchart, sequence, architecture, class, component, usecase, state, activity, er, gantt
   - Illustrated: sketch-auto, sketch-guided
14. For DATA_CHART / STATISTICAL_PLOT suggestions: include chartSpec with explicit axes + variable mapping and a placeholderPolicy ONLY if real data is present (see Rule 5-6).
15. For DIAGRAM suggestions: include diagramSpec with deterministic nodes/edges plus constraints:
   - nodesMax <= 12, edgesMax <= 18, nodeLabelMaxWords <= 3, noDuplicateNodeLabels=true.
16. For ILLUSTRATED_FIGURE suggestions: include illustrationSpecV2 with:
   - figureGenre: METHOD_BLOCK|SCENARIO_STORYBOARD|CONCEPTUAL_FRAMEWORK|GRAPHICAL_ABSTRACT|NEURAL_ARCHITECTURE|EXPERIMENTAL_SETUP|DATA_PIPELINE|COMPARISON_MATRIX|PROCESS_MECHANISM|SYSTEM_INTERACTION
   - Choose the most specific genre:
     * NEURAL_ARCHITECTURE: for deep learning layer diagrams with tensor dimensions
     * EXPERIMENTAL_SETUP: for lab/experimental configuration schematics
     * DATA_PIPELINE: for ETL/ML data processing pipelines with sample counts
     * COMPARISON_MATRIX: for method/model comparison grids
     * PROCESS_MECHANISM: for scientific processes (biological, chemical, physical)
     * SYSTEM_INTERACTION: for multi-system API/protocol interaction diagrams
   - renderDirectives: aspectRatio, fillCanvasPercentMin, whitespaceMaxPercent, textPolicy, stylePolicy, compositionPolicy
   - sketchPrompt derived from illustrationSpecV2 only; labels should be legible and descriptive.
17. Every suggestion MUST include renderSpec wrapper:
   - kind=chart|diagram|illustration and the matching deterministic spec.

GOVERNANCE FIELDS (required for every suggestion):
18. Include:
   - figureRole: ORIENT | POSITION | EXPLAIN_METHOD | SHOW_RESULTS | INTERPRET
   - sectionFitJustification: one sentence for section appropriateness
   - expectedByReviewers: boolean

IMPORTANCE GUIDELINES:
- required: expected by reviewers (e.g., methodology pipeline, results comparisons when data exists)
- recommended: significantly strengthens the paper
- optional: useful but not essential

OUTPUT FORMAT (return ONLY JSON array):
[
  {
    "title": "Specific figure title",
    "description": "50-150 words, implementation-ready, grounded in paper content",
    "category": "DATA_CHART|STATISTICAL_PLOT|DIAGRAM|ILLUSTRATED_FIGURE",
    "suggestedType": "bar|line|...|flowchart|...|sketch-auto|sketch-guided",
    "rendererPreference": "plantuml|mermaid (DIAGRAM only)",
    "relevantSection": "introduction|literature_review|methodology|results|discussion|conclusion",
    "figureRole": "ORIENT|POSITION|EXPLAIN_METHOD|SHOW_RESULTS|INTERPRET",
    "sectionFitJustification": "One sentence",
    "expectedByReviewers": true,
    "importance": "required|recommended|optional",
    "dataNeeded": "Exact variables/columns needed (or 'None (conceptual/method figure)')",
    "whyThisFigure": "One sentence why this strengthens the paper",
    "renderSpec": {
      "kind": "chart|diagram|illustration",
      "chartSpec": {},
      "diagramSpec": {},
      "illustrationSpecV2": {}
    },

    "chartSpec": {
      "chartType": "bar|line|scatter|radar|doughnut|pie",
      "xAxisLabel": "X label",
      "yAxisLabel": "Y label",
      "xField": "column_name",
      "yField": "column_name",
      "series": [{ "label": "Baseline", "yField": "baseline_metric" }],
      "aggregation": "mean|median|none",
      "baselineLabel": "Baseline model",
      "placeholderPolicy": {
        "allowed": false,
        "label": "Sample Data (replace with actual values)",
        "shape": "modest_gain|flat|tradeoff|noisy_trend",
        "rangeHint": "e.g., 70-90 for accuracy (%)"
      },
      "notes": "Optional chart-specific note"
    },

    "diagramSpec": {
      "layout": "LR|TD",
      "nodes": [{ "idHint": "nodeA", "label": "Node A", "group": "Input" }],
      "edges": [{ "fromHint": "nodeA", "toHint": "nodeB", "label": "flows", "type": "solid" }],
      "groups": [{ "name": "Input", "nodeIds": ["nodeA"], "enclosesNodeIds": ["nodeA"] }],
      "constraints": { "nodesMax": 12, "edgesMax": 18, "nodeLabelMaxWords": 3, "noDuplicateNodeLabels": true },
      "splitSuggestion": "Optional split when too complex"
    },

    "illustrationSpecV2": {
      "layout": "PANELS|STRIP",
      "panelCount": 3,
      "stepCount": 5,
      "flowDirection": "LR|TD",
      "figureGenre": "METHOD_BLOCK|SCENARIO_STORYBOARD|CONCEPTUAL_FRAMEWORK|GRAPHICAL_ABSTRACT|NEURAL_ARCHITECTURE|EXPERIMENTAL_SETUP|DATA_PIPELINE|COMPARISON_MATRIX|PROCESS_MECHANISM|SYSTEM_INTERACTION",
      "panels": [{ "idHint": "p1", "title": "Input", "elements": ["Icon", "Short label"] }],
      "elements": ["icons", "arrows", "boxes"],
      "steps": ["Collect", "Process", "Evaluate"],
      "renderDirectives": {
        "aspectRatio": "3:1 (strips/pipelines) | 4:3 (architectures/grids) | 3:2 (setups/processes) | 16:9 (graphical abstracts)",
        "fillCanvasPercentMin": 85,
        "whitespaceMaxPercent": 15,
        "textPolicy": { "maxLabelsTotal": "6-15 depending on genre", "maxWordsPerLabel": "3-5", "forbidAllCaps": true, "titlesOnlyPreferred": false },
        "stylePolicy": { "noGradients": true, "no3D": true, "noClipart": true, "whiteBackground": true, "paletteMode": "academic_muted|academic_color" },
        "compositionPolicy": { "layoutMode": "PANELS|STRIP", "equalPanels": "true for grids, false for pipelines", "noTextOutsidePanels": false }
      },
      "captionDraft": "Short draft caption",
      "splitSuggestion": "Optional split"
    },

    "sketchStyle": "academic|scientific|conceptual|technical (ILLUSTRATED_FIGURE only)",
    "sketchPrompt": "80-200 word image-generation prompt (ILLUSTRATED_FIGURE only). Keep text extremely limited; avoid tiny labels.",
    "sketchMode": "SUGGEST|GUIDED (ILLUSTRATED_FIGURE only)"
  }
]

PAPER CONTENT:
\`\`\`
`

/**
 * Additional prompt block injected when the user has selected/focused on a
 * specific text excerpt. This constrains every suggestion to directly
 * illustrate the focused content while still using the broader paper
 * context for grounding (correct terminology, related variables, etc.).
 */
function buildFocusTextBlock(
  focusText: string,
  focusSection?: string,
  focusMode?: 'selection' | 'section',
  focusHints?: { entities?: string[]; metrics?: string[]; verbs?: string[] }
): string {
  const modeLabel = focusMode === 'selection'
    ? 'The user has selected the following excerpt from their paper'
    : 'The user wants figures specifically for the following content'
  const sectionHint = focusSection ? ` (from the "${focusSection}" section)` : ''
  const entities = (focusHints?.entities || []).slice(0, 10)
  const metrics = (focusHints?.metrics || []).slice(0, 10)
  const verbs = (focusHints?.verbs || []).slice(0, 8)
  const hintsBlock = (entities.length > 0 || metrics.length > 0 || verbs.length > 0)
    ? `
FOCUS HINTS (EXTRACTED ANCHORS - USE THESE TO STAY SPECIFIC):
- Entities: ${entities.length > 0 ? entities.join('; ') : 'none'}
- Metrics: ${metrics.length > 0 ? metrics.join('; ') : 'none'}
- Verbs/Actions: ${verbs.length > 0 ? verbs.join('; ') : 'none'}
`
    : ''

  return `
===================================================
FOCUS CONSTRAINT - READ CAREFULLY
===================================================
${modeLabel}${sectionHint}:

"""
${focusText.slice(0, 3000)}
"""
${hintsBlock}

STRICT RULES FOR THIS FOCUSED REQUEST:
1. EVERY suggestion MUST directly visualize, explain, or showcase the content in the excerpt above.
2. Do NOT suggest figures for other parts of the paper - only for the focused text.
3. Use broader paper context only for terminology/grounding. Every figure must still target this excerpt.
4. If the excerpt describes a process or workflow -> suggest a flowchart/activity diagram.
5. If the excerpt contains comparisons, numbers, or measurements -> suggest charts.
6. If the excerpt describes relationships or structures -> suggest architecture/class/ER only when section-fit allows.
7. If the excerpt is conceptual or theoretical -> suggest an ILLUSTRATED_FIGURE.
8. Suggest 2-4 figures only.
9. The "relevantSection" field must be "${focusSection || 'selected_content'}".
10. "whyThisFigure" must state how the figure improves understanding of this focused text.
11. Prefer mentioning extracted entities/metrics when available.
===================================================

`
}

const DIAGRAM_REPAIR_PROMPT = `You are a strict PlantUML syntax repair agent.

CRITICAL RULES:
1. Output ONLY valid PlantUML code.
2. Keep original structure and intent; fix syntax and rendering issues only.
3. Do NOT add unrelated nodes or edges.
4. Use ASCII labels and deterministic aliases.
5. Keep complexity within nodes <= 12, edges <= 18 whenever possible.

You are given:
- structured spec
- previous broken code
- Kroki error output

Return repaired PlantUML code that Kroki can render.

INPUT:
`

// =============================================================================
// LLM CALL HELPER
// =============================================================================

async function callLLM(
  prompt: string,
  stageCode: string,
  requestHeaders: Record<string, string>,
  metadata?: Record<string, any>
): Promise<{ response: string; tokensUsed: number; model: string }> {
  try {
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders },
      {
        taskCode: 'LLM2_DRAFT' as TaskCode, // Generic draft task
        stageCode, // Stage code for model resolution (e.g., PAPER_CHART_GENERATOR)
        prompt,
        parameters: {
          temperature: 0.3, // Lower temperature for more consistent code generation
        },
        idempotencyKey: `figure-gen-${stageCode}-${Date.now()}`,
        metadata: {
          module: 'paper-figures',
          stageCode,
          ...metadata
        }
      }
    )

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'LLM call failed')
    }

    return {
      response: result.response.output,
      tokensUsed: result.response.outputTokens || 0,
      model: result.response.modelClass || 'unknown'
    }
  } catch (error) {
    console.error(`[LLMFigureService] LLM call failed for ${stageCode}:`, error)
    throw error
  }
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Extract valid JSON from LLM response, stripping markdown artifacts
 */
function extractJSON(raw: string): string {
  let cleaned = raw.trim()

  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim()
  }

  // Remove any leading/trailing non-JSON text
  // Find the first { or [ and the last } or ]
  const firstBrace = cleaned.indexOf('{')
  const firstBracket = cleaned.indexOf('[')
  const startIdx = firstBrace === -1 ? firstBracket :
    firstBracket === -1 ? firstBrace :
    Math.min(firstBrace, firstBracket)

  if (startIdx > 0) {
    cleaned = cleaned.slice(startIdx)
  }

  const lastBrace = cleaned.lastIndexOf('}')
  const lastBracket = cleaned.lastIndexOf(']')
  const endIdx = Math.max(lastBrace, lastBracket)

  if (endIdx >= 0 && endIdx < cleaned.length - 1) {
    cleaned = cleaned.slice(0, endIdx + 1)
  }

  return cleaned
}

const MAX_SPEC_NODES = 15
const DEFAULT_SPEC_NODES = 12
const MAX_SPEC_EDGES = 18

function sanitizeAscii(input: string, keepNewlines: boolean = false): string {
  const normalized = (input || '').normalize('NFKD')
  return keepNewlines
    ? normalized.replace(/[^\x20-\x7E\n]/g, '')
    : normalized.replace(/[^\x20-\x7E]/g, '')
}

function sanitizeDiagramLabel(input: string): string {
  const cleaned = sanitizeAscii(input || '')
    .replace(/["'`[\]{}()<>:,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter(Boolean).slice(0, 3)
  const clipped = words.join(' ').slice(0, 28).trim()
  return clipped || 'Node'
}

function sanitizeAlias(input: string, index: number): string {
  const base = sanitizeAscii(input || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = base.split(' ').filter(Boolean)
  let alias = parts.map((p, i) => i === 0 ? p.toLowerCase() : `${p[0].toUpperCase()}${p.slice(1).toLowerCase()}`).join('')
  if (!alias) alias = `node${index + 1}`
  if (!/^[a-zA-Z]/.test(alias)) alias = `n${alias}`
  alias = alias.slice(0, 24)
  return alias || `node${index + 1}`
}

function sanitizeDiagramSpec(spec?: DiagramStructuredSpec | null): DiagramStructuredSpec | undefined {
  if (!spec || typeof spec !== 'object') return undefined

  const layout = spec.layout === 'LR' ? 'LR' : 'TD'
  const nodesInput = Array.isArray(spec.nodes) ? spec.nodes : []
  const groupsInput = Array.isArray(spec.groups) ? spec.groups : []
  const edgesInput = Array.isArray(spec.edges) ? spec.edges : []

  const nodes = nodesInput
    .slice(0, MAX_SPEC_NODES)
    .map((node, idx) => ({
      idHint: sanitizeAlias(node?.idHint || node?.label || `node${idx + 1}`, idx),
      label: sanitizeDiagramLabel(node?.label || node?.idHint || `Node ${idx + 1}`),
      group: node?.group ? sanitizeDiagramLabel(node.group).slice(0, 20) : undefined
    }))

  const aliasSet = new Set(nodes.map(n => n.idHint))
  const edges = edgesInput
    .slice(0, MAX_SPEC_EDGES)
    .map((edge, idx) => ({
      fromHint: sanitizeAlias(edge?.fromHint || `node${idx + 1}`, idx),
      toHint: sanitizeAlias(edge?.toHint || `node${idx + 2}`, idx + 1),
      label: edge?.label ? sanitizeDiagramLabel(edge.label) : undefined,
      type: edge?.type === 'dashed' || edge?.type === 'async' ? edge.type : 'solid' as const
    }))
    .filter(edge => aliasSet.has(edge.fromHint) && aliasSet.has(edge.toHint))

  const groups = groupsInput
    .slice(0, 8)
    .map((group) => ({
      name: sanitizeDiagramLabel(group?.name || 'Group'),
      nodeIds: Array.isArray(group?.nodeIds)
        ? group.nodeIds.map((id, idx) => sanitizeAlias(id, idx)).filter(id => aliasSet.has(id))
        : undefined,
      enclosesNodeIds: Array.isArray((group as any)?.enclosesNodeIds)
        ? (group as any).enclosesNodeIds
            .map((id: string, idx: number) => sanitizeAlias(id, idx))
            .filter((id: string) => aliasSet.has(id))
        : undefined,
      description: group?.description ? sanitizeDiagramLabel(group.description) : undefined
    }))
    .filter(group => (group.nodeIds?.length || group.enclosesNodeIds?.length || 0) > 0)

  if (nodes.length === 0) return undefined

  return {
    layout,
    nodes: nodes.slice(0, DEFAULT_SPEC_NODES),
    edges,
    groups,
    constraints: {
      nodesMax: Math.min(MAX_SPEC_NODES, Math.max(1, Number((spec as any)?.constraints?.nodesMax || DEFAULT_SPEC_NODES))),
      edgesMax: Math.min(MAX_SPEC_EDGES, Math.max(1, Number((spec as any)?.constraints?.edgesMax || MAX_SPEC_EDGES))),
      nodeLabelMaxWords: Math.min(6, Math.max(1, Number((spec as any)?.constraints?.nodeLabelMaxWords || 3))),
      noDuplicateNodeLabels: typeof (spec as any)?.constraints?.noDuplicateNodeLabels === 'boolean'
        ? (spec as any).constraints.noDuplicateNodeLabels
        : true
    },
    splitSuggestion: spec.splitSuggestion ? sanitizeAscii(spec.splitSuggestion).slice(0, 140) : undefined
  }
}

function buildSpecPromptBlock(spec?: DiagramStructuredSpec): string {
  if (!spec) return 'StructuredSpec: none'
  return `StructuredSpec:\n${JSON.stringify(spec, null, 2)}`
}

/**
 * Build a visual-composition prompt for sketch/illustration generation
 * when the LLM didn't provide a sketchPrompt field.
 */
function buildSketchPromptFromDescription(
  title: string,
  description: string,
  style: 'academic' | 'scientific' | 'conceptual' | 'technical' = 'academic'
): string {
  const styleGuide: Record<string, string> = {
    academic: 'Flat vector academic infographic with clean whitespace, restrained palette, and concise labels.',
    scientific: 'Scientific infographic with consistent line weight, clear symbols, and panel-wise process flow.',
    conceptual: 'Conceptual infographic with icon-based metaphors, directional arrows, and short labels.',
    technical: 'Technical schematic infographic with modular boxes, connector arrows, and deterministic step layout.'
  }
  const guide = styleGuide[style] || styleGuide.academic
  return `Create an infographic-style academic overview titled "${title}". ${description} Style: ${guide} Layout must be 3-5 panels or a 4-7 step strip. Use icons, boxes, arrows, and badges only. Keep labels <= 4 words. No paragraphs, no photorealism, no 3D, no people unless silhouette-only is required. Do not include figure numbers, captions, or watermarks on the image.`
}

function buildSketchPromptFromIllustrationSpecV2(
  title: string,
  spec: IllustrationStructuredSpecV2,
  style: 'academic' | 'scientific' | 'conceptual' | 'technical' = 'academic'
): string {
  const directives = sanitizeRenderDirectives(spec.renderDirectives, spec.figureGenre || 'METHOD_BLOCK')
  const layout = spec.layout || 'PANELS'
  const panelCount = spec.panelCount || spec.panels?.length || (layout === 'PANELS' ? 3 : undefined)
  const stepCount = spec.stepCount || spec.steps?.length || (layout === 'STRIP' ? 5 : undefined)
  const panels = Array.isArray(spec.panels)
    ? spec.panels.map((p, idx) => `${idx + 1}) ${p.title}${Array.isArray(p.elements) && p.elements.length > 0 ? `: ${p.elements.join(', ')}` : ''}`).join(' | ')
    : 'none'
  const steps = Array.isArray(spec.steps) ? spec.steps.join(' -> ') : 'none'
  const genre = spec.figureGenre || 'METHOD_BLOCK'
  const peopleRule = genre === 'SCENARIO_STORYBOARD'
    ? 'Silhouettes allowed only if needed for scenario context.'
    : 'No people.'

  return [
    `Create an ${style} academic illustration titled "${title}".`,
    `Figure genre: ${genre}.`,
    `Layout: ${layout}; panelCount=${panelCount || 'n/a'}; stepCount=${stepCount || 'n/a'}; flow=${spec.flowDirection || 'LR'}.`,
    `Aspect ratio ${directives.aspectRatio}; fill >= ${directives.fillCanvasPercentMin}%; whitespace <= ${directives.whitespaceMaxPercent}%.`,
    `Text policy: max ${directives.textPolicy?.maxLabelsTotal} labels total, max ${directives.textPolicy?.maxWordsPerLabel} words/label, titles only preferred=${directives.textPolicy?.titlesOnlyPreferred}.`,
    `Style policy: noGradients=${directives.stylePolicy?.noGradients}, no3D=${directives.stylePolicy?.no3D}, noClipart=${directives.stylePolicy?.noClipart}, whiteBackground=${directives.stylePolicy?.whiteBackground}, palette=${directives.stylePolicy?.paletteMode}.`,
    `Panels: ${panels}.`,
    `Steps: ${steps}.`,
    `Elements: ${(spec.elements || []).join(', ') || 'icons, boxes, arrows'}.`,
    `${peopleRule} Avoid tiny text. No figure numbers/captions/watermarks.`
  ].join(' ')
}

function buildFallbackSpecFromDescription(description: string, title?: string): DiagramStructuredSpec {
  const baseNodes = [
    { idHint: 'inputStage', label: 'Input Stage', group: 'Input' },
    { idHint: 'processingStage', label: 'Processing Stage', group: 'Processing' },
    { idHint: 'validationStage', label: 'Validation Stage', group: 'Processing' },
    { idHint: 'outputStage', label: 'Output Stage', group: 'Output' }
  ]
  const titleNode = title
    ? { idHint: 'context', label: sanitizeDiagramLabel(title), group: 'Input' }
    : null

  return sanitizeDiagramSpec({
    layout: 'LR',
    nodes: titleNode ? [titleNode, ...baseNodes] : baseNodes,
    edges: [
      ...(titleNode ? [{ fromHint: 'context', toHint: 'inputStage', label: 'context', type: 'solid' as const }] : []),
      { fromHint: 'inputStage', toHint: 'processingStage', label: 'feeds', type: 'solid' },
      { fromHint: 'processingStage', toHint: 'validationStage', label: 'checks', type: 'solid' },
      { fromHint: 'validationStage', toHint: 'outputStage', label: 'outputs', type: 'solid' }
    ],
    groups: [
      { name: 'Input', nodeIds: titleNode ? ['context', 'inputStage'] : ['inputStage'] },
      { name: 'Processing', nodeIds: ['processingStage', 'validationStage'] },
      { name: 'Output', nodeIds: ['outputStage'] }
    ]
  }) as DiagramStructuredSpec
}

function normalizeSectionType(value?: string): SectionType {
  const raw = sanitizeAscii((value || '').toLowerCase().trim())
  if (!raw) return 'methodology'
  if (raw.includes('intro')) return 'introduction'
  if (raw.includes('literature') || raw.includes('related work') || raw.includes('background')) return 'literature_review'
  if (raw.includes('method')) return 'methodology'
  if (raw.includes('result') || raw.includes('evaluation') || raw.includes('experiment')) return 'results'
  if (raw.includes('discussion')) return 'discussion'
  if (raw.includes('conclusion') || raw.includes('future work')) return 'conclusion'
  if (raw.includes('selected')) return 'selected_content'
  return 'methodology'
}

function defaultFigureRole(section: SectionType): FigureRole {
  if (section === 'introduction') return 'ORIENT'
  if (section === 'literature_review') return 'POSITION'
  if (section === 'methodology') return 'EXPLAIN_METHOD'
  if (section === 'results') return 'SHOW_RESULTS'
  return 'INTERPRET'
}

function normalizeFigureRole(value: unknown, section: SectionType): FigureRole {
  const raw = sanitizeAscii(String(value || '')).toUpperCase().trim()
  if (
    raw === 'ORIENT' ||
    raw === 'POSITION' ||
    raw === 'EXPLAIN_METHOD' ||
    raw === 'SHOW_RESULTS' ||
    raw === 'INTERPRET'
  ) {
    return raw
  }
  return defaultFigureRole(section)
}

function coerceFigureCategory(value: string): FigureCategory {
  const normalized = sanitizeAscii((value || '').trim().toUpperCase())
  if (normalized === 'DATA_CHART') return 'DATA_CHART'
  if (normalized === 'DIAGRAM') return 'DIAGRAM'
  if (normalized === 'STATISTICAL_PLOT') return 'STATISTICAL_PLOT'
  if (normalized === 'ILLUSTRATED_FIGURE') return 'ILLUSTRATED_FIGURE'
  if (normalized === 'ILLUSTRATION' || normalized === 'SKETCH') return 'ILLUSTRATED_FIGURE'
  return 'DIAGRAM'
}

function sanitizeChartSpec(
  spec?: ChartStructuredSpec | null,
  fallbackType?: string
): ChartStructuredSpec | undefined {
  if (!spec || typeof spec !== 'object') return undefined
  const chartType = sanitizeAscii((spec.chartType || fallbackType || 'bar') as string).toLowerCase()
  const validType = ['bar', 'line', 'pie', 'scatter', 'radar', 'doughnut'].includes(chartType) ? chartType : 'bar'
  const sanitizeField = (value?: string, max: number = 80) => sanitizeAscii(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  const xAxisLabel = sanitizeField(spec.xAxisLabel || 'X Axis')
  const yAxisLabel = sanitizeField(spec.yAxisLabel || 'Y Axis')
  const xField = sanitizeField(spec.xField || 'x_value', 60)
  const yField = sanitizeField(spec.yField || 'y_value', 60)
  const series = Array.isArray(spec.series)
    ? spec.series.slice(0, 6).map((item, idx) => ({
        label: sanitizeField(item?.label || `Series ${idx + 1}`, 80),
        yField: sanitizeField(item?.yField || yField, 60),
        confidenceField: item?.confidenceField ? sanitizeField(item.confidenceField, 60) : undefined
      }))
    : undefined

  return {
    chartType: validType as DataChartType,
    xAxisLabel: xAxisLabel || 'X Axis',
    yAxisLabel: yAxisLabel || 'Y Axis',
    xField: xField || 'x_value',
    yField: yField || 'y_value',
    series,
    aggregation: sanitizeField(spec.aggregation || '', 24) || undefined,
    baselineLabel: sanitizeField(spec.baselineLabel || '', 80) || undefined,
    placeholderPolicy: spec.placeholderPolicy
      ? {
          allowed: typeof spec.placeholderPolicy.allowed === 'boolean'
            ? spec.placeholderPolicy.allowed
            : undefined,
          label: sanitizeField(spec.placeholderPolicy.label || '', 120) || undefined,
          shape: sanitizeField(spec.placeholderPolicy.shape || '', 48) || undefined,
          rangeHint: sanitizeField(spec.placeholderPolicy.rangeHint || '', 120) || undefined
        }
      : undefined,
    notes: sanitizeAscii(spec.notes || '').slice(0, 180) || undefined
  }
}

function buildFallbackChartSpec(
  section: SectionType,
  suggestedType?: string
): ChartStructuredSpec {
  const chartTypeRaw = sanitizeAscii((suggestedType || (section === 'results' ? 'bar' : 'line')).toLowerCase())
  const chartType = ['bar', 'line', 'pie', 'scatter', 'radar', 'doughnut'].includes(chartTypeRaw) ? chartTypeRaw : 'bar'
  const yLabel = section === 'results' ? 'Performance Metric (%)' : 'Metric Value'
  return {
    chartType: chartType as DataChartType,
    xAxisLabel: 'Category / Condition',
    yAxisLabel: yLabel,
    xField: 'condition',
    yField: 'value',
    series: [
      { label: 'Primary Metric', yField: 'value' },
      { label: 'Baseline', yField: 'baseline_value' }
    ],
    aggregation: 'mean',
    baselineLabel: 'Baseline',
    placeholderPolicy: {
      allowed: false,
      label: 'Sample Data (replace with actual values)',
      shape: 'modest_gain',
      rangeHint: 'Use real observed metric ranges from the paper.'
    }
  }
}

function sanitizeIllustrationSpec(
  spec?: IllustrationStructuredSpec | null
): IllustrationStructuredSpec | undefined {
  if (!spec || typeof spec !== 'object') return undefined
  const layout = spec.layout === 'STRIP' ? 'STRIP' : 'PANELS'
  const panelCountRaw = Number(spec.panelCount || (Array.isArray(spec.panels) ? spec.panels.length : 0))
  const stepCountRaw = Number(spec.stepCount || (Array.isArray(spec.steps) ? spec.steps.length : 0))
  const panelCount = Number.isFinite(panelCountRaw) && panelCountRaw > 0 ? Math.max(1, Math.min(6, Math.round(panelCountRaw))) : undefined
  const stepCount = Number.isFinite(stepCountRaw) && stepCountRaw > 0 ? Math.max(1, Math.min(8, Math.round(stepCountRaw))) : undefined
  const panels = Array.isArray(spec.panels)
    ? spec.panels.slice(0, 6).map((panel, idx) => ({
        idHint: sanitizeAlias(panel?.idHint || `panel${idx + 1}`, idx),
        title: sanitizeDiagramLabel(panel?.title || `Panel ${idx + 1}`),
        elements: Array.isArray(panel?.elements)
          ? panel.elements.slice(0, 6).map(item => sanitizeDiagramLabel(item || 'Element'))
          : undefined
      }))
    : undefined
  const elements = Array.isArray(spec.elements)
    ? spec.elements.slice(0, 10).map(item => sanitizeDiagramLabel(item || 'Element'))
    : undefined
  const steps = Array.isArray(spec.steps)
    ? spec.steps.slice(0, 8).map(item => sanitizeDiagramLabel(item || 'Step'))
    : undefined

  return {
    layout,
    panelCount,
    stepCount,
    flowDirection: spec.flowDirection === 'TD' ? 'TD' : 'LR',
    panels,
    elements,
    steps,
    captionDraft: spec.captionDraft ? sanitizeAscii(spec.captionDraft).slice(0, 180) : undefined,
    splitSuggestion: spec.splitSuggestion ? sanitizeAscii(spec.splitSuggestion).slice(0, 180) : undefined
  }
}

function sanitizeIllustrationFigureGenre(input?: unknown): IllustrationFigureGenre | undefined {
  const raw = sanitizeAscii(String(input || '')).toUpperCase().trim()
  if (
    raw === 'METHOD_BLOCK' ||
    raw === 'SCENARIO_STORYBOARD' ||
    raw === 'CONCEPTUAL_FRAMEWORK' ||
    raw === 'GRAPHICAL_ABSTRACT'
  ) {
    return raw
  }
  return undefined
}

function buildDefaultRenderDirectives(genre: IllustrationFigureGenre): IllustrationRenderDirectives {
  if (genre === 'SCENARIO_STORYBOARD') {
    return {
      aspectRatio: '2.5:1',
      fillCanvasPercentMin: 85,
      whitespaceMaxPercent: 15,
      textPolicy: {
        maxLabelsTotal: 4,
        maxWordsPerLabel: 3,
        forbidAllCaps: true,
        titlesOnlyPreferred: true
      },
      stylePolicy: {
        noGradients: true,
        no3D: true,
        noClipart: true,
        whiteBackground: true,
        paletteMode: 'grayscale_plus_one_accent'
      },
      compositionPolicy: {
        layoutMode: 'PANELS',
        equalPanels: true,
        noTextOutsidePanels: true
      }
    }
  }

  return {
    aspectRatio: '3:1',
    fillCanvasPercentMin: 85,
    whitespaceMaxPercent: 15,
    textPolicy: {
      maxLabelsTotal: 4,
      maxWordsPerLabel: 3,
      forbidAllCaps: true,
      titlesOnlyPreferred: true
    },
    stylePolicy: {
      noGradients: true,
      no3D: true,
      noClipart: true,
      whiteBackground: true,
      paletteMode: 'grayscale_plus_one_accent'
    },
    compositionPolicy: {
      layoutMode: 'STRIP',
      equalPanels: true,
      noTextOutsidePanels: true
    }
  }
}

function inferIllustrationGenre(section: SectionType, spec?: IllustrationStructuredSpec | null): IllustrationFigureGenre {
  if (section === 'methodology') return 'METHOD_BLOCK'
  if (section === 'results') return 'METHOD_BLOCK'
  if (section === 'introduction' || section === 'discussion' || section === 'conclusion') {
    if ((spec?.layout === 'PANELS') || Number(spec?.panelCount || 0) >= 2) return 'SCENARIO_STORYBOARD'
    return 'CONCEPTUAL_FRAMEWORK'
  }
  if (section === 'literature_review') return 'CONCEPTUAL_FRAMEWORK'
  return 'METHOD_BLOCK'
}

function sanitizeRenderDirectives(input?: any, fallbackGenre: IllustrationFigureGenre = 'METHOD_BLOCK'): IllustrationRenderDirectives {
  const fallback = buildDefaultRenderDirectives(fallbackGenre)
  const directives = input && typeof input === 'object' ? input : {}
  const sanitizeInt = (value: unknown, min: number, max: number, fallbackValue: number): number => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallbackValue
    return Math.max(min, Math.min(max, Math.round(n)))
  }
  const sanitizeFloat = (value: unknown, min: number, max: number, fallbackValue: number): number => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallbackValue
    return Math.max(min, Math.min(max, n))
  }
  const sanitizeRatio = (value: unknown, fallbackValue: string): string => {
    const raw = sanitizeAscii(String(value || '')).trim()
    if (!raw) return fallbackValue
    if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(raw)) return fallbackValue
    return raw
  }

  return {
    aspectRatio: sanitizeRatio(directives.aspectRatio, fallback.aspectRatio || '3:1'),
    fillCanvasPercentMin: sanitizeFloat(directives.fillCanvasPercentMin, 50, 100, fallback.fillCanvasPercentMin || 85),
    whitespaceMaxPercent: sanitizeFloat(directives.whitespaceMaxPercent, 0, 50, fallback.whitespaceMaxPercent || 15),
    textPolicy: {
      maxLabelsTotal: sanitizeInt(directives?.textPolicy?.maxLabelsTotal, 0, 12, fallback.textPolicy?.maxLabelsTotal || 4),
      maxWordsPerLabel: sanitizeInt(directives?.textPolicy?.maxWordsPerLabel, 1, 8, fallback.textPolicy?.maxWordsPerLabel || 3),
      forbidAllCaps: typeof directives?.textPolicy?.forbidAllCaps === 'boolean'
        ? directives.textPolicy.forbidAllCaps
        : (fallback.textPolicy?.forbidAllCaps ?? true),
      titlesOnlyPreferred: typeof directives?.textPolicy?.titlesOnlyPreferred === 'boolean'
        ? directives.textPolicy.titlesOnlyPreferred
        : (fallback.textPolicy?.titlesOnlyPreferred ?? true)
    },
    stylePolicy: {
      noGradients: typeof directives?.stylePolicy?.noGradients === 'boolean'
        ? directives.stylePolicy.noGradients
        : (fallback.stylePolicy?.noGradients ?? true),
      no3D: typeof directives?.stylePolicy?.no3D === 'boolean'
        ? directives.stylePolicy.no3D
        : (fallback.stylePolicy?.no3D ?? true),
      noClipart: typeof directives?.stylePolicy?.noClipart === 'boolean'
        ? directives.stylePolicy.noClipart
        : (fallback.stylePolicy?.noClipart ?? true),
      whiteBackground: typeof directives?.stylePolicy?.whiteBackground === 'boolean'
        ? directives.stylePolicy.whiteBackground
        : (fallback.stylePolicy?.whiteBackground ?? true),
      paletteMode: sanitizeAscii(directives?.stylePolicy?.paletteMode || fallback.stylePolicy?.paletteMode || 'grayscale_plus_one_accent').slice(0, 60)
    },
    compositionPolicy: {
      layoutMode: directives?.compositionPolicy?.layoutMode === 'PANELS' || directives?.compositionPolicy?.layoutMode === 'STRIP'
        ? directives.compositionPolicy.layoutMode
        : (fallback.compositionPolicy?.layoutMode || 'PANELS'),
      equalPanels: typeof directives?.compositionPolicy?.equalPanels === 'boolean'
        ? directives.compositionPolicy.equalPanels
        : (fallback.compositionPolicy?.equalPanels ?? true),
      noTextOutsidePanels: typeof directives?.compositionPolicy?.noTextOutsidePanels === 'boolean'
        ? directives.compositionPolicy.noTextOutsidePanels
        : (fallback.compositionPolicy?.noTextOutsidePanels ?? true)
    }
  }
}

function sanitizeIllustrationSpecV2(
  spec?: IllustrationStructuredSpecV2 | null,
  section: SectionType = 'methodology'
): IllustrationStructuredSpecV2 | undefined {
  if (!spec || typeof spec !== 'object') return undefined
  const legacy = sanitizeIllustrationSpec(spec)
  if (!legacy) return undefined
  const figureGenre = sanitizeIllustrationFigureGenre(spec.figureGenre) || inferIllustrationGenre(section, legacy)
  const renderDirectives = sanitizeRenderDirectives(spec.renderDirectives, figureGenre)
  return {
    ...legacy,
    figureGenre,
    renderDirectives,
    actors: Array.isArray((spec as any).actors)
      ? (spec as any).actors.slice(0, 8).map((item: unknown) => sanitizeAscii(String(item || '')).slice(0, 40)).filter(Boolean)
      : undefined,
    props: Array.isArray((spec as any).props)
      ? (spec as any).props.slice(0, 10).map((item: unknown) => sanitizeAscii(String(item || '')).slice(0, 40)).filter(Boolean)
      : undefined,
    forbiddenElements: Array.isArray((spec as any).forbiddenElements)
      ? (spec as any).forbiddenElements.slice(0, 12).map((item: unknown) => sanitizeAscii(String(item || '')).slice(0, 40)).filter(Boolean)
      : undefined
  }
}

function buildFallbackIllustrationSpec(section: SectionType): IllustrationStructuredSpec {
  return {
    layout: 'PANELS',
    panelCount: 4,
    flowDirection: 'LR',
    panels: [
      { idHint: 'panelInput', title: 'Inputs', elements: ['Data', 'Context'] },
      { idHint: 'panelMethod', title: 'Method', elements: ['Pipeline', 'Model'] },
      { idHint: 'panelOutput', title: 'Outputs', elements: ['Prediction', 'Metrics'] },
      { idHint: 'panelEval', title: section === 'results' ? 'Summary' : 'Evaluation', elements: ['Comparison', 'Insight'] }
    ],
    elements: ['icons', 'boxes', 'arrows', 'badges'],
    steps: ['Input', 'Process', 'Output', 'Evaluate'],
    captionDraft: 'Infographic overview summarizing the study workflow and outcomes.'
  }
}

function buildFallbackIllustrationSpecV2(section: SectionType): IllustrationStructuredSpecV2 {
  const base = buildFallbackIllustrationSpec(section)
  const figureGenre = inferIllustrationGenre(section, base)
  return {
    ...base,
    figureGenre,
    renderDirectives: buildDefaultRenderDirectives(figureGenre)
  }
}

function buildRenderSpecForSuggestion(suggestion: FigureSuggestion): FigureRenderSpec {
  if (suggestion.category === 'DIAGRAM') {
    return {
      kind: 'diagram',
      diagramSpec: suggestion.diagramSpec
    }
  }
  if (suggestion.category === 'DATA_CHART' || suggestion.category === 'STATISTICAL_PLOT') {
    return {
      kind: 'chart',
      chartSpec: suggestion.chartSpec
    }
  }
  return {
    kind: 'illustration',
    illustrationSpecV2: suggestion.illustrationSpecV2
  }
}

function hasQuantitativeEvidence(request: FigureSuggestionRequest): boolean {
  const source = sanitizeAscii(
    `${request.datasetDescription || ''}\n${request.paperAbstract || ''}\n${Object.values(request.sections || {}).join('\n')}`
  ).toLowerCase()
  if (!source.trim()) return false

  const numericPattern = /\b\d+(?:\.\d+)?\b/
  const metricPattern = /\b(accuracy|precision|recall|f1|auc|rmse|mae|mape|latency|throughput|score|metric|mean|median|std|variance|error|ablation|baseline|improvement|table|distribution|count|n\s*=)\b/
  const tabularPattern = /\b(table\s+\d+|dataset|samples|records|observations|rows|columns)\b/

  return (
    (numericPattern.test(source) && metricPattern.test(source)) ||
    tabularPattern.test(source)
  )
}

function detectPaperGenre(text: string): string {
  const source = sanitizeAscii(text.toLowerCase())
  if (/\b(neural|transformer|llm|deep learning|machine learning|classification|regression|benchmark)\b/.test(source)) return 'ml_ai'
  if (/\b(software|repository|module|framework|codebase|api|microservice)\b/.test(source)) return 'systems_se'
  if (/\b(education|classroom|student|learning outcomes|curriculum)\b/.test(source)) return 'education'
  if (/\b(clinical|patient|disease|biomedical|gene|cohort|trial)\b/.test(source)) return 'biomedical'
  if (/\b(network|routing|latency|throughput|packet|wireless)\b/.test(source)) return 'networking'
  if (/\b(user study|usability|human computer|hci|participant)\b/.test(source)) return 'hci'
  return 'general_research'
}

function detectStudyType(text: string): PaperProfile['studyType'] {
  const source = sanitizeAscii(text.toLowerCase())
  if (/\b(ablation|benchmark|experiment|accuracy|precision|recall|dataset|baseline)\b/.test(source)) return 'experimental'
  if (/\b(systematic review|survey|taxonomy|literature review|prisma)\b/.test(source)) return 'survey'
  if (/\b(interview|thematic|qualitative|focus group|ethnography)\b/.test(source)) return 'qualitative'
  if (/\b(mixed methods|mixed-methods|quantitative and qualitative)\b/.test(source)) return 'mixed-methods'
  if (/\b(simulation|simulated|monte carlo|agent-based)\b/.test(source)) return 'simulation'
  if (/\b(theoretical|proof|formal analysis|closed-form)\b/.test(source)) return 'theoretical'
  return 'unknown'
}

function detectDataAvailability(
  datasetDescription?: string,
  sections?: Record<string, string>,
  abstract?: string
): PaperProfile['dataAvailability'] {
  const source = sanitizeAscii(`${datasetDescription || ''}\n${abstract || ''}\n${Object.values(sections || {}).join('\n')}`).toLowerCase()
  if (!source.trim()) return 'none'
  if (/\b(dataset|table|samples|records|measurements|observations|n\s*=|data collected|we report)\b/.test(source)) return 'provided'
  if (/\b(to be collected|future work|not yet available|pending)\b/.test(source)) return 'partial'
  if (/\b(no data|conceptual|theoretical only)\b/.test(source)) return 'none'
  return 'partial'
}

function inferPaperProfile(request: FigureSuggestionRequest): PaperProfile {
  const title = request.paperTitle || ''
  const abstract = request.paperAbstract || ''
  const sectionsText = Object.values(request.sections || {}).join('\n')
  const researchType = request.researchType || ''
  const corpus = `${title}\n${abstract}\n${sectionsText}\n${researchType}`
  const provided = request.paperProfile || {}

  return {
    paperGenre: sanitizeAscii((provided.paperGenre || '').trim()) || detectPaperGenre(corpus),
    studyType: provided.studyType || detectStudyType(corpus),
    dataAvailability: provided.dataAvailability || detectDataAvailability(request.datasetDescription, request.sections, abstract)
  }
}

function buildGroundingLexicon(request: FigureSuggestionRequest): Set<string> {
  const source = sanitizeAscii(
    `${request.paperTitle || ''}\n${request.paperAbstract || ''}\n${request.datasetDescription || ''}\n${Object.values(request.sections || {}).join('\n')}`
  ).toLowerCase()
  const stopwords = new Set([
    'the', 'and', 'with', 'from', 'into', 'that', 'this', 'those', 'these', 'their', 'there', 'where',
    'method', 'methods', 'paper', 'study', 'results', 'figure', 'analysis', 'section', 'using', 'used',
    'which', 'while', 'when', 'were', 'been', 'have', 'has', 'had', 'over', 'under', 'between', 'across'
  ])
  const tokens = source.match(/\b[a-z][a-z0-9_-]{3,}\b/g) || []
  const lexicon = new Set<string>()
  for (const token of tokens) {
    if (stopwords.has(token)) continue
    lexicon.add(token)
    if (lexicon.size >= 300) break
  }
  return lexicon
}

function estimateGroundingOverlap(text: string, lexicon: Set<string>): number {
  if (lexicon.size === 0) return 0
  const tokens = (sanitizeAscii(text).toLowerCase().match(/\b[a-z][a-z0-9_-]{3,}\b/g) || [])
  const unique = new Set(tokens)
  let overlap = 0
  unique.forEach(token => {
    if (lexicon.has(token)) overlap += 1
  })
  return overlap
}

type ValidationIssueCode = 'SECTION_FIT' | 'GROUNDING' | 'SPEC_COMPLETENESS' | 'COMPLEXITY' | 'DATA_GATE'

interface SuggestionValidationIssue {
  code: ValidationIssueCode
  reason: string
}

function validateSuggestion(
  suggestion: FigureSuggestion,
  context: {
    section: SectionType
    groundingLexicon: Set<string>
    quantitativeDataAvailable: boolean
  }
): SuggestionValidationIssue[] {
  const issues: SuggestionValidationIssue[] = []
  const section = context.section
  const category = suggestion.category
  const type = sanitizeAscii((suggestion.suggestedType || '').toLowerCase())

  // VR-1 Section fit
  if (section === 'results') {
    if (category === 'ILLUSTRATED_FIGURE') {
      issues.push({ code: 'SECTION_FIT', reason: 'Results section cannot include ILLUSTRATED_FIGURE.' })
    }
    if (category === 'DIAGRAM' && /(class|component|sequence|usecase|state|architecture)/.test(type)) {
      issues.push({ code: 'SECTION_FIT', reason: 'Results section disallows UML/architecture reminder diagrams by default.' })
    }
  }
  if (section === 'introduction' && category === 'DIAGRAM' && /(class|component|sequence|er)/.test(type)) {
    issues.push({ code: 'SECTION_FIT', reason: 'Introduction should avoid detailed UML structural diagrams by default.' })
  }
  if (section === 'literature_review' && category === 'DIAGRAM' && /(class|component|sequence)/.test(type)) {
    issues.push({ code: 'SECTION_FIT', reason: 'Literature review should prefer taxonomy/evidence maps over UML structures.' })
  }
  if ((section === 'discussion' || section === 'conclusion') && category === 'DIAGRAM' && /\bclass\b/.test(type)) {
    issues.push({ code: 'SECTION_FIT', reason: 'Discussion/conclusion defaults to implications/limitations diagrams, not class diagrams.' })
  }
  if (category === 'ILLUSTRATED_FIGURE' && section === 'methodology') {
    const genre = sanitizeIllustrationFigureGenre((suggestion.illustrationSpecV2 as any)?.figureGenre || suggestion.figureGenre)
    if (genre && genre !== 'METHOD_BLOCK') {
      issues.push({ code: 'SECTION_FIT', reason: 'Methodology illustrations must use METHOD_BLOCK genre.' })
    }
  }

  // VR-1b Data gate
  if (!context.quantitativeDataAvailable && (category === 'DATA_CHART' || category === 'STATISTICAL_PLOT')) {
    issues.push({ code: 'DATA_GATE', reason: 'Charts/plots are not allowed without quantitative evidence or user-provided data.' })
  }

  // VR-2 Grounding
  const overlap = estimateGroundingOverlap(
    `${suggestion.title || ''}\n${suggestion.description || ''}\n${suggestion.dataNeeded || ''}`,
    context.groundingLexicon
  )
  if (overlap < 2) {
    issues.push({ code: 'GROUNDING', reason: 'Suggestion has weak overlap with paper entities/metrics.' })
  }
  if (!suggestion.dataNeeded || !suggestion.dataNeeded.trim()) {
    issues.push({ code: 'GROUNDING', reason: 'dataNeeded is required and must specify exact variables or fields.' })
  }

  // VR-3 Spec completeness
  if (category === 'DIAGRAM' && !suggestion.diagramSpec) {
    issues.push({ code: 'SPEC_COMPLETENESS', reason: 'DIAGRAM suggestion is missing diagramSpec.' })
  }
  if ((category === 'DATA_CHART' || category === 'STATISTICAL_PLOT') && !suggestion.chartSpec) {
    issues.push({ code: 'SPEC_COMPLETENESS', reason: 'Chart suggestion is missing chartSpec.' })
  }
  if (category === 'ILLUSTRATED_FIGURE' && !suggestion.illustrationSpec) {
    issues.push({ code: 'SPEC_COMPLETENESS', reason: 'ILLUSTRATED_FIGURE suggestion is missing illustrationSpec.' })
  }
  if (category === 'ILLUSTRATED_FIGURE' && !suggestion.illustrationSpecV2) {
    issues.push({ code: 'SPEC_COMPLETENESS', reason: 'ILLUSTRATED_FIGURE suggestion is missing illustrationSpecV2.' })
  }
  if (!suggestion.renderSpec) {
    issues.push({ code: 'SPEC_COMPLETENESS', reason: 'renderSpec is required for every suggestion.' })
  } else {
    if ((category === 'DATA_CHART' || category === 'STATISTICAL_PLOT') && (suggestion.renderSpec.kind !== 'chart' || !suggestion.renderSpec.chartSpec)) {
      issues.push({ code: 'SPEC_COMPLETENESS', reason: 'renderSpec.kind=chart with chartSpec is required for chart suggestions.' })
    }
    if (category === 'DIAGRAM' && (suggestion.renderSpec.kind !== 'diagram' || !suggestion.renderSpec.diagramSpec)) {
      issues.push({ code: 'SPEC_COMPLETENESS', reason: 'renderSpec.kind=diagram with diagramSpec is required for diagram suggestions.' })
    }
    if (category === 'ILLUSTRATED_FIGURE' && (suggestion.renderSpec.kind !== 'illustration' || !suggestion.renderSpec.illustrationSpecV2)) {
      issues.push({ code: 'SPEC_COMPLETENESS', reason: 'renderSpec.kind=illustration with illustrationSpecV2 is required for illustrated suggestions.' })
    }
  }

  // VR-4 Complexity
  const nodeCount = suggestion.diagramSpec?.nodes?.length || 0
  const edgeCount = suggestion.diagramSpec?.edges?.length || 0
  if (nodeCount > 15 || edgeCount > 18) {
    issues.push({ code: 'COMPLEXITY', reason: `diagramSpec exceeds hard limits (nodes=${nodeCount}, edges=${edgeCount}).` })
  } else if ((nodeCount > 12 || edgeCount > 18) && !suggestion.diagramSpec?.splitSuggestion) {
    issues.push({ code: 'COMPLEXITY', reason: 'diagramSpec exceeds compact budget without splitSuggestion.' })
  }
  if (category === 'ILLUSTRATED_FIGURE' && suggestion.illustrationSpec) {
    const panelCount = suggestion.illustrationSpec.panelCount || suggestion.illustrationSpec.panels?.length || 0
    const stepCount = suggestion.illustrationSpec.stepCount || suggestion.illustrationSpec.steps?.length || 0
    if (suggestion.illustrationSpec.layout === 'PANELS' && panelCount > 0 && (panelCount < 3 || panelCount > 5)) {
      issues.push({ code: 'COMPLEXITY', reason: 'ILLUSTRATED_FIGURE panels must be between 3 and 5.' })
    }
    if (suggestion.illustrationSpec.layout === 'STRIP' && stepCount > 0 && (stepCount < 4 || stepCount > 7)) {
      issues.push({ code: 'COMPLEXITY', reason: 'ILLUSTRATED_FIGURE strip must contain 4-7 steps.' })
    }
  }
  if (category === 'DIAGRAM' && suggestion.diagramSpec) {
    const labels = (suggestion.diagramSpec.nodes || []).map(node => sanitizeAscii(node.label || '').toLowerCase().trim()).filter(Boolean)
    const duplicate = labels.find((label, idx) => labels.indexOf(label) !== idx)
    if (duplicate) {
      issues.push({ code: 'COMPLEXITY', reason: 'diagramSpec contains duplicate node labels; labels must be unique.' })
    }
    const overWord = (suggestion.diagramSpec.nodes || []).find(node => (sanitizeAscii(node.label || '').trim().split(/\s+/).filter(Boolean).length > 3))
    if (overWord) {
      issues.push({ code: 'COMPLEXITY', reason: 'diagramSpec node labels must be <= 3 words.' })
    }
  }
  if (category === 'ILLUSTRATED_FIGURE' && suggestion.illustrationSpecV2) {
    if (!suggestion.illustrationSpecV2.figureGenre) {
      issues.push({ code: 'SPEC_COMPLETENESS', reason: 'illustrationSpecV2.figureGenre is required.' })
    }
    if (!suggestion.illustrationSpecV2.renderDirectives) {
      issues.push({ code: 'SPEC_COMPLETENESS', reason: 'illustrationSpecV2.renderDirectives is required.' })
    }
  }

  return issues
}

function buildSectionAwareFallbackSuggestion(
  source: FigureSuggestion,
  section: SectionType,
  index: number,
  options: { quantitativeDataAvailable?: boolean } = {}
): FigureSuggestion {
  const baseTitle = sanitizeAscii(source.title || `Figure ${index + 1}`).slice(0, 120) || `Figure ${index + 1}`
  const baseDescription = sanitizeAscii(source.description || '').slice(0, 700)
  const role = defaultFigureRole(section)
  const baseImportance = source.importance || (section === 'results' || section === 'methodology' ? 'required' : 'recommended')
  const sectionText = section === 'selected_content' ? 'methodology' : section
  const quantitativeDataAvailable = !!options.quantitativeDataAvailable

  const withRenderSpec = (candidate: FigureSuggestion): FigureSuggestion => {
    const next: FigureSuggestion = { ...candidate }
    if (next.category === 'ILLUSTRATED_FIGURE') {
      next.illustrationSpec = next.illustrationSpec || buildFallbackIllustrationSpec(section)
      next.illustrationSpecV2 = next.illustrationSpecV2 || buildFallbackIllustrationSpecV2(section)
      next.figureGenre = next.figureGenre || next.illustrationSpecV2.figureGenre
      next.renderDirectives = next.renderDirectives || next.illustrationSpecV2.renderDirectives
      next.sketchMode = next.sketchMode || 'GUIDED'
      next.sketchStyle = next.sketchStyle || 'academic'
      next.sketchPrompt = next.sketchPrompt || buildSketchPromptFromIllustrationSpecV2(next.title, next.illustrationSpecV2, next.sketchStyle)
    }
    next.renderSpec = buildRenderSpecForSuggestion(next)
    return next
  }

  if (section === 'results') {
    if (quantitativeDataAvailable) {
      return withRenderSpec({
        ...source,
        title: baseTitle,
        description: baseDescription || 'Comparison chart showing baseline vs proposed method with plausible, modest differences and optional uncertainty markers.',
        category: 'DATA_CHART',
        suggestedType: 'bar',
        relevantSection: sectionText,
        figureRole: role,
        sectionFitJustification: 'Results sections require quantitative evidence and direct comparisons.',
        expectedByReviewers: true,
        importance: baseImportance,
        dataNeeded: source.dataNeeded || 'Per-method metric values across datasets/runs, including baseline and proposed variants.',
        chartSpec: source.chartSpec || buildFallbackChartSpec(section, 'bar'),
        diagramSpec: undefined,
        illustrationSpec: undefined,
        illustrationSpecV2: undefined,
        figureGenre: undefined,
        renderDirectives: undefined,
        sketchMode: undefined,
        sketchPrompt: undefined,
        sketchStyle: undefined
      })
    }

    return withRenderSpec({
      ...source,
      title: baseTitle.includes('Evaluation') ? baseTitle : `${baseTitle} Evaluation Protocol`,
      description: baseDescription || 'Evaluation protocol schematic showing datasets, baselines, metrics, and analysis flow when quantitative values are not yet available.',
      category: 'DIAGRAM',
      suggestedType: 'flowchart',
      rendererPreference: 'plantuml',
      relevantSection: sectionText,
      figureRole: role,
      sectionFitJustification: 'Results without quantitative values should use evaluation protocol diagrams and request missing data.',
      expectedByReviewers: true,
      importance: baseImportance,
      dataNeeded: source.dataNeeded || 'Missing quantitative fields: baseline metric values, proposed metric values, confidence intervals, and per-dataset sample counts.',
      diagramSpec: source.diagramSpec || buildFallbackSpecFromDescription(baseDescription || baseTitle, `${baseTitle} Evaluation`),
      chartSpec: undefined,
      illustrationSpec: undefined,
      illustrationSpecV2: undefined,
      figureGenre: undefined,
      renderDirectives: undefined
    })
  }

  if (section === 'methodology') {
    return withRenderSpec({
      ...source,
      title: baseTitle.includes('Pipeline') ? baseTitle : `${baseTitle} Pipeline`,
      description: baseDescription || 'Pipeline/activity diagram showing ordered method stages from input to evaluation, with data transformations and validation checkpoints.',
      category: 'DIAGRAM',
      suggestedType: 'flowchart',
      rendererPreference: 'plantuml',
      relevantSection: sectionText,
      figureRole: role,
      sectionFitJustification: 'Methodology requires reproducible step-by-step process visualization.',
      expectedByReviewers: true,
      importance: baseImportance,
      dataNeeded: source.dataNeeded || 'Method stages, inputs/outputs of each stage, and control/validation transitions.',
      diagramSpec: source.diagramSpec || buildFallbackSpecFromDescription(baseDescription || baseTitle, baseTitle),
      chartSpec: undefined,
      illustrationSpec: undefined,
      illustrationSpecV2: undefined,
      figureGenre: undefined,
      renderDirectives: undefined
    })
  }

  if (section === 'introduction') {
    const fallbackV2 = source.illustrationSpecV2 || buildFallbackIllustrationSpecV2(section)
    return withRenderSpec({
      ...source,
      title: baseTitle.includes('Overview') ? baseTitle : `${baseTitle} Overview`,
      description: baseDescription || 'High-level infographic overview connecting problem context, proposed approach, and expected outcomes.',
      category: 'ILLUSTRATED_FIGURE',
      suggestedType: 'sketch-auto',
      relevantSection: sectionText,
      figureRole: role,
      sectionFitJustification: 'Introduction figures should orient readers with high-level overview context.',
      expectedByReviewers: false,
      importance: baseImportance,
      dataNeeded: source.dataNeeded || 'Named problem context, key method stages, and headline outcomes to depict.',
      illustrationSpec: source.illustrationSpec || buildFallbackIllustrationSpec(section),
      illustrationSpecV2: fallbackV2,
      figureGenre: source.figureGenre || fallbackV2.figureGenre,
      renderDirectives: source.renderDirectives || fallbackV2.renderDirectives,
      sketchStyle: source.sketchStyle || 'academic',
      sketchMode: source.sketchMode || 'GUIDED',
      sketchPrompt: source.sketchPrompt || buildSketchPromptFromIllustrationSpecV2(baseTitle, fallbackV2, source.sketchStyle || 'academic'),
      diagramSpec: undefined,
      chartSpec: undefined,
      rendererPreference: undefined
    })
  }

  if (section === 'literature_review') {
    return withRenderSpec({
      ...source,
      title: baseTitle.includes('Taxonomy') ? baseTitle : `${baseTitle} Taxonomy`,
      description: baseDescription || 'Taxonomy/evidence-map diagram organizing prior work categories and identifying explicit research gaps.',
      category: 'DIAGRAM',
      suggestedType: 'flowchart',
      rendererPreference: 'plantuml',
      relevantSection: sectionText,
      figureRole: role,
      sectionFitJustification: 'Literature review figures should position prior work and reveal gaps.',
      expectedByReviewers: true,
      importance: baseImportance,
      dataNeeded: source.dataNeeded || 'Prior work categories, representative studies, and gap criteria.',
      diagramSpec: source.diagramSpec || buildFallbackSpecFromDescription(baseDescription || baseTitle, baseTitle),
      chartSpec: undefined,
      illustrationSpec: undefined,
      illustrationSpecV2: undefined,
      figureGenre: undefined,
      renderDirectives: undefined
    })
  }

  if (quantitativeDataAvailable) {
    return withRenderSpec({
      ...source,
      title: baseTitle,
      description: baseDescription || 'Interpretive figure summarizing implications, limitations, and practical boundaries.',
      category: 'STATISTICAL_PLOT',
      suggestedType: 'line',
      relevantSection: sectionText,
      figureRole: role,
      sectionFitJustification: 'Discussion/conclusion figures should interpret evidence and boundaries.',
      expectedByReviewers: false,
      importance: baseImportance,
      dataNeeded: source.dataNeeded || 'Error breakdowns, subgroup sensitivities, and edge-condition metrics.',
      chartSpec: source.chartSpec || buildFallbackChartSpec(section, 'line'),
      diagramSpec: undefined,
      illustrationSpec: undefined,
      illustrationSpecV2: undefined,
      figureGenre: undefined,
      renderDirectives: undefined,
      rendererPreference: undefined
    })
  }

  return withRenderSpec({
    ...source,
    title: baseTitle.includes('Implications') ? baseTitle : `${baseTitle} Implications`,
    description: baseDescription || 'Interpretive relationship diagram summarizing implications, limitations, and practical boundaries.',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: sectionText,
    figureRole: role,
    sectionFitJustification: 'Without quantitative values, discussion/conclusion should use conceptual interpretation diagrams.',
    expectedByReviewers: false,
    importance: baseImportance,
    dataNeeded: source.dataNeeded || 'Missing quantitative evidence required for plots: subgroup metrics, error distributions, and confidence intervals.',
    diagramSpec: source.diagramSpec || buildFallbackSpecFromDescription(baseDescription || baseTitle, baseTitle),
    chartSpec: undefined,
    illustrationSpec: undefined,
    illustrationSpecV2: undefined,
    figureGenre: undefined,
    renderDirectives: undefined,
    rendererPreference: 'plantuml'
  })
}

function cleanPlantUMLResponse(raw: string): string {
  let cleaned = raw.trim()
  const pumlBlockMatch = cleaned.match(/```(?:plantuml|puml)?\s*\n?([\s\S]*?)```/i)
  if (pumlBlockMatch) cleaned = pumlBlockMatch[1].trim()

  const startIdx = cleaned.indexOf('@startuml')
  const endIdx = cleaned.lastIndexOf('@enduml')
  if (startIdx >= 0 && endIdx >= 0 && endIdx > startIdx) {
    cleaned = cleaned.slice(startIdx, endIdx + '@enduml'.length)
  } else {
    if (!cleaned.includes('@startuml')) cleaned = `@startuml\n${cleaned}`
    if (!cleaned.includes('@enduml')) cleaned = `${cleaned}\n@enduml`
  }

  cleaned = cleaned.replace(/(@startuml\s*\n)+/g, '@startuml\n')
  cleaned = cleaned.replace(/(\n\s*@enduml)+/g, '\n@enduml')
  cleaned = sanitizeAscii(cleaned, true)
  return cleaned
}

type CanonicalMermaidTemplateType =
  | 'flowchart'
  | 'sequence'
  | 'state'
  | 'er'
  | 'gantt'

type MermaidFlowchartVariant = 'pipeline' | 'topology'

function normalizeMermaidTemplateType(
  input?: string,
  description?: string
): {
  inputType: string
  templateType: CanonicalMermaidTemplateType
  flowchartVariant?: MermaidFlowchartVariant
  compatibilityNote?: string
} {
  const raw = sanitizeAscii((input || '').toLowerCase().trim())
  const context = sanitizeAscii(`${raw} ${description || ''}`.toLowerCase())
  const topologyLike = /(topology|network|hub|spoke|gateway|service mesh)/.test(context)

  if (!raw) {
    return {
      inputType: 'unspecified',
      templateType: 'flowchart',
      flowchartVariant: topologyLike ? 'topology' : 'pipeline',
      compatibilityNote: 'No diagram type provided; defaulted to flowchart fallback template.'
    }
  }

  const direct: Record<string, CanonicalMermaidTemplateType> = {
    flowchart: 'flowchart',
    sequence: 'sequence',
    state: 'state',
    er: 'er',
    gantt: 'gantt'
  }
  if (direct[raw]) {
    return {
      inputType: raw,
      templateType: direct[raw],
      flowchartVariant: direct[raw] === 'flowchart' ? (topologyLike ? 'topology' : 'pipeline') : undefined
    }
  }

  const compatibilityMap: Record<string, CanonicalMermaidTemplateType> = {
    architecture: 'flowchart',
    topology: 'flowchart',
    deployment: 'flowchart',
    activity: 'flowchart',
    class: 'flowchart',
    component: 'flowchart',
    usecase: 'flowchart',
    timeline: 'gantt',
    mindmap: 'flowchart',
    plantuml: 'flowchart'
  }

  if (compatibilityMap[raw]) {
    const mapped = compatibilityMap[raw]
    return {
      inputType: raw,
      templateType: mapped,
      flowchartVariant: mapped === 'flowchart'
        ? ((raw === 'topology' || topologyLike) ? 'topology' : 'pipeline')
        : undefined,
      compatibilityNote: `Mapped legacy diagramType "${raw}" to Mermaid fallback template "${mapped}".`
    }
  }

  return {
    inputType: raw,
    templateType: 'flowchart',
    flowchartVariant: topologyLike ? 'topology' : 'pipeline',
    compatibilityNote: `Unknown diagramType "${raw}" defaulted to Mermaid flowchart fallback template.`
  }
}

type CanonicalPlantUMLTemplateType =
  | 'architecture'
  | 'topology'
  | 'deployment'
  | 'activity'
  | 'sequence'
  | 'class'

function normalizePlantUMLTemplateType(input?: string): {
  inputType: string
  templateType: CanonicalPlantUMLTemplateType
  compatibilityNote?: string
} {
  const raw = sanitizeAscii((input || '').toLowerCase().trim())
  if (!raw) {
    return {
      inputType: 'unspecified',
      templateType: 'architecture',
      compatibilityNote: 'No diagram type provided; defaulted to architecture template.'
    }
  }

  const direct: Record<string, CanonicalPlantUMLTemplateType> = {
    architecture: 'architecture',
    topology: 'topology',
    deployment: 'deployment',
    activity: 'activity',
    sequence: 'sequence',
    class: 'class'
  }
  if (direct[raw]) {
    return { inputType: raw, templateType: direct[raw] }
  }

  const compatibilityMap: Record<string, CanonicalPlantUMLTemplateType> = {
    flowchart: 'activity',
    component: 'architecture',
    usecase: 'activity',
    state: 'activity',
    er: 'class',
    gantt: 'activity',
    timeline: 'activity',
    mindmap: 'architecture',
    plantuml: 'architecture'
  }

  if (compatibilityMap[raw]) {
    return {
      inputType: raw,
      templateType: compatibilityMap[raw],
      compatibilityNote: `Mapped legacy diagramType "${raw}" to template "${compatibilityMap[raw]}" for compatibility.`
    }
  }

  if (raw.includes('topology') || raw.includes('network')) {
    return {
      inputType: raw,
      templateType: 'topology',
      compatibilityNote: `Mapped inferred diagramType "${raw}" to topology template.`
    }
  }
  if (raw.includes('deploy') || raw.includes('infra') || raw.includes('cloud')) {
    return {
      inputType: raw,
      templateType: 'deployment',
      compatibilityNote: `Mapped inferred diagramType "${raw}" to deployment template.`
    }
  }

  return {
    inputType: raw,
    templateType: 'architecture',
    compatibilityNote: `Unknown diagramType "${raw}" defaulted to architecture template.`
  }
}

function mermaidMatchesTemplateType(code: string, templateType: CanonicalMermaidTemplateType): boolean {
  const normalized = (code || '').trim()

  switch (templateType) {
    case 'gantt':
      return /(^|\n)gantt\b/.test(normalized)
    case 'sequence':
      return /(^|\n)sequenceDiagram\b/.test(normalized)
    case 'state':
      return /(^|\n)stateDiagram(?:-v2)?\b/.test(normalized)
    case 'er':
      return /(^|\n)erDiagram\b/.test(normalized)
    case 'flowchart':
    default:
      return /(^|\n)(flowchart|graph)\b/.test(normalized)
  }
}

/**
 * Validate and repair a Chart.js configuration from LLM output
 */
export function validateChartConfig(config: any): { valid: boolean; config?: any; error?: string } {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Config is not an object' }
  }

  // Must have type and data
  if (!config.type) {
    return { valid: false, error: 'Missing chart type' }
  }

  if (!config.data || typeof config.data !== 'object') {
    return { valid: false, error: 'Missing data object' }
  }

  // Normalize type
  const validTypes = ['bar', 'horizontalBar', 'line', 'scatter', 'pie', 'doughnut', 'radar', 'polarArea', 'bubble']
  if (!validTypes.includes(config.type)) {
    config.type = 'bar' // Safe fallback
  }

  // Ensure labels array
  if (!Array.isArray(config.data.labels)) {
    config.data.labels = []
  }

  // Ensure datasets array
  if (!Array.isArray(config.data.datasets) || config.data.datasets.length === 0) {
    return { valid: false, error: 'No datasets in config' }
  }

  // Validate each dataset has a data array with numbers
  for (const ds of config.data.datasets) {
    if (!Array.isArray(ds.data)) {
      return { valid: false, error: 'Dataset missing data array' }
    }

    if (config.type === 'scatter' || config.type === 'bubble') {
      const normalizedPoints = ds.data
        .map((point: any) => {
          if (!point || typeof point !== 'object') return null
          const x = Number(point.x)
          const y = Number(point.y)
          const r = config.type === 'bubble' ? Number(point.r) : undefined

          if (!Number.isFinite(x) || !Number.isFinite(y)) return null
          if (config.type === 'bubble' && !Number.isFinite(r)) return null

          return config.type === 'bubble'
            ? { x, y, r }
            : { x, y }
        })
        .filter((point: any) => !!point)

      if (!normalizedPoints.length) {
        return { valid: false, error: `${config.type} dataset must contain x/y point objects` }
      }

      ds.data = normalizedPoints
    } else {
      ds.data = ds.data.map((v: any) => {
        const num = Number(v)
        return isNaN(num) ? 0 : num
      })
    }

    // Ensure label
    if (!ds.label) ds.label = 'Data'
  }

  // For non-pie charts, ensure labels and data have matching lengths
  if (!['pie', 'doughnut', 'radar', 'polarArea', 'scatter', 'bubble'].includes(config.type)) {
    const maxDataLen = Math.max(...config.data.datasets.map((ds: any) => ds.data.length))
    if (config.data.labels.length === 0 && maxDataLen > 0) {
      config.data.labels = Array.from({ length: maxDataLen }, (_, i) => `Item ${i + 1}`)
    }
  }

  // Remove scales for pie/doughnut/radar/polarArea
  if (['pie', 'doughnut', 'radar', 'polarArea'].includes(config.type) && config.options?.scales) {
    delete config.options.scales
  }

  if (!config.options || typeof config.options !== 'object') {
    config.options = {}
  }
  if (!config.options.plugins || typeof config.options.plugins !== 'object') {
    config.options.plugins = {}
  }
  config.options.plugins.title = {
    ...(config.options.plugins.title || {}),
    display: false,
    text: ''
  }

  return { valid: true, config }
}

/**
 * Validate Mermaid code for common LLM errors
 */
function validateMermaidCode(code: string): { valid: boolean; code: string; error?: string } {
  let cleaned = code.trim()

  // Remove markdown fences
  const mermaidBlockMatch = cleaned.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/)
  if (mermaidBlockMatch) {
    cleaned = mermaidBlockMatch[1].trim()
  }

  // Remove Mermaid init/theme directives for deterministic external styling.
  cleaned = cleaned.replace(/^%%\{.*?\}%%\s*$/gm, '').trim()

  // Remove "graph" and replace with "flowchart" (graph is deprecated)
  cleaned = cleaned.replace(/^graph\s+(TD|TB|BT|RL|LR)/m, 'flowchart $1')

  // Check it starts with a valid Mermaid declaration
  const validStarts = [
    'flowchart', 'sequenceDiagram', 'stateDiagram-v2', 'stateDiagram',
    'erDiagram', 'gantt'
  ]

  const hasValidStart = validStarts.some(start => cleaned.startsWith(start) || cleaned.includes('\n' + start))
  if (!hasValidStart) {
    // Try to find a valid start within the text
    for (const start of validStarts) {
      const idx = cleaned.indexOf(start)
      if (idx >= 0) {
        cleaned = cleaned.slice(idx)
        break
      }
    }
  }

  // Remove any trailing explanatory text after the diagram
  const lines = cleaned.split('\n')
  const filteredLines: string[] = []
  let foundDiagramStart = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!foundDiagramStart) {
      if (validStarts.some(s => trimmed.startsWith(s))) {
        foundDiagramStart = true
      }
    }

    if (foundDiagramStart) {
      // Stop at lines that look like explanatory text (long sentences with periods)
      if (trimmed.length > 80 && trimmed.includes('. ') && !trimmed.includes('-->') && !trimmed.includes('---')) {
        break
      }
      filteredLines.push(line)
    }
  }

  cleaned = filteredLines.join('\n').trim()

  if (!cleaned || cleaned.length < 10) {
    return { valid: false, code: cleaned, error: 'Mermaid code is too short or empty' }
  }

  return { valid: true, code: cleaned }
}

// =============================================================================
// MAIN SERVICE FUNCTIONS
// =============================================================================

/**
 * Generate Chart.js configuration from natural language description.
 * Includes automatic retry (up to MAX_RETRIES) when the LLM returns
 * invalid JSON or a structurally invalid Chart.js config.
 */
const MAX_CHART_RETRIES = 1

export async function generateChartConfig(
  request: ChartGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<ChartGenerationResult> {
  let lastError: string | null = null
  let totalTokensUsed = 0

  for (let attempt = 0; attempt <= MAX_CHART_RETRIES; attempt++) {
    try {
      // Build the prompt with all context
      let userRequest = request.description

      if (request.chartType) {
        userRequest += `\n\nPreferred chart type: ${request.chartType}`
      }

      if (request.title) {
        userRequest += `\n\nChart title: "${request.title}"`
      }

      const sectionType = normalizeSectionType(request.sectionType)
      userRequest += `\n\nSection type: ${sectionType}`

      if (request.figureRole) {
        userRequest += `\nFigure role: ${request.figureRole}`
      }
      if (request.paperGenre) {
        userRequest += `\nPaper genre: ${sanitizeAscii(request.paperGenre).slice(0, 80)}`
      }
      if (request.studyType) {
        userRequest += `\nStudy type: ${request.studyType}`
      }
      if (request.chartSpec) {
        userRequest += `\n\nchartSpec (deterministic mapping - follow exactly):\n${JSON.stringify(request.chartSpec, null, 2)}`
      }

      if (request.data?.pointDatasets?.length) {
        userRequest += `\n\nACTUAL POINT DATA PROVIDED (use these exact x/y values):`
        userRequest += `\n${JSON.stringify({
          datasets: request.data.pointDatasets
        }, null, 2)}`
      } else if (request.data?.datasets?.length) {
        userRequest += `\n\nACTUAL STRUCTURED DATA PROVIDED (use these exact values and preserve series grouping):`
        userRequest += `\n${JSON.stringify({
          labels: request.data.labels || [],
          datasets: request.data.datasets
        }, null, 2)}`
      } else if (request.data?.labels && request.data?.values) {
        userRequest += `\n\nACTUAL DATA PROVIDED (use these exact values):`
        userRequest += `\nLabels: ${JSON.stringify(request.data.labels)}`
        userRequest += `\nValues: ${JSON.stringify(request.data.values)}`
        if (request.data.datasetLabel) {
          userRequest += `\nDataset label: "${request.data.datasetLabel}"`
        }
      } else if (request.rawDataText?.trim()) {
        userRequest += `\n\nRAW USER DATA / REQUEST TEXT (extract exact values from this; do not invent missing rows):`
        userRequest += `\n${sanitizeAscii(request.rawDataText, true).slice(0, 4000)}`
      } else {
        throw new Error('Publication-quality chart generation requires structured numeric data.')
      }

      const complexityNotes = summarizeChartPromptComplexity(request)
      if (complexityNotes.length > 0) {
        userRequest += `\n\nDATA COMPLEXITY / PRESERVATION SIGNALS:\n${complexityNotes.join('\n')}`
      }

      if (request.style) {
        userRequest += `\n\nStyle preference: ${request.style}`
      }

      // On retry, append the previous error so the LLM can self-correct
      if (attempt > 0 && lastError) {
        userRequest += `\n\nIMPORTANT - YOUR PREVIOUS RESPONSE WAS INVALID.\nError: ${lastError}\nPlease return ONLY valid JSON with no markdown fences, no comments, no trailing commas.`
      }

      const fullPrompt = CHART_GENERATION_PROMPT + userRequest

      const { response, tokensUsed, model } = await callLLM(
        fullPrompt,
        'PAPER_CHART_GENERATOR',
        requestHeaders,
        {
          chartType: request.chartType,
          sectionType,
          figureRole: request.figureRole || null,
          hasData: !!request.data,
          hasRawDataText: !!request.rawDataText,
          hasChartSpec: !!request.chartSpec,
          attempt
        }
      )
      totalTokensUsed += tokensUsed

      // Parse and validate the JSON response
      const cleanedResponse = extractJSON(response)
      let config: any
      let inferredMeta: PaperFigureInferenceMeta | null = null

      try {
        const parsedResponse = JSON.parse(cleanedResponse)
        inferredMeta = coercePaperFigureInferenceMeta(
          parsedResponse?.metadata,
          new Date().toISOString(),
          model
        )
        config = parsedResponse?.config && typeof parsedResponse.config === 'object' && !Array.isArray(parsedResponse.config)
          ? parsedResponse.config
          : parsedResponse
        if (config && typeof config === 'object' && !Array.isArray(config)) {
          delete config.metadata
        }
      } catch (parseError) {
        lastError = 'Invalid JSON syntax - could not parse the response'
        console.warn(`[LLMFigureService] Chart JSON parse failed (attempt ${attempt + 1}/${MAX_CHART_RETRIES + 1}):`, cleanedResponse.slice(0, 300))
        if (attempt < MAX_CHART_RETRIES) continue // retry
        return {
          success: false,
          error: 'LLM returned invalid JSON for chart configuration after retries'
        }
      }

      // Validate the config
      const validation = validateChartConfig(config)
      if (!validation.valid) {
        lastError = validation.error || 'Invalid chart structure'
        console.warn(`[LLMFigureService] Chart validation failed (attempt ${attempt + 1}/${MAX_CHART_RETRIES + 1}): ${validation.error}`)
        if (attempt < MAX_CHART_RETRIES) continue // retry
        return {
          success: false,
          error: `Invalid chart configuration: ${validation.error}`
        }
      }

      return {
        success: true,
        config: validation.config,
        inferredMeta,
        tokensUsed: totalTokensUsed,
        model
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`[LLMFigureService] Chart generation error (attempt ${attempt + 1}/${MAX_CHART_RETRIES + 1}):`, lastError)
      if (attempt < MAX_CHART_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000)) // brief delay before retry
        continue
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Chart generation failed'
      }
    }
  }

  return { success: false, error: lastError || 'Chart generation failed after retries' }
}

/**
 * Generate Mermaid diagram code from natural language description.
 * Includes automatic retry (up to MAX_RETRIES) when the LLM returns
 * syntactically invalid Mermaid code.
 */
const MAX_DIAGRAM_RETRIES = 1

export async function generateMermaidCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  let lastError: string | null = null
  let totalTokensUsed = 0
  const sanitizedSpec = sanitizeDiagramSpec(request.diagramSpec)
  const sanitizedDescription = sanitizeAscii(request.description, true).trim()
  const templateSelection = normalizeMermaidTemplateType(request.diagramType as string | undefined, sanitizedDescription)

  for (let attempt = 0; attempt <= MAX_DIAGRAM_RETRIES; attempt++) {
    try {
      let userRequest = sanitizedDescription
      const sectionType = normalizeSectionType(request.sectionType)

      if (request.diagramType || templateSelection.inputType) {
        userRequest += `\n\nDiagram type (input): ${request.diagramType || templateSelection.inputType}`
      }

      userRequest += `\n\nDiagram type (template): ${templateSelection.templateType}`
      userRequest += `\nSection type: ${sectionType}`
      if (request.figureRole) {
        userRequest += `\nFigure role: ${request.figureRole}`
      }
      if (request.paperGenre) {
        userRequest += `\nPaper genre: ${sanitizeAscii(request.paperGenre).slice(0, 80)}`
      }

      if (templateSelection.templateType === 'flowchart') {
        userRequest += `\n\nFlowchart variant: ${templateSelection.flowchartVariant || 'pipeline'}`
      }

      if (templateSelection.compatibilityNote) {
        userRequest += `\n\nCompatibility mapping: ${templateSelection.compatibilityNote}`
      }

      if (request.title) {
        userRequest += `\n\nDiagram title/topic: "${sanitizeDiagramLabel(request.title)}"`
      }

      if (request.elements && request.elements.length > 0) {
        userRequest += `\n\nKey elements that MUST appear as nodes: ${request.elements.map(sanitizeDiagramLabel).join(', ')}`
      }

      if (sanitizedSpec) {
        userRequest += `\n\n${buildSpecPromptBlock(sanitizedSpec)}`
      }

      if (attempt > 0 && lastError) {
        userRequest += `\n\nIMPORTANT - YOUR PREVIOUS RESPONSE WAS INVALID MERMAID SYNTAX.\nError: ${lastError}\nUse exactly one canonical template and return ONLY Mermaid code with no markdown fences and no extra text.`
      }

      const fullPrompt = DIAGRAM_GENERATION_PROMPT + userRequest

      const { response, tokensUsed, model } = await callLLM(
        fullPrompt,
        'PAPER_DIAGRAM_GENERATOR',
        requestHeaders,
        {
          diagramType: request.diagramType,
          sectionType,
          figureRole: request.figureRole || null,
          paperGenre: request.paperGenre || null,
          mermaidTemplateType: templateSelection.templateType,
          mermaidFlowchartVariant: templateSelection.flowchartVariant || null,
          attempt
        }
      )
      totalTokensUsed += tokensUsed

      const validation = validateMermaidCode(response)
      if (!validation.valid) {
        lastError = validation.error || 'Generated Mermaid code was invalid'
        console.warn(`[LLMFigureService] Mermaid validation failed (attempt ${attempt + 1}/${MAX_DIAGRAM_RETRIES + 1}): ${lastError}`)
        if (attempt < MAX_DIAGRAM_RETRIES) continue
        return {
          success: false,
          error: lastError
        }
      }

      if (!mermaidMatchesTemplateType(validation.code, templateSelection.templateType)) {
        lastError = `Generated Mermaid code did not match required template type "${templateSelection.templateType}".`
        console.warn(`[LLMFigureService] Mermaid template mismatch (attempt ${attempt + 1}/${MAX_DIAGRAM_RETRIES + 1}): ${lastError}`)
        if (attempt < MAX_DIAGRAM_RETRIES) continue
        return {
          success: false,
          error: lastError
        }
      }

      return {
        success: true,
        code: validation.code,
        diagramType: 'mermaid',
        tokensUsed: totalTokensUsed,
        model,
        diagramSpec: sanitizedSpec
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`[LLMFigureService] Mermaid generation error (attempt ${attempt + 1}/${MAX_DIAGRAM_RETRIES + 1}):`, lastError)
      if (attempt < MAX_DIAGRAM_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Diagram generation failed'
      }
    }
  }

  return { success: false, error: lastError || 'Diagram generation failed after retries' }
}
const MAX_PLANTUML_RETRIES = 1

export async function generatePlantUMLCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  let lastError: string | null = null
  let totalTokensUsed = 0

  const sanitizedSpec = sanitizeDiagramSpec(request.diagramSpec)
  const fallbackSpec = sanitizedSpec || buildFallbackSpecFromDescription(request.description, request.title)
  const sanitizedDescription = sanitizeAscii(request.description, true).trim()
  const templateSelection = normalizePlantUMLTemplateType(request.diagramType as string | undefined)

  for (let attempt = 0; attempt <= MAX_PLANTUML_RETRIES; attempt++) {
    try {
      let userRequest = sanitizedDescription
      const sectionType = normalizeSectionType(request.sectionType)

      if (request.diagramType || templateSelection.inputType) {
        userRequest += `\n\nDiagram type (input): ${request.diagramType || templateSelection.inputType}`
      }

      userRequest += `\n\nDiagram type (template): ${templateSelection.templateType}`
      userRequest += `\nSection type: ${sectionType}`
      if (request.figureRole) {
        userRequest += `\nFigure role: ${request.figureRole}`
      }
      if (request.paperGenre) {
        userRequest += `\nPaper genre: ${sanitizeAscii(request.paperGenre).slice(0, 80)}`
      }

      if (templateSelection.compatibilityNote) {
        userRequest += `\n\nCompatibility mapping: ${templateSelection.compatibilityNote}`
      }

      if (request.title) {
        userRequest += `\n\nDiagram title/topic: "${sanitizeDiagramLabel(request.title)}"`
      }

      if (request.elements && request.elements.length > 0) {
        userRequest += `\n\nKey elements that MUST appear: ${request.elements.map(sanitizeDiagramLabel).join(', ')}`
      }

      userRequest += `\n\n${buildSpecPromptBlock(fallbackSpec)}`

      if (attempt > 0 && lastError) {
        userRequest += `\n\nIMPORTANT - YOUR PREVIOUS RESPONSE WAS INVALID PLANTUML OR FAILED TO RENDER.\nError: ${lastError}\nReturn valid PlantUML only. Preserve structure, fix syntax.`
      }

      const fullPrompt = PLANTUML_GENERATION_PROMPT + userRequest

      const { response, tokensUsed, model } = await callLLM(
        fullPrompt,
        'PAPER_DIAGRAM_GENERATOR',
        requestHeaders,
        {
          diagramType: 'plantuml',
          inputDiagramType: request.diagramType || null,
          templateDiagramType: templateSelection.templateType,
          sectionType,
          figureRole: request.figureRole || null,
          paperGenre: request.paperGenre || null,
          attempt
        }
      )
      totalTokensUsed += tokensUsed

      const cleanedCode = cleanPlantUMLResponse(response)

      if (!cleanedCode.includes('@startuml') || !cleanedCode.includes('@enduml')) {
        lastError = 'PlantUML wrapper missing after cleanup'
        if (attempt < MAX_PLANTUML_RETRIES) continue
        return { success: false, error: lastError }
      }

      return {
        success: true,
        code: cleanedCode,
        diagramType: 'plantuml',
        tokensUsed: totalTokensUsed,
        model,
        diagramSpec: fallbackSpec
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'PlantUML generation failed'
      console.warn(`[LLMFigureService] PlantUML generation error (attempt ${attempt + 1}/${MAX_PLANTUML_RETRIES + 1}):`, lastError)
      if (attempt < MAX_PLANTUML_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }
      return {
        success: false,
        error: lastError
      }
    }
  }

  return { success: false, error: lastError || 'PlantUML generation failed after retries' }
}

export async function repairDiagramCode(
  input: {
    brokenCode: string
    errorMessage: string
    diagramType?: DiagramType
    title?: string
    description?: string
    diagramSpec?: DiagramStructuredSpec
  },
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  try {
    const spec = sanitizeDiagramSpec(input.diagramSpec) || buildFallbackSpecFromDescription(input.description || '', input.title)
    const templateSelection = normalizePlantUMLTemplateType(input.diagramType as string | undefined)
    const payload = [
      `DiagramTypeInput: ${input.diagramType || 'unspecified'}`,
      `DiagramTypeTemplate: ${templateSelection.templateType}`,
      templateSelection.compatibilityNote ? `CompatibilityMapping: ${templateSelection.compatibilityNote}` : '',
      input.title ? `Title: ${sanitizeDiagramLabel(input.title)}` : '',
      input.description ? `Description: ${sanitizeAscii(input.description, true).slice(0, 800)}` : '',
      `KrokiError: ${sanitizeAscii(input.errorMessage || '').slice(0, 600)}`,
      `BrokenCode:\n${sanitizeAscii(input.brokenCode || '', true).slice(0, 3000)}`,
      buildSpecPromptBlock(spec)
    ].filter(Boolean).join('\n\n')

    const fullPrompt = DIAGRAM_REPAIR_PROMPT + payload
    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_DIAGRAM_REPAIR',
      requestHeaders,
      {
        diagramType: input.diagramType || 'plantuml',
        templateDiagramType: templateSelection.templateType,
        mode: 'repair'
      }
    )

    return {
      success: true,
      code: cleanPlantUMLResponse(response),
      diagramType: 'plantuml',
      tokensUsed,
      model,
      diagramSpec: spec
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Diagram repair failed'
    }
  }
}
export async function generateFigureSuggestions(
  request: FigureSuggestionRequest,
  requestHeaders: Record<string, string>
): Promise<FigureSuggestionResult> {
  try {
    const preferences = normalizeFigurePreferences(request.preferences)
    const paperProfile = inferPaperProfile(request)
    const quantitativeDataAvailable = paperProfile.dataAvailability === 'provided' || hasQuantitativeEvidence(request)

    // Build paper context
    let paperContext = ''

    if (request.paperTitle) {
      paperContext += `Title: ${request.paperTitle}\n\n`
    }

    if (request.paperAbstract) {
      paperContext += `Abstract: ${request.paperAbstract}\n\n`
    }

    if (request.researchType) {
      paperContext += `Research Type: ${request.researchType}\n\n`
    }

    if (request.datasetDescription) {
      paperContext += `Dataset / Data Availability: ${request.datasetDescription}\n\n`
    }

    paperContext += `Paper Profile:\n`
    paperContext += `- paperGenre: ${paperProfile.paperGenre}\n`
    paperContext += `- studyType: ${paperProfile.studyType}\n`
    paperContext += `- dataAvailability: ${paperProfile.dataAvailability}\n\n`
    paperContext += `- quantitativeEvidenceDetected: ${quantitativeDataAvailable ? 'yes' : 'no'}\n\n`

    if (request.sections) {
      paperContext += 'Sections:\n'
      for (const [section, content] of Object.entries(request.sections)) {
        if (content && content.trim()) {
          // Truncate long sections to avoid token limits
          const truncated = content.length > 2000 
            ? content.slice(0, 2000) + '...' 
            : content
          paperContext += `\n--- ${section} ---\n${truncated}\n`
        }
      }
    }

    if (request.paperBlueprint) {
      const keyContributions = request.paperBlueprint.keyContributions?.slice(0, 5) || []
      const sectionPlan = request.paperBlueprint.sectionPlan?.slice(0, 8) || []

      paperContext += '\n\nBlueprint Context:\n'
      if (request.paperBlueprint.thesisStatement) {
        paperContext += `Thesis: ${request.paperBlueprint.thesisStatement}\n`
      }
      if (request.paperBlueprint.centralObjective) {
        paperContext += `Central Objective: ${request.paperBlueprint.centralObjective}\n`
      }
      if (keyContributions.length > 0) {
        paperContext += `Key Contributions:\n${keyContributions.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n`
      }
      if (sectionPlan.length > 0) {
        paperContext += 'Section Constraints:\n'
        sectionPlan.forEach((section) => {
          const mustCover = section.mustCover?.slice(0, 4).join('; ') || 'none'
          const mustAvoid = section.mustAvoid?.slice(0, 3).join('; ') || 'none'
          paperContext += `- ${section.sectionKey}: mustCover=${mustCover}; mustAvoid=${mustAvoid}\n`
        })
      }
    }

    paperContext += `\n\nVisualization Preferences:
- stylePreset: ${preferences.stylePreset}
- outputMix: ${preferences.outputMix}
- chartPreference: ${preferences.chartPreference}
- diagramPreference: ${preferences.diagramPreference}
- visualTone: ${preferences.visualTone}
- colorMode: ${preferences.colorMode}
- detailLevel: ${preferences.detailLevel}
- annotationDensity: ${preferences.annotationDensity}
- targetAudience: ${preferences.targetAudience}
- exportFormat: ${preferences.exportFormat}
- strictness: ${preferences.strictness}\n`

    if (request.existingFigures && request.existingFigures.length > 0) {
      paperContext += '\n\nExisting Figures (avoid duplicating these):\n'
      request.existingFigures.forEach((fig, i) => {
        paperContext += `${i + 1}. ${fig.title} (${fig.type})\n`
      })
    }

    // When focusText is provided, cap suggestions to 2-4 and inject the focus constraint
    const isFocused = !!request.focusText?.trim()
    const maxSuggestions = isFocused
      ? Math.min(request.maxSuggestions || 4, 4)
      : (request.maxSuggestions || 8)
    paperContext += `\n\nProvide up to ${maxSuggestions} figure suggestions.`

    // Inject the focus constraint block between the system prompt and paper context
    // so the LLM sees: system rules → focus constraint → paper content
    let fullPrompt: string
    if (isFocused) {
      const focusBlock = buildFocusTextBlock(
        request.focusText!,
        request.focusSection,
        request.focusMode,
        request.focusHints
      )
      fullPrompt = FIGURE_SUGGESTION_PROMPT + focusBlock + paperContext
    } else {
      fullPrompt = FIGURE_SUGGESTION_PROMPT + paperContext
    }

    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_FIGURE_SUGGESTION',
      requestHeaders,
      { 
        hasSections: !!request.sections,
        existingFigureCount: request.existingFigures?.length || 0,
        focusMode: request.focusMode || 'full_paper',
        paperGenre: paperProfile.paperGenre,
        studyType: paperProfile.studyType,
        dataAvailability: paperProfile.dataAvailability,
        quantitativeDataAvailable
      }
    )

    // Parse the JSON response with robust extraction
    const cleanedResponse = extractJSON(response)
    let suggestions: FigureSuggestion[]

    try {
      suggestions = JSON.parse(cleanedResponse) as FigureSuggestion[]
    } catch (parseError) {
      console.error('[LLMFigureService] Failed to parse suggestion JSON:', cleanedResponse.slice(0, 300))
      return {
        success: false,
        error: 'LLM returned invalid JSON for figure suggestions'
      }
    }

    if (!Array.isArray(suggestions)) {
      return {
        success: false,
        error: 'LLM returned non-array response for suggestions'
      }
    }

    const groundingLexicon = buildGroundingLexicon(request)
    const focusedSection = request.focusSection ? normalizeSectionType(request.focusSection) : undefined
    const isValidImportance = (value?: string): value is 'required' | 'recommended' | 'optional' => (
      value === 'required' || value === 'recommended' || value === 'optional'
    )
    const validSuggestions = suggestions
      .filter(s => s.title && s.description && s.category)
      .map((s, index) => {
        const category = coerceFigureCategory(s.category as unknown as string)
        const section = isFocused
          ? (focusedSection || 'selected_content')
          : normalizeSectionType(s.relevantSection)
        const importance = isValidImportance(s.importance) ? s.importance : (section === 'methodology' || section === 'results' ? 'required' : 'recommended')
        const sanitizedTitle = sanitizeAscii(s.title).slice(0, 120).trim() || `Figure ${index + 1}`
        const sanitizedDescription = sanitizeAscii(s.description, true).slice(0, 1200).trim() || 'Diagram based on paper content'
        const suggestedType = sanitizeAscii((s.suggestedType || '').trim().toLowerCase()).slice(0, 40) || undefined
        const incomingRenderSpec = (s as any).renderSpec && typeof (s as any).renderSpec === 'object'
          ? (s as any).renderSpec
          : undefined
        const normalized: FigureSuggestion = {
          ...s,
          title: sanitizedTitle,
          description: sanitizedDescription,
          category,
          suggestedType,
          relevantSection: section,
          figureRole: normalizeFigureRole((s as any).figureRole, section),
          sectionFitJustification: (s as any).sectionFitJustification
            ? sanitizeAscii((s as any).sectionFitJustification, true).slice(0, 220)
            : `Selected to satisfy ${section} section rhetorical expectations.`,
          expectedByReviewers: typeof (s as any).expectedByReviewers === 'boolean'
            ? (s as any).expectedByReviewers
            : (importance === 'required' || section === 'results' || section === 'methodology'),
          importance,
          rendererPreference: s.rendererPreference === 'mermaid' || s.rendererPreference === 'plantuml'
            ? s.rendererPreference
            : undefined,
          dataNeeded: s.dataNeeded
            ? sanitizeAscii(s.dataNeeded, true).slice(0, 500)
            : 'Specify exact variables/columns required to render this figure.',
          whyThisFigure: s.whyThisFigure
            ? sanitizeAscii(s.whyThisFigure, true).slice(0, 220)
            : `This figure improves reader understanding of the ${section} claims.`,
          paperProfile,
          renderSpec: undefined
        }

        if (category === 'DIAGRAM') {
          const rendererDecision = chooseDiagramRenderer({
            diagramType: normalized.suggestedType,
            title: sanitizedTitle,
            description: sanitizedDescription,
            rendererPreference: normalized.rendererPreference
          })
          normalized.rendererPreference = rendererDecision.renderer
          normalized.suggestedType = normalized.suggestedType || 'flowchart'
          normalized.diagramSpec = sanitizeDiagramSpec((s as any).diagramSpec || incomingRenderSpec?.diagramSpec) || buildFallbackSpecFromDescription(sanitizedDescription, sanitizedTitle)
          normalized.diagramSpec = {
            ...normalized.diagramSpec,
            constraints: {
              nodesMax: 12,
              edgesMax: 18,
              nodeLabelMaxWords: 3,
              noDuplicateNodeLabels: true
            }
          }
        }

        if (category === 'DATA_CHART' || category === 'STATISTICAL_PLOT') {
          normalized.suggestedType = normalized.suggestedType || 'bar'
          normalized.chartSpec = sanitizeChartSpec((s as any).chartSpec || incomingRenderSpec?.chartSpec, normalized.suggestedType) || buildFallbackChartSpec(section, normalized.suggestedType)
          if (!quantitativeDataAvailable && normalized.chartSpec) {
            normalized.chartSpec.placeholderPolicy = {
              allowed: false,
              label: 'Sample Data (replace with actual values)',
              shape: 'modest_gain',
              rangeHint: 'Provide observed values from results tables.'
            }
          }
        }

        if (category === 'ILLUSTRATED_FIGURE') {
          normalized.suggestedType = normalized.suggestedType?.startsWith('sketch-')
            ? normalized.suggestedType
            : 'sketch-auto'
          normalized.illustrationSpec = sanitizeIllustrationSpec((s as any).illustrationSpec || incomingRenderSpec?.illustrationSpecV2) || buildFallbackIllustrationSpec(section)
          normalized.illustrationSpecV2 = sanitizeIllustrationSpecV2(
            (s as any).illustrationSpecV2 || incomingRenderSpec?.illustrationSpecV2 || {
              ...(s as any).illustrationSpec,
              figureGenre: (s as any).figureGenre,
              renderDirectives: (s as any).renderDirectives
            },
            section
          ) || buildFallbackIllustrationSpecV2(section)
          normalized.figureGenre = normalized.illustrationSpecV2.figureGenre
          normalized.renderDirectives = normalized.illustrationSpecV2.renderDirectives
          const validStyles = ['academic', 'scientific', 'conceptual', 'technical'] as const
          normalized.sketchStyle = validStyles.includes(s.sketchStyle as any) ? s.sketchStyle : 'academic'
          normalized.sketchMode = s.sketchMode === 'GUIDED' ? 'GUIDED' : 'SUGGEST'
          normalized.sketchPrompt = s.sketchPrompt
            ? sanitizeAscii(s.sketchPrompt, true).slice(0, 800)
            : buildSketchPromptFromIllustrationSpecV2(
                sanitizedTitle,
                normalized.illustrationSpecV2,
                normalized.sketchStyle
              )
        }

        normalized.renderSpec = buildRenderSpecForSuggestion(normalized)

        return normalized
      })

    // Validate each item and regenerate/rewrite only invalid ones.
    const postValidated: FigureSuggestion[] = []
    for (let i = 0; i < validSuggestions.length; i++) {
      let candidate = validSuggestions[i]
      const section = normalizeSectionType(candidate.relevantSection)
      let issues = validateSuggestion(candidate, { section, groundingLexicon, quantitativeDataAvailable })

      if (issues.length > 0) {
        candidate = buildSectionAwareFallbackSuggestion(candidate, section, i, { quantitativeDataAvailable })
        candidate.paperProfile = paperProfile
        if (candidate.category === 'DIAGRAM') {
          candidate.diagramSpec = sanitizeDiagramSpec(candidate.diagramSpec) || buildFallbackSpecFromDescription(candidate.description, candidate.title)
          const rendererDecision = chooseDiagramRenderer({
            diagramType: candidate.suggestedType,
            title: candidate.title,
            description: candidate.description,
            rendererPreference: candidate.rendererPreference
          })
          candidate.rendererPreference = rendererDecision.renderer
        }
        if (candidate.category === 'DATA_CHART' || candidate.category === 'STATISTICAL_PLOT') {
          candidate.chartSpec = sanitizeChartSpec(candidate.chartSpec, candidate.suggestedType) || buildFallbackChartSpec(section, candidate.suggestedType)
        }
        if (candidate.category === 'ILLUSTRATED_FIGURE') {
          candidate.illustrationSpec = sanitizeIllustrationSpec(candidate.illustrationSpec) || buildFallbackIllustrationSpec(section)
          candidate.illustrationSpecV2 = sanitizeIllustrationSpecV2(candidate.illustrationSpecV2, section) || buildFallbackIllustrationSpecV2(section)
          candidate.figureGenre = candidate.figureGenre || candidate.illustrationSpecV2.figureGenre
          candidate.renderDirectives = candidate.renderDirectives || candidate.illustrationSpecV2.renderDirectives
          candidate.sketchMode = candidate.sketchMode || 'GUIDED'
          candidate.sketchStyle = candidate.sketchStyle || 'academic'
          candidate.sketchPrompt = candidate.sketchPrompt || buildSketchPromptFromIllustrationSpecV2(candidate.title, candidate.illustrationSpecV2, candidate.sketchStyle)
        }
        candidate.renderSpec = buildRenderSpecForSuggestion(candidate)
        issues = validateSuggestion(candidate, { section, groundingLexicon, quantitativeDataAvailable })
      }

      if (issues.length > 0) {
        console.warn(`[LLMFigureService] Dropping invalid suggestion "${candidate.title}" due to validation issues: ${issues.map(issue => issue.reason).join(' | ')}`)
        continue
      }
      postValidated.push(candidate)
    }

    // Enforce max one ILLUSTRATED_FIGURE in intro/lit-review/discussion/conclusion.
    const illustratedLimited: FigureSuggestion[] = []
    const illustratedSeenBySection = new Set<string>()
    for (const item of postValidated) {
      const section = normalizeSectionType(item.relevantSection)
      const cappedSection = section === 'introduction' || section === 'literature_review' || section === 'discussion' || section === 'conclusion'
      if (item.category === 'ILLUSTRATED_FIGURE' && cappedSection) {
        const key = section
        if (illustratedSeenBySection.has(key)) continue
        illustratedSeenBySection.add(key)
      }
      illustratedLimited.push(item)
    }
    postValidated.length = 0
    postValidated.push(...illustratedLimited)

    // Enforce methodology pipeline requirement when methodology content exists.
    const hasMethodologyContent = Object.keys(request.sections || {}).some(key => normalizeSectionType(key) === 'methodology')
    const hasMethodPipeline = postValidated.some(item => (
      normalizeSectionType(item.relevantSection) === 'methodology' &&
      item.category === 'DIAGRAM' &&
      /\b(flowchart|activity|architecture|pipeline)\b/.test((item.suggestedType || '').toLowerCase())
    ))
    if (!isFocused && hasMethodologyContent && !hasMethodPipeline) {
      const fallbackMethod = buildSectionAwareFallbackSuggestion({
        title: 'Methodology Pipeline',
        description: 'End-to-end method flow with deterministic stages and transitions.',
        category: 'DIAGRAM',
        suggestedType: 'flowchart',
        relevantSection: 'methodology',
        importance: 'required'
      } as FigureSuggestion, 'methodology', postValidated.length, { quantitativeDataAvailable })
      fallbackMethod.paperProfile = paperProfile
      postValidated.push(fallbackMethod)
    }

    // Enforce results mix: >=70% charts/statistical plots within results suggestions.
    const resultsIndexes = postValidated
      .map((item, idx) => ({ item, idx }))
      .filter(entry => normalizeSectionType(entry.item.relevantSection) === 'results')
      .map(entry => entry.idx)
    if (resultsIndexes.length > 0 && quantitativeDataAvailable) {
      const isResultsChart = (item: FigureSuggestion) => item.category === 'DATA_CHART' || item.category === 'STATISTICAL_PLOT'
      let chartCount = resultsIndexes.filter(idx => isResultsChart(postValidated[idx])).length
      const requiredCharts = Math.ceil(resultsIndexes.length * 0.7)

      for (const idx of resultsIndexes) {
        if (chartCount >= requiredCharts) break
        if (isResultsChart(postValidated[idx])) continue
        postValidated[idx] = buildSectionAwareFallbackSuggestion(postValidated[idx], 'results', idx, { quantitativeDataAvailable })
        postValidated[idx].paperProfile = paperProfile
        chartCount += 1
      }
    } else if (resultsIndexes.length > 0 && !quantitativeDataAvailable) {
      for (const idx of resultsIndexes) {
        const item = postValidated[idx]
        if (item.category === 'DATA_CHART' || item.category === 'STATISTICAL_PLOT') {
          postValidated[idx] = buildSectionAwareFallbackSuggestion(item, 'results', idx, { quantitativeDataAvailable })
          postValidated[idx].paperProfile = paperProfile
        }
      }
    }

    const finalSuggestions = postValidated.slice(0, maxSuggestions)
    if (isFocused && finalSuggestions.length < 2) {
      while (finalSuggestions.length < Math.min(2, maxSuggestions)) {
        const section = focusedSection || 'selected_content'
        const fallback = buildSectionAwareFallbackSuggestion({
          title: `Focused Figure ${finalSuggestions.length + 1}`,
          description: 'Focused fallback suggestion generated for selected excerpt.',
          category: 'DIAGRAM',
          suggestedType: 'flowchart',
          relevantSection: section,
          importance: 'recommended'
        } as FigureSuggestion, section, finalSuggestions.length, { quantitativeDataAvailable })
        fallback.paperProfile = paperProfile
        finalSuggestions.push(fallback)
      }
    }
    if (!isFocused && finalSuggestions.length < 5) {
      const fallbackSections: SectionType[] = ['introduction', 'methodology', 'results', 'results', 'discussion']
      for (let i = finalSuggestions.length; i < Math.min(5, maxSuggestions); i++) {
        const section = fallbackSections[i] || 'methodology'
        const fallback = buildSectionAwareFallbackSuggestion({
          title: `Fallback Figure ${i + 1}`,
          description: `Fallback suggestion for ${section}.`,
          category: section === 'results' ? 'DATA_CHART' : 'DIAGRAM',
          suggestedType: section === 'results' ? 'bar' : 'flowchart',
          relevantSection: section,
          importance: section === 'results' || section === 'methodology' ? 'required' : 'recommended'
        } as FigureSuggestion, section, i, { quantitativeDataAvailable })
        fallback.paperProfile = paperProfile
        finalSuggestions.push(fallback)
      }
    }
    if (finalSuggestions.length === 0) {
      const emergency = buildSectionAwareFallbackSuggestion({
        title: 'Methodology Pipeline',
        description: 'Fallback reproducibility pipeline generated due validation failures.',
        category: 'DIAGRAM',
        suggestedType: 'flowchart',
        relevantSection: 'methodology',
        importance: 'required'
      } as FigureSuggestion, 'methodology', 0, { quantitativeDataAvailable })
      emergency.paperProfile = paperProfile
      finalSuggestions.push(emergency)
    }

    // Final normalization pass: enforce no-data chart gate and ensure renderSpec payloads.
    for (let i = 0; i < finalSuggestions.length; i++) {
      const suggestion = finalSuggestions[i]
      const section = normalizeSectionType(suggestion.relevantSection)
      if (!quantitativeDataAvailable && (suggestion.category === 'DATA_CHART' || suggestion.category === 'STATISTICAL_PLOT')) {
        finalSuggestions[i] = buildSectionAwareFallbackSuggestion(suggestion, section, i, { quantitativeDataAvailable })
        finalSuggestions[i].paperProfile = paperProfile
      } else {
        if (suggestion.category === 'ILLUSTRATED_FIGURE') {
          suggestion.illustrationSpec = sanitizeIllustrationSpec(suggestion.illustrationSpec) || buildFallbackIllustrationSpec(section)
          suggestion.illustrationSpecV2 = sanitizeIllustrationSpecV2(suggestion.illustrationSpecV2, section) || buildFallbackIllustrationSpecV2(section)
          suggestion.figureGenre = suggestion.figureGenre || suggestion.illustrationSpecV2.figureGenre
          suggestion.renderDirectives = suggestion.renderDirectives || suggestion.illustrationSpecV2.renderDirectives
        }
        suggestion.renderSpec = buildRenderSpecForSuggestion(suggestion)
      }
    }

    return {
      success: true,
      suggestions: finalSuggestions,
      tokensUsed,
      model
    }
  } catch (error) {
    console.error('[LLMFigureService] Figure suggestion failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Figure suggestion failed'
    }
  }
}

/**
 * High-level function to generate diagram code (auto-detects Mermaid vs PlantUML)
 */
export async function generateDiagramCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>,
  preferPlantUML: boolean = true,
  resolvedRenderer?: 'plantuml' | 'mermaid'
): Promise<DiagramGenerationResult> {
  const description = sanitizeAscii(request.description, true).toLowerCase()
  const spec = sanitizeDiagramSpec(request.diagramSpec) || buildFallbackSpecFromDescription(request.description, request.title)
  const normalizedRequest: DiagramGenerationRequest = {
    ...request,
    description: sanitizeAscii(request.description, true).slice(0, 2500),
    diagramSpec: spec
  }
  const rendererDecision = resolvedRenderer
    ? {
        renderer: resolvedRenderer,
        reason: 'Renderer resolved by caller.',
        plantUMLRequired: resolvedRenderer === 'plantuml'
      }
    : chooseDiagramRenderer({
        diagramType: normalizedRequest.diagramType as string | undefined,
        title: normalizedRequest.title,
        description,
        rendererPreference: normalizedRequest.rendererPreference,
        hasRecentMermaidFailure: normalizedRequest.hasRecentMermaidFailure,
        hasRecentPlantUMLFailure: normalizedRequest.hasRecentPlantUMLFailure,
        specLooksMermaidLike: normalizedRequest.specLooksMermaidLike
      })

  const allowMermaidByLegacyToggle =
    !resolvedRenderer &&
    !preferPlantUML &&
    /\bmermaid\b/.test(description) &&
    !rendererDecision.plantUMLRequired
  if (rendererDecision.renderer === 'mermaid' || allowMermaidByLegacyToggle) {
    return generateMermaidCode(normalizedRequest, requestHeaders)
  }

  return generatePlantUMLCode(normalizedRequest, requestHeaders)
}




