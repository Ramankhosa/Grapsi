/**
 * Grant Diagram Studio — spec contracts.
 *
 * The LLM produces one of these validated JSON specs from grant section
 * context; deterministic compilers render the spec. Users edit the spec
 * directly (no LLM round-trip needed for re-rendering).
 */

import { z } from 'zod'

// ============================================================================
// Gantt / workplan
// ============================================================================

export const ganttTaskSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  startMonth: z.number().int().min(1).max(120),
  endMonth: z.number().int().min(1).max(120),
  critical: z.boolean().optional(),
})

export const ganttGroupSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(90),
  tasks: z.array(ganttTaskSchema).min(1).max(12),
})

export const ganttMilestoneSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(90),
  month: z.number().int().min(1).max(120),
})

export const ganttSpecSchema = z.object({
  kind: z.literal('gantt'),
  title: z.string().min(1).max(160),
  totalMonths: z.number().int().min(1).max(120),
  groups: z.array(ganttGroupSchema).min(1).max(10),
  milestones: z.array(ganttMilestoneSchema).max(16).default([]),
})

export type GanttSpec = z.infer<typeof ganttSpecSchema>
export type GanttGroup = z.infer<typeof ganttGroupSchema>
export type GanttTask = z.infer<typeof ganttTaskSchema>
export type GanttMilestone = z.infer<typeof ganttMilestoneSchema>

// ============================================================================
// Flowchart (methodology / aims / process)
// ============================================================================

export const flowNodeSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,24}$/),
  label: z.string().min(1).max(90),
  role: z
    .enum(['start', 'input', 'process', 'decision', 'output', 'milestone', 'end'])
    .default('process'),
  group: z.string().max(60).optional(),
})

export const flowEdgeSchema = z.object({
  from: z.string().min(1).max(25),
  to: z.string().min(1).max(25),
  label: z.string().max(60).optional(),
  style: z.enum(['solid', 'dashed']).default('solid'),
})

export const flowSpecSchema = z.object({
  kind: z.literal('flowchart'),
  title: z.string().min(1).max(160),
  direction: z.enum(['TD', 'LR']).default('TD'),
  nodes: z.array(flowNodeSchema).min(2).max(16),
  edges: z.array(flowEdgeSchema).min(1).max(24),
})

export type FlowSpec = z.infer<typeof flowSpecSchema>
export type FlowNode = z.infer<typeof flowNodeSchema>
export type FlowEdge = z.infer<typeof flowEdgeSchema>

// ============================================================================
// Logic model (inputs → activities → outputs → outcomes → impact)
// ============================================================================

export const logicColumnKeySchema = z.enum([
  'inputs',
  'activities',
  'outputs',
  'outcomes',
  'impact',
])

export const logicColumnSchema = z.object({
  key: logicColumnKeySchema,
  label: z.string().min(1).max(50),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        text: z.string().min(1).max(140),
      })
    )
    .min(1)
    .max(7),
})

export const logicModelSpecSchema = z.object({
  kind: z.literal('logic_model'),
  title: z.string().min(1).max(160),
  columns: z.array(logicColumnSchema).min(3).max(5),
})

export type LogicModelSpec = z.infer<typeof logicModelSpecSchema>
export type LogicColumn = z.infer<typeof logicColumnSchema>

// ============================================================================
// Chart (budget breakdown, effort distribution, KPI targets)
// ============================================================================

export const chartSpecSchema = z.object({
  kind: z.literal('chart'),
  title: z.string().min(1).max(160),
  chartType: z.enum(['bar', 'stackedBar', 'horizontalBar', 'line', 'pie', 'doughnut']),
  labels: z.array(z.string().min(1).max(60)).min(1).max(24),
  datasets: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        data: z.array(z.number()).min(1).max(24),
      })
    )
    .min(1)
    .max(8),
  xLabel: z.string().max(60).optional(),
  yLabel: z.string().max(60).optional(),
  valuePrefix: z.string().max(8).optional(),
  valueSuffix: z.string().max(12).optional(),
})

export type ChartSpec = z.infer<typeof chartSpecSchema>

// ============================================================================
// Statistical plot (LLM-written matplotlib code via the python pipeline)
// ============================================================================

