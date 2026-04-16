import type { TaskCode } from '@prisma/client'

import { llmGateway } from '@/lib/metering/gateway'
import {
  coercePaperFigureInferenceMeta,
  type PaperFigureInferenceMeta,
} from './paper-figure-metadata'

import type { ChartStructuredSpec, FigureData, FigureRole, PaperProfile } from './types'
import type { PythonChartSpec } from './python-chart-service'

type NumericChartDataset = {
  label: string
  data: number[]
  errors?: number[]
}

type PointDataset = {
  label: string
  data: Array<{ x: number; y: number; r?: number }>
}

export type ChartInputSource = 'payload' | 'request_text' | 'raw_request' | 'none'

export interface ResolvedChartGenerationInput {
  labels?: string[]
  datasets?: NumericChartDataset[]
  pointDatasets?: PointDataset[]
  rawDataText?: string
  source: ChartInputSource
}

export interface StatisticalPlotCodeRequest {
  plotType: string
  title: string
  description: string
  sectionType?: string
  figureRole?: FigureRole
  paperGenre?: string
  studyType?: PaperProfile['studyType']
  chartSpec?: ChartStructuredSpec
  structuredData?: Record<string, any> | null
  rawDataText?: string | null
  journal?: 'nature' | 'ieee' | 'elsevier' | 'default'
}

export interface StatisticalPlotCodeResult {
  success: boolean
  spec?: PythonChartSpec
  inferredMeta?: PaperFigureInferenceMeta | null
  error?: string
  tokensUsed?: number
  model?: string
}

const MAX_STAT_PLOT_RETRIES = 1

const PAPER_FIGURE_METADATA_OUTPUT_GUIDE = `{
  "summary": "1-2 sentence figure summary grounded in the provided data and intended plot",
  "visibleElements": ["up to 8 concrete visible elements that the rendered figure should contain"],
  "visibleText": ["up to 10 short labels expected to be visible, such as axes, legend labels, panel labels, or annotations"],
  "keyVariables": ["up to 8 variables, metrics, axes, or entities represented"],
  "comparedGroups": ["up to 8 groups, cohorts, methods, conditions, or curves being compared"],
  "numericHighlights": ["up to 8 exact values, ranges, counts, percentages, intervals, or ranks taken directly from the provided data"],
  "observedPatterns": ["up to 8 direct patterns or contrasts implied by the provided data"],
  "resultDetails": ["up to 8 concise, result-safe observations that the Results section may report"],
  "methodologyDetails": ["up to 8 setup or measurement details only if the plot structure itself makes them explicit"],
  "discussionCues": ["up to 8 restrained interpretation cues, caveats, or anomalies suggested by the data"],
  "chartSignals": ["up to 8 trend or distribution signals visible in the plot"],
  "claimsSupported": ["up to 8 conservative claims directly supported by the provided data and intended visualization"],
  "claimsToAvoid": ["up to 8 claims that would overreach the provided data or plot alone"]
}`

