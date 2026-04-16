/**
 * Python Chart Service
 *
 * Calls a Docker-hosted matplotlib/seaborn rendering server to produce
 * publication-grade statistical plots that Chart.js cannot handle:
 * box plots, violin plots, heatmaps, ROC curves, regression plots, etc.
 *
 * The Python server runs on the same GCP VM as the app, exposed on port 5100.
 * See docker/python-charts/ for the container source.
 */

import type { FigureGenerationResult, FigureData } from './types'

const PYTHON_CHART_URL = process.env.PYTHON_CHART_URL || 'http://localhost:5100'
const PYTHON_CHART_TIMEOUT = Number(process.env.PYTHON_CHART_TIMEOUT_MS) || 45_000

export const PUBLICATION_GRADE_PYTHON_PLOT_TYPES = [
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

export type PythonPlotType =
  | 'boxplot'
  | 'violin'
  | 'heatmap'
  | 'confusion_matrix'
  | 'roc_curve'
  | 'error_bar'
  | 'regression'
  | 'bland_altman'
  | 'forest_plot'
  | 'custom'

export interface PythonChartSpec {
  plotType: PythonPlotType
  title?: string
  xAxisLabel?: string
  yAxisLabel?: string
  journal?: 'nature' | 'ieee' | 'elsevier' | 'default'
  figureSize?: 'single_column' | 'double_column' | 'square' | 'wide'
  data: Record<string, any>

  // boxplot / violin
  showDataPoints?: boolean

  // heatmap
  colormap?: string
  annotate?: boolean
  fmt?: string

  // roc_curve -- data.curves[]
  // error_bar
  significanceBrackets?: Array<{
    group1: number
    group2: number
    text: string
    tier?: number
  }>

  // regression
  showConfidenceBand?: boolean

  // forest_plot
  nullEffect?: number

  // custom
  code?: string
}

export function isPublicationGradePythonPlotType(plotType: string): plotType is typeof PUBLICATION_GRADE_PYTHON_PLOT_TYPES[number] {
  return (PUBLICATION_GRADE_PYTHON_PLOT_TYPES as readonly string[]).includes(plotType)
}

/**
 * Check if the Python chart server is available.
 */
export async function isPythonChartServerHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(`${PYTHON_CHART_URL}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Render a statistical plot via the Python server.
 */
export async function generatePythonChart(
  spec: PythonChartSpec
): Promise<FigureGenerationResult> {
  const startTime = Date.now()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PYTHON_CHART_TIMEOUT)

    let response: Response
    try {
      response = await fetch(`${PYTHON_CHART_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          success: false,
          error: `Python chart server timed out after ${PYTHON_CHART_TIMEOUT}ms`,
          errorCode: 'TIMEOUT',
          provider: 'python_matplotlib',
          apiCallDuration: Date.now() - startTime,
        }
      }
      return {
        success: false,
        error: `Python chart server unreachable: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: 'API_ERROR',
        provider: 'python_matplotlib',
        apiCallDuration: Date.now() - startTime,
      }
    } finally {
      clearTimeout(timeout)
    }

    const body = await response.json()

    if (!response.ok || !body.success) {
      return {
        success: false,
        error: body.error || `Python server returned ${response.status}`,
        errorCode: 'RENDERING_FAILED',
        provider: 'python_matplotlib',
        apiCallDuration: Date.now() - startTime,
      }
    }

    const imageBase64: string = body.imageBase64
    const buffer = Buffer.from(imageBase64, 'base64')

    return {
      success: true,
      imageBase64,
      format: 'png',
      fileSize: buffer.length,
      provider: 'python_matplotlib',
      apiCallDuration: Date.now() - startTime,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Python chart generation failed',
      errorCode: 'RENDERING_FAILED',
      provider: 'python_matplotlib',
      apiCallDuration: Date.now() - startTime,
    }
  }
}

/**
 * Convert a generic FigureData + plotType into a PythonChartSpec.
 * Used by the generate route when routing STATISTICAL_PLOT to Python.
 */
export function figureDataToPythonSpec(
  plotType: string,
  figureData?: FigureData,
  opts?: {
    title?: string
    xAxisLabel?: string
    yAxisLabel?: string
    journal?: string
  }
): PythonChartSpec | null {
  const base: Partial<PythonChartSpec> = {
    title: opts?.title,
    xAxisLabel: opts?.xAxisLabel,
    yAxisLabel: opts?.yAxisLabel,
    journal: (opts?.journal as any) || 'default',
    figureSize: 'single_column',
  }

  if (!figureData) return null

  switch (plotType) {
    case 'boxplot':
    case 'violin': {
      if (!figureData.groups) return null
      return { ...base, plotType: plotType as PythonPlotType, data: { groups: figureData.groups }, showDataPoints: true }
    }
    case 'heatmap': {
      if (!figureData.matrix) return null
      return {
        ...base,
        plotType: 'heatmap',
        data: {
          matrix: figureData.matrix,
          rowLabels: figureData.matrixLabels,
          colLabels: figureData.matrixLabels,
        },
        annotate: true,
        figureSize: 'square',
      }
    }
    case 'confusion_matrix': {
      if (!figureData.matrix) return null
      return {
        ...base,
        plotType: 'confusion_matrix',
        data: { matrix: figureData.matrix, labels: figureData.matrixLabels },
        figureSize: 'square',
      }
    }
    case 'regression': {
      if (!figureData.xValues || !figureData.yValues) return null
      return {
        ...base,
        plotType: 'regression',
        data: { x: figureData.xValues, y: figureData.yValues },
        showConfidenceBand: true,
        figureSize: 'square',
      }
    }
    case 'roc_curve': {
      if (!figureData.curves?.length) return null
      return {
        ...base,
        plotType: 'roc_curve',
        data: { curves: figureData.curves },
        xAxisLabel: opts?.xAxisLabel || 'False Positive Rate',
        yAxisLabel: opts?.yAxisLabel || 'True Positive Rate',
        figureSize: 'square',
      }
    }
    case 'error_bar':
    case 'errorbar': {
      if (!figureData.labels || !figureData.datasets) return null
      return {
        ...base,
        plotType: 'error_bar',
        data: {
          categories: figureData.labels,
          series: figureData.datasets.map(ds => ({
            label: ds.label,
            values: ds.data,
            errors: (ds as any).errors,
          })),
        },
      }
    }
    case 'bland_altman': {
      if (!figureData.method1 || !figureData.method2) return null
      return {
        ...base,
        plotType: 'bland_altman',
        data: {
          method1: figureData.method1,
          method2: figureData.method2,
        },
      }
    }
    case 'forest_plot': {
      if (!figureData.studies?.length) return null
      return {
        ...base,
        plotType: 'forest_plot',
        data: {
          studies: figureData.studies,
        },
        figureSize: 'double_column',
      }
    }
    default:
      return null
  }
}