export const PYTHON_PLOT_TYPES = [
  'boxplot',
  'violin',
  'heatmap',
  'confusion_matrix',
  'roc_curve',
  'error_bar',
  'errorbar',
  'regression',
  'bland_altman',
  'forest_plot',
] as const

export const plotSpecSchema = z.object({
  kind: z.literal('plot'),
  title: z.string().min(1).max(160),
  plotType: z.enum(PYTHON_PLOT_TYPES),
  description: z.string().min(1).max(2400),
  dataText: z.string().max(6000).optional(),
  /** The executed PythonChartSpec (incl. LLM-written matplotlib code), kept for re-render. */
  pythonSpec: z.any().optional(),
})

export type PlotSpec = z.infer<typeof plotSpecSchema>

// ============================================================================
// Freeform code (LLM writes the diagram language directly — richer output,
// no structured editor; the code itself is the editable artifact)
// ============================================================================

export const freeformSpecSchema = z.object({
  kind: z.literal('freeform'),
  language: z.enum(['dot']),
  title: z.string().min(1).max(160),
  code: z.string().min(10).max(20000),
})

export type FreeformSpec = z.infer<typeof freeformSpecSchema>

// ============================================================================
// Sketch (Gemini image — conceptual illustration)
// ============================================================================

export const sketchSpecSchema = z.object({
  kind: z.literal('sketch'),
  title: z.string().min(1).max(160),
  prompt: z.string().min(1).max(2400),
})

export type SketchSpec = z.infer<typeof sketchSpecSchema>

// ============================================================================
// Union
// ============================================================================

export const diagramSpecSchema = z.discriminatedUnion('kind', [
  ganttSpecSchema,
  flowSpecSchema,
  logicModelSpecSchema,
  chartSpecSchema,
  plotSpecSchema,
  sketchSpecSchema,
  freeformSpecSchema,
])

export type DiagramSpec = z.infer<typeof diagramSpecSchema>

export type DiagramStudioKind = DiagramSpec['kind']

/** Kinds a user can pick when creating a diagram (freeform is a mode, not a kind). */
export type CreatableDiagramKind = Exclude<DiagramStudioKind, 'freeform'>

export const DIAGRAM_KIND_TO_DB: Record<DiagramStudioKind, string> = {
  gantt: 'GANTT',
  flowchart: 'FLOWCHART',
  logic_model: 'LOGIC_MODEL',
  chart: 'CHART',
  plot: 'PLOT',
  sketch: 'SKETCH',
  // Freeform code diagrams are stored under the flowchart DB kind; the spec's
  // own `kind: 'freeform'` field is what routes rendering.
  freeform: 'FLOWCHART',
}

export const DB_TO_DIAGRAM_KIND: Record<string, DiagramStudioKind> = {
  GANTT: 'gantt',
  FLOWCHART: 'flowchart',
  LOGIC_MODEL: 'logic_model',
  CHART: 'chart',
  PLOT: 'plot',
  SKETCH: 'sketch',
}

/**
 * Parse + normalize an LLM-produced spec for a given kind. Throws ZodError
 * with readable issues on mismatch (used to build the retry prompt).
 * A stored spec whose own kind is 'freeform' keeps it (DB kind stays coarse).
 */
export function parseDiagramSpec(kind: DiagramStudioKind, raw: unknown): DiagramSpec {
  const rawKind =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).kind
      : undefined
  const effectiveKind = rawKind === 'freeform' ? 'freeform' : kind
  const candidate =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>), kind: effectiveKind }
      : raw
  const spec = diagramSpecSchema.parse(candidate)
  if (spec.kind === 'gantt') return normalizeGanttSpec(spec)
  return spec
}

/** Clamp task ranges into the plan window and keep months ordered. */
export function normalizeGanttSpec(spec: GanttSpec): GanttSpec {
  const totalMonths = spec.totalMonths
  return {
    ...spec,
    groups: spec.groups.map(group => ({
      ...group,
      tasks: group.tasks.map(task => {
        const start = Math.min(Math.max(1, task.startMonth), totalMonths)
        const end = Math.min(Math.max(start, task.endMonth), totalMonths)
        return { ...task, startMonth: start, endMonth: end }
      }),
    })),
    milestones: (spec.milestones || []).map(m => ({
      ...m,
      month: Math.min(Math.max(1, m.month), totalMonths),
    })),
  }
}