function summarizeStructuredDataComplexity(structuredData: Record<string, any> | null | undefined): string[] {
  if (!structuredData) return []

  const notes: string[] = []
  const labelsCount = Array.isArray(structuredData.labels) ? structuredData.labels.length : 0
  const datasetsCount = Array.isArray(structuredData.datasets) ? structuredData.datasets.length : 0
  const pointDatasetCount = Array.isArray(structuredData.pointDatasets) ? structuredData.pointDatasets.length : 0
  const valuesCount = Array.isArray(structuredData.values) ? structuredData.values.length : 0
  const groupsCount = structuredData.groups && typeof structuredData.groups === 'object'
    ? Object.keys(structuredData.groups).length
    : 0
  const curvesCount = Array.isArray(structuredData.curves) ? structuredData.curves.length : 0
  const studiesCount = Array.isArray(structuredData.studies) ? structuredData.studies.length : 0
  const matrixRows = Array.isArray(structuredData.matrix) ? structuredData.matrix.length : 0
  const matrixCols = matrixRows > 0 && Array.isArray(structuredData.matrix?.[0]) ? structuredData.matrix[0].length : 0
  const xCount = Array.isArray(structuredData.xValues) ? structuredData.xValues.length : 0
  const yCount = Array.isArray(structuredData.yValues) ? structuredData.yValues.length : 0
  const errorSeriesCount = Array.isArray(structuredData.datasets)
    ? structuredData.datasets.filter((dataset: any) => Array.isArray(dataset?.errors) && dataset.errors.length > 0).length
    : 0

  if (labelsCount > 0) notes.push(`- Category labels: ${labelsCount}`)
  if (datasetsCount > 0) {
    const maxSeriesSize = Math.max(
      0,
      ...structuredData.datasets.map((dataset: any) => Array.isArray(dataset?.data) ? dataset.data.length : 0)
    )
    notes.push(`- Numeric series: ${datasetsCount} (max ${maxSeriesSize} values per series)`)
  }
  if (pointDatasetCount > 0) {
    const totalPoints = structuredData.pointDatasets.reduce(
      (sum: number, dataset: any) => sum + (Array.isArray(dataset?.data) ? dataset.data.length : 0),
      0
    )
    notes.push(`- Point datasets: ${pointDatasetCount} (${totalPoints} total plotted points)`)
  }
  if (valuesCount > 0) notes.push(`- Standalone numeric values: ${valuesCount}`)
  if (xCount > 0 || yCount > 0) notes.push(`- Paired numeric coordinates: x=${xCount}, y=${yCount}`)
  if (groupsCount > 0) notes.push(`- Grouped distributions: ${groupsCount} groups`)
  if (curvesCount > 0) {
    const maxCurvePoints = Math.max(
      0,
      ...structuredData.curves.map((curve: any) => Math.max(
        Array.isArray(curve?.fpr) ? curve.fpr.length : 0,
        Array.isArray(curve?.tpr) ? curve.tpr.length : 0
      ))
    )
    notes.push(`- Curves: ${curvesCount} (max ${maxCurvePoints} points per curve)`)
  }
  if (studiesCount > 0) notes.push(`- Forest/meta-analysis rows: ${studiesCount}`)
  if (matrixRows > 0 && matrixCols > 0) notes.push(`- Matrix dimensions: ${matrixRows} x ${matrixCols}`)
  if (errorSeriesCount > 0) notes.push(`- Uncertainty/error arrays present in ${errorSeriesCount} series`)

  if (labelsCount > 12) notes.push('- Dense categorical axis: preserve every category; use rotation, compact ticks, or horizontal orientation instead of dropping labels.')
  if (datasetsCount > 4) notes.push('- Multi-series comparison is dense: preserve every series and reduce ornamentation, not data.')
  if (pointDatasetCount > 0) {
    const totalPoints = structuredData.pointDatasets.reduce(
      (sum: number, dataset: any) => sum + (Array.isArray(dataset?.data) ? dataset.data.length : 0),
      0
    )
    if (totalPoints > 40) {
      notes.push('- Dense point cloud: keep every point; reduce marker size/opacity rather than filtering or sampling.')
    }
  }
  if (studiesCount > 8) notes.push('- Many study rows: prefer a double-column or tall layout that preserves all studies and intervals.')
  if (matrixRows >= 8 || matrixCols >= 8) notes.push('- Dense matrix: preserve all rows and columns with a square, legible layout.')

  return notes
}

function summarizeRawDataComplexity(rawDataText: string | null | undefined): string[] {
  if (!rawDataText) return []

  const lines = rawDataText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const notes: string[] = []
  if (lines.length > 0) {
    notes.push(`- Raw text lines containing data/request content: ${lines.length}`)
  }

  const tabularRows = lines
    .map(splitRawDataRow)
    .filter((cells) => cells.length >= 2)
  if (tabularRows.length > 0) {
    const columnCount = Math.max(...tabularRows.map((row) => row.length))
    notes.push(`- Parsed tabular rows: ${tabularRows.length} with up to ${columnCount} columns`)
    if (tabularRows.length > 12) {
      notes.push('- Raw table is dense: keep all rows/categories present in the request.')
    }
  }

  return notes
}

const STATISTICAL_PLOT_CODE_PROMPT = `You are an expert scientific visualization engineer.

Your task: write safe, publication-grade matplotlib/seaborn code for a paper figure request and return drafting-grade metadata in the same response.

RETURN FORMAT (STRICT):
- Return ONLY valid JSON.
- No markdown fences. No prose. No comments outside the JSON object.
- Use this exact shape:
{
  "figureSize": "single_column|double_column|square|wide",
  "xAxisLabel": "optional x-axis label",
  "yAxisLabel": "optional y-axis label",
  "code": "python code string",
  "metadata": ${PAPER_FIGURE_METADATA_OUTPUT_GUIDE}
}

MATPLOTLIB EXECUTION RULES (HARD CONSTRAINTS):
1. The runtime already provides these globals: plt, np, sns, fig, ax, stats, ACADEMIC_PALETTE.
2. Do NOT use import, open, exec, eval, compile, globals, locals, __builtins__, __import__, os, sys, pathlib, subprocess, requests, pickle, pandas, or files/network access.
3. Do NOT create a new figure. Never call plt.figure() or plt.subplots(). Use the provided fig and ax only.
4. The code must fully render the requested plot on ax.
5. Do NOT render a top title on the image. Use the provided title only as semantic guidance. Axis labels, legends, grids, and annotations are allowed and should remain legible.
6. Prefer a clean academic style: thin grid, clear labels, limited colors, legible ticks, tight layout.
7. NEVER invent data. If structured data or pasted raw rows are provided, use only those values. If the request is ambiguous, choose the most conservative direct interpretation of the provided values.
8. If the request includes raw CSV/TSV/JSON/table text, convert it into explicit Python literals inside the code before plotting.
9. Keep code compact and deterministic. No randomness.
10. Use only matplotlib/seaborn/numpy/statistics operations that are already available through the provided globals.
11. Preserve all supplied rows, studies, curves, groups, categories, and points. Do not downsample, prune, merge, or drop data to make the plot simpler.
12. Adapt the layout to data complexity: for dense labels use rotation/wrapping/smaller ticks; for many studies use a wider/taller layout; for dense scatter keep all points with smaller markers/alpha.
13. Use uncertainty/error/confidence data whenever provided and supported by the requested plot type.

PLOT-TYPE GUIDANCE:
- boxplot / violin: preserve group labels and values exactly.
- heatmap / confusion_matrix: build a numeric matrix and explicit tick labels.
- roc_curve: preserve each curve's fpr/tpr arrays and show diagonal baseline.
- error_bar: preserve categories, central values, and error ranges.
- regression: plot the actual points and a fitted trend line or seaborn regression.
- bland_altman: compute mean and difference from the provided paired values.
- forest_plot: preserve effect sizes, confidence intervals, weights, and study labels.

METADATA RULES:
- The metadata must be derived from the supplied data, labels, chartSpec, and intended rendered plot. No second-pass image verification is available.
- Assume the final figure will render the axes, legends, labels, intervals, and annotations specified by your code.
- "numericHighlights" must quote exact numbers, ranges, intervals, counts, or percentages from the provided data.
- "observedPatterns", "resultDetails", and "claimsSupported" must stay conservative and strictly proportional to the supplied data.
- "claimsToAvoid" must explicitly block causal, significance, generalization, or performance claims not proven by the data alone.

USER REQUEST:
`

function sanitizeAscii(input: string, keepNewlines: boolean = false): string {
  const normalized = (input || '').normalize('NFKD')
  return keepNewlines
    ? normalized.replace(/[^\x20-\x7E\n]/g, '')
    : normalized.replace(/[^\x20-\x7E]/g, '')
}

function extractJSON(raw: string): string {
  let cleaned = raw.trim()

  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim()
  }

  const firstBrace = cleaned.indexOf('{')
  const firstBracket = cleaned.indexOf('[')
  const startIdx = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket)
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

async function callPlotLLM(
  prompt: string,
  stageCode: string,
  requestHeaders: Record<string, string>,
  metadata?: Record<string, any>
): Promise<{ response: string; tokensUsed: number; model: string }> {
  const result = await llmGateway.executeLLMOperation(
    { headers: requestHeaders },
    {
      taskCode: 'LLM2_DRAFT' as TaskCode,
      stageCode,
      prompt,
      parameters: {
        temperature: 0.2,
      },
      idempotencyKey: `plot-gen-${stageCode}-${Date.now()}`,
      metadata: {
        module: 'paper-plots',
        stageCode,
        ...metadata,
      },
    }
  )

  if (!result.success || !result.response) {
    throw new Error(result.error?.message || 'LLM call failed')
  }

  return {
    response: result.response.output,
    tokensUsed: result.response.outputTokens || 0,
    model: result.response.modelClass || 'unknown',
  }
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const normalized = value
    .trim()
    .replace(/[%]$/g, '')
    .replace(/,/g, '')

  if (!normalized) return null

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function splitRawDataRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  const delimited = ['\t', '|', ';', ',']
    .map((delimiter) => {
      const cells = trimmed
        .split(delimiter)
        .map((cell) => cell.trim())
        .filter(Boolean)
      return cells.length >= 2 ? cells : []
    })
    .find((cells) => cells.length >= 2)

  return delimited || []
}

function hasNumericSignal(text: string | null | undefined): boolean {
  return /\d/.test(text || '')
}

function buildPointDatasetsFromPayload(
  plotType: string,
  data: Record<string, any> | null | undefined,
  fallbackLabel: string
): PointDataset[] | null {
  if (!data) return null

  if (!Array.isArray(data.xValues) || !Array.isArray(data.yValues) || data.xValues.length !== data.yValues.length || data.xValues.length === 0) {
    return null
  }

  const points = data.xValues
    .map((xValue: unknown, index: number) => {
      const x = Number(xValue)
      const y = Number(data.yValues[index])
      const r = plotType === 'bubble' ? Number(data.values?.[index]) : undefined

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      if (plotType === 'bubble' && r !== undefined && !Number.isFinite(r)) {
        return null
      }

      return plotType === 'bubble' && Number.isFinite(r)
        ? { x, y, r }
        : { x, y }
    })
    .filter((point): point is { x: number; y: number; r?: number } => !!point)

  if (!points.length) return null

  return [{ label: fallbackLabel, data: points }]
}

function buildNumericChartDataFromPayload(
  data: Record<string, any> | null | undefined,
  fallbackLabel: string
): { labels: string[]; datasets: NumericChartDataset[] } | null {
  if (!data) return null

  if (Array.isArray(data.labels) && Array.isArray(data.datasets) && data.datasets.length > 0) {
    const datasets = data.datasets
      .map((dataset: any) => ({
        label: typeof dataset?.label === 'string' && dataset.label.trim() ? dataset.label.trim() : fallbackLabel,
        data: Array.isArray(dataset?.data)
          ? dataset.data.map((value: unknown) => Number(value)).filter(Number.isFinite)
          : [],
        errors: Array.isArray(dataset?.errors)
          ? dataset.errors.map((value: unknown) => Number(value)).filter(Number.isFinite)
          : undefined,
      }))
      .filter((dataset) => dataset.data.length > 0)

    if (datasets.length > 0) {
      return { labels: data.labels, datasets }
    }
  }

  if (Array.isArray(data.labels) && Array.isArray(data.values) && data.labels.length === data.values.length && data.values.length > 0) {
    const values = data.values.map((value: unknown) => Number(value)).filter(Number.isFinite)
    if (values.length === data.labels.length) {
      return {
        labels: data.labels,
        datasets: [{ label: fallbackLabel, data: values }],
      }
    }
  }

  return null
}

function buildPointDatasetsFromText(
  plotType: string,
  requestText: string | null | undefined,
  fallbackLabel: string
): PointDataset[] | null {
  if (!requestText) return null

  const lines = requestText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return null

  const tabularRows = lines
    .map(splitRawDataRow)
    .filter((cells) => cells.length >= 2)

  if (tabularRows.length < 2) return null

  const columnCount = Math.max(...tabularRows.map((row) => row.length))
  const rows = tabularRows
    .filter((row) => row.length === columnCount)
    .map((row) => row.slice(0, columnCount))

  if (rows.length < 2) return null

  const hasHeader = rows[0].some((cell) => parseNumericValue(cell) === null)
  const header = hasHeader ? rows[0] : undefined
  const dataRows = hasHeader ? rows.slice(1) : rows

  const points = dataRows
    .map((row) => {
      const x = parseNumericValue(row[0])
      const y = parseNumericValue(row[1])
      const radius = plotType === 'bubble' ? parseNumericValue(row[2]) : null

      if (x === null || y === null) return null
      if (plotType === 'bubble' && row.length >= 3 && radius === null) return null

      return plotType === 'bubble' && radius !== null
        ? { x, y, r: radius }
        : { x, y }
    })
    .filter((point): point is { x: number; y: number; r?: number } => !!point)

  if (!points.length) return null

  return [{
    label: header?.find((cell, index) => index > 1 && parseNumericValue(cell) === null) || fallbackLabel,
    data: points,
  }]
}

function buildNumericChartDataFromText(
  requestText: string | null | undefined,
  fallbackLabel: string
): { labels: string[]; datasets: NumericChartDataset[] } | null {
  if (!requestText) return null

  const lines = requestText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  const tabularRows = lines
    .map(splitRawDataRow)
    .filter((cells) => cells.length >= 2)

  if (tabularRows.length >= 2) {
    const columnCount = Math.max(...tabularRows.map((row) => row.length))
    const rows = tabularRows
      .filter((row) => row.length === columnCount)
      .map((row) => row.slice(0, columnCount))

    if (rows.length >= 2) {
      const hasHeader = rows[0].some((cell) => parseNumericValue(cell) === null)
        && rows.slice(1).some((row) => row.slice(1).some((cell) => parseNumericValue(cell) !== null))
      const header = hasHeader ? rows[0] : undefined
      const dataRows = hasHeader ? rows.slice(1) : rows

      if (dataRows.length >= 2) {
        if (columnCount === 2) {
          const parsedValues = dataRows.map((row) => parseNumericValue(row[1]))
          if (parsedValues.every((value) => value !== null)) {
            return {
              labels: dataRows.map((row) => row[0]),
              datasets: [{
                label: header?.[1] || fallbackLabel,
                data: parsedValues as number[],
              }],
            }
          }
        }

        if (columnCount >= 3) {
          const labels = dataRows.map((row) => row[0])
          const datasets = Array.from({ length: columnCount - 1 }, (_, index) => {
            const column = index + 1
            const parsedValues = dataRows.map((row) => parseNumericValue(row[column]))
            if (!parsedValues.every((value) => value !== null)) return null
            return {
              label: header?.[column] || `${fallbackLabel} ${index + 1}`,
              data: parsedValues as number[],
            }
          }).filter((dataset): dataset is NumericChartDataset => !!dataset)

          if (labels.length > 0 && datasets.length > 0) {
            return { labels, datasets }
          }
        }
      }
    }
  }

  const pairRows = lines
    .map((line) => line.match(/^(.+?)\s*[:=]\s*(-?\d+(?:,\d{3})*(?:\.\d+)?%?)$/))
    .filter((match): match is RegExpMatchArray => !!match)

  if (pairRows.length >= 2) {
    const labels = pairRows.map((match) => match[1].trim())
    const values = pairRows
      .map((match) => parseNumericValue(match[2]))
      .filter((value): value is number => value !== null)

    if (labels.length === values.length && values.length > 0) {
      return {
        labels,
        datasets: [{
          label: fallbackLabel,
          data: values,
        }],
      }
    }
  }

  return null
}

export function resolveChartGenerationInput(
  plotType: string,
  data: Record<string, any> | null | undefined,
  requestText: string | null | undefined,
  fallbackLabel: string
): ResolvedChartGenerationInput {
  const normalizedType = sanitizeAscii((plotType || '').toLowerCase())
  const expectsPoints = normalizedType === 'scatter' || normalizedType === 'bubble'

  if (expectsPoints) {
    const pointPayload = buildPointDatasetsFromPayload(normalizedType, data, fallbackLabel)
    if (pointPayload?.length) {
      return { pointDatasets: pointPayload, source: 'payload' }
    }

    const pointText = buildPointDatasetsFromText(normalizedType, requestText, fallbackLabel)
    if (pointText?.length) {
      return { pointDatasets: pointText, rawDataText: requestText || undefined, source: 'request_text' }
    }
  }

  const payload = buildNumericChartDataFromPayload(data, fallbackLabel)
  if (payload) {
    return { ...payload, source: 'payload' }
  }

  const fromText = buildNumericChartDataFromText(requestText, fallbackLabel)
  if (fromText) {
    return { ...fromText, rawDataText: requestText || undefined, source: 'request_text' }
  }

  if (hasNumericSignal(requestText)) {
    return { rawDataText: requestText || undefined, source: 'raw_request' }
  }

  return { source: 'none' }
}

export function hasResolvedExplicitChartData(input: ResolvedChartGenerationInput): boolean {
  return !!input.datasets?.length || !!input.pointDatasets?.length
}

export function toFigureDataPayload(input: ResolvedChartGenerationInput): FigureData | null {
  if (input.pointDatasets?.length) {
    const primaryDataset = input.pointDatasets[0]
    if (!primaryDataset?.data?.length) return null

    const xValues = primaryDataset.data.map((point) => point.x)
    const yValues = primaryDataset.data.map((point) => point.y)
    const radii = primaryDataset.data
      .map((point) => point.r)
      .filter((value): value is number => Number.isFinite(value))

    return {
      xValues,
      yValues,
      ...(radii.length === primaryDataset.data.length ? { values: radii } : {}),
    }
  }

  if (input.labels?.length && input.datasets?.length) {
    return {
      labels: [...input.labels],
      datasets: input.datasets.map((dataset) => ({
        label: dataset.label,
        data: [...dataset.data],
        ...(dataset.errors?.length ? { errors: [...dataset.errors] } : {}),
      })),
    }
  }

  return null
}

function defaultFigureSizeForPlot(plotType: string): PythonChartSpec['figureSize'] {
  switch (sanitizeAscii((plotType || '').toLowerCase())) {
    case 'heatmap':
    case 'confusion_matrix':
    case 'roc_curve':
    case 'regression':
      return 'square'
    case 'forest_plot':
      return 'double_column'
    case 'bland_altman':
      return 'wide'
    default:
      return 'single_column'
  }
}

export function validateCustomPythonPlotCode(code: string): { valid: boolean; code: string; error?: string } {
  let cleaned = code.trim()

  const blockMatch = cleaned.match(/```(?:python)?\s*\n?([\s\S]*?)```/i)
  if (blockMatch) {
    cleaned = blockMatch[1].trim()
  }

  if (!cleaned || cleaned.length < 20) {
    return { valid: false, code: cleaned, error: 'Plot code is empty or too short.' }
  }

  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/\bimport\b/, 'Import statements are not allowed.'],
    [/\bopen\s*\(/, 'File access is not allowed.'],
    [/\bexec\s*\(/, 'Nested exec is not allowed.'],
    [/\beval\s*\(/, 'Eval is not allowed.'],
    [/\bcompile\s*\(/, 'Compile is not allowed.'],
    [/\bglobals\s*\(/, 'globals() is not allowed.'],
    [/\blocals\s*\(/, 'locals() is not allowed.'],
    [/\b__\w+__\b/, 'Dunder access is not allowed.'],
    [/\b(os|sys|subprocess|pathlib|requests|pickle|pandas)\b/, 'External modules are not available in the plot sandbox.'],
    [/plt\.(figure|subplots)\s*\(/, 'Do not create a new figure; use the provided fig and ax.'],
    [/\b(?:ax\.set_title|plt\.title)\s*\(/, 'Do not render a title on top of the plot image.'],
  ]

  for (const [pattern, message] of forbiddenPatterns) {
    if (pattern.test(cleaned)) {
      return { valid: false, code: cleaned, error: message }
    }
  }

  if (!/\b(ax|plt|sns)\./.test(cleaned)) {
    return { valid: false, code: cleaned, error: 'Plot code must draw using ax, plt, or sns.' }
  }

  return { valid: true, code: cleaned }
}

export async function generateStatisticalPlotSpec(
  request: StatisticalPlotCodeRequest,
  requestHeaders: Record<string, string>
): Promise<StatisticalPlotCodeResult> {
  if (!request.structuredData && !hasNumericSignal(request.rawDataText) && !hasNumericSignal(request.description)) {
    return {
      success: false,
      error: `Statistical plot "${request.plotType}" requires numeric content in either the structured data payload or the figure request text.`,
    }
  }

  let lastError: string | null = null
  let totalTokensUsed = 0

  for (let attempt = 0; attempt <= MAX_STAT_PLOT_RETRIES; attempt++) {
    try {
      let userRequest = sanitizeAscii(request.description, true).slice(0, 4000)
      userRequest += `\n\nPlot type: ${sanitizeAscii(request.plotType)}`
      userRequest += `\nFigure title: "${sanitizeAscii(request.title)}"`

      if (request.sectionType) {
        userRequest += `\nSection type: ${sanitizeAscii(request.sectionType).slice(0, 80)}`
      }
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
        userRequest += `\n\nchartSpec guidance:\n${JSON.stringify(request.chartSpec, null, 2)}`
      }
      if (request.structuredData) {
        userRequest += `\n\nStructured data payload (use these exact values):\n${JSON.stringify(request.structuredData, null, 2)}`
      }
      if (request.rawDataText && request.rawDataText.trim()) {
        userRequest += `\n\nRaw user data / request text (extract exact values from this when structured data is incomplete):\n${sanitizeAscii(request.rawDataText, true).slice(0, 4000)}`
      }

      const complexityNotes = [
        ...summarizeStructuredDataComplexity(request.structuredData),
        ...summarizeRawDataComplexity(request.rawDataText),
      ]
      if (complexityNotes.length > 0) {
        userRequest += `\n\nDATA COMPLEXITY / PRESERVATION SIGNALS:\n${complexityNotes.join('\n')}`
      }
      if (attempt > 0 && lastError) {
        userRequest += `\n\nIMPORTANT - YOUR PREVIOUS RESPONSE WAS INVALID.\nError: ${lastError}\nReturn only valid JSON with safe matplotlib code and no forbidden operations.`
      }

      const { response, tokensUsed, model } = await callPlotLLM(
        STATISTICAL_PLOT_CODE_PROMPT + userRequest,
        'PAPER_CHART_GENERATOR',
        requestHeaders,
        {
          plotType: request.plotType,
          sectionType: request.sectionType || null,
          figureRole: request.figureRole || null,
          hasStructuredData: !!request.structuredData,
          hasRawDataText: !!request.rawDataText,
          plotMode: 'python_code',
          attempt,
        }
      )
      totalTokensUsed += tokensUsed

      let parsed: any
      try {
        parsed = JSON.parse(extractJSON(response))
      } catch {
        lastError = 'Invalid JSON response for statistical plot code.'
        if (attempt < MAX_STAT_PLOT_RETRIES) continue
        return {
          success: false,
          error: lastError,
        }
      }

      const specSource = parsed?.spec && typeof parsed.spec === 'object' && !Array.isArray(parsed.spec)
        ? parsed.spec
        : parsed
      const inferredMeta = coercePaperFigureInferenceMeta(
        parsed?.metadata,
        new Date().toISOString(),
        model
      )
      const validation = validateCustomPythonPlotCode(String(specSource?.code || ''))
      if (!validation.valid) {
        lastError = validation.error || 'Invalid plot code.'
        if (attempt < MAX_STAT_PLOT_RETRIES) continue
        return {
          success: false,
          error: lastError,
        }
      }

      return {
        success: true,
        spec: {
          plotType: 'custom',
          title: request.title,
          xAxisLabel: typeof specSource?.xAxisLabel === 'string' && specSource.xAxisLabel.trim()
            ? sanitizeAscii(specSource.xAxisLabel).slice(0, 120)
            : request.chartSpec?.xAxisLabel,
          yAxisLabel: typeof specSource?.yAxisLabel === 'string' && specSource.yAxisLabel.trim()
            ? sanitizeAscii(specSource.yAxisLabel).slice(0, 120)
            : request.chartSpec?.yAxisLabel,
          journal: request.journal || 'default',
          figureSize: ['single_column', 'double_column', 'square', 'wide'].includes(specSource?.figureSize)
            ? specSource.figureSize
            : defaultFigureSizeForPlot(request.plotType),
          data: {
            plotType: request.plotType,
          },
          code: validation.code,
        },
        inferredMeta,
        tokensUsed: totalTokensUsed,
        model,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Statistical plot generation failed.'
      if (attempt < MAX_STAT_PLOT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        continue
      }
      return {
        success: false,
        error: lastError,
      }
    }
  }

  return {
    success: false,
    error: lastError || 'Statistical plot generation failed.',
  }
}
