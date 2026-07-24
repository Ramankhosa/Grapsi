/**
 * Grant Diagram Studio — deterministic renderer dispatch.
 *
 * Spec + theme → PNG buffer. Custom SVG compilers (gantt, logic model) are
 * rasterized with resvg; flowcharts render through the existing Mermaid/Kroki
 * service; charts through QuickChart. Everything is PNG so previews, [Figure N]
 * chips, and DOCX export share one asset.
 */

import path from 'path'
import { promises as fs } from 'fs'
import { generateMermaidDiagram } from '@/lib/figure-generation/mermaid-service'
import { generateChartFromConfig } from '@/lib/figure-generation/quickchart-service'
import type { QuickChartConfig, ChartDataset } from '@/lib/figure-generation/types'
import type { ChartSpec, DiagramSpec, FlowSpec, GanttSpec, LogicModelSpec } from './spec-types'
import { compileGanttSvg } from './gantt-svg'
import { compileLogicModelSvg } from './logic-model-svg'
import { compileFlowMermaid } from './flow-mermaid'
import { compileFlowDot } from './flow-dot'
import { DiagramTheme, seriesColor, seriesFillColor } from './theme'

export interface RenderedDiagram {
  buffer: Buffer
  format: 'png'
  generatedCode?: string
}

const RASTER_TARGET_WIDTH = 1800

async function rasterizeSvg(svg: string): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: RASTER_TARGET_WIDTH },
    background: '#ffffff',
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Arial',
    },
  })
  return Buffer.from(resvg.render().asPng())
}

function chartSpecToQuickChartConfig(spec: ChartSpec, theme: DiagramTheme): QuickChartConfig {
  const isStacked = spec.chartType === 'stackedBar'
  const type = spec.chartType === 'stackedBar' ? 'bar' : spec.chartType
  const isPieLike = type === 'pie' || type === 'doughnut'

  const datasets: ChartDataset[] = spec.datasets.map((dataset, index) => ({
    label: dataset.label,
    data: dataset.data,
    backgroundColor: isPieLike
      ? dataset.data.map((_, i) => seriesColor(theme, i))
      : type === 'line'
        ? 'transparent'
        : seriesFillColor(theme, index),
    borderColor: isPieLike
      ? theme.background
      : seriesColor(theme, index),
    borderWidth: type === 'line' ? 2.5 : 1.5,
    fill: false,
  }))

  const unitHint = [spec.valuePrefix, spec.valueSuffix].filter(Boolean).join(' / ')
  const axisLabels = {
    x: spec.xLabel,
    y: spec.yLabel ? `${spec.yLabel}${unitHint ? ` (${unitHint})` : ''}` : unitHint ? `(${unitHint})` : undefined,
  }

  return {
    type: type as QuickChartConfig['type'],
    data: { labels: spec.labels, datasets },
    options: {
      title: { display: false, text: spec.title },
      legend: {
        display: spec.datasets.length > 1 || isPieLike,
        position: 'bottom',
        labels: { fontFamily: 'Arial', fontColor: theme.text },
      },
      ...(isPieLike
        ? {}
        : {
            scales: {
              xAxes: [
                {
                  stacked: isStacked,
                  gridLines: { color: theme.grid, drawBorder: true },
                  ticks: { fontColor: theme.mutedText },
                  scaleLabel: axisLabels.x
                    ? { display: true, labelString: axisLabels.x, fontColor: theme.text }
                    : undefined,
                },
              ],
              yAxes: [
                {
                  stacked: isStacked,
                  gridLines: { color: theme.grid, drawBorder: true },
                  ticks: {
                    fontColor: theme.mutedText,
                    beginAtZero: true,
                  },
                  scaleLabel: axisLabels.y
                    ? { display: true, labelString: axisLabels.y, fontColor: theme.text }
                    : undefined,
                },
              ],
            },
          }),
    },
  }
}

async function renderGantt(spec: GanttSpec, theme: DiagramTheme): Promise<RenderedDiagram> {
  const svg = compileGanttSvg(spec, theme)
  return { buffer: await rasterizeSvg(svg), format: 'png', generatedCode: svg }
}

async function renderLogicModel(spec: LogicModelSpec, theme: DiagramTheme): Promise<RenderedDiagram> {
  const svg = compileLogicModelSvg(spec, theme)
  return { buffer: await rasterizeSvg(svg), format: 'png', generatedCode: svg }
}

const KROKI_BASE_URL = process.env.KROKI_BASE_URL || 'https://kroki.io'

function encodeForKroki(source: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pako = require('pako')
  const compressed = pako.deflate(source, { level: 9 })
  return Buffer.from(compressed)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function renderGraphvizSvg(dot: string): Promise<string> {
  const url = `${KROKI_BASE_URL}/graphviz/svg/${encodeForKroki(dot)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'image/svg+xml' },
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Graphviz render failed (${response.status}): ${detail.slice(0, 300)}`)
    }
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function renderFlow(spec: FlowSpec, theme: DiagramTheme): Promise<RenderedDiagram> {
  // Preferred path: Graphviz SVG (pure-SVG text) rasterized locally at print
  // resolution. Falls back to Mermaid PNG via Kroki when Graphviz fails.
  const dot = compileFlowDot(spec, theme)
  try {
    const svg = await renderGraphvizSvg(dot)
    return { buffer: await rasterizeSvg(svg), format: 'png', generatedCode: dot }
  } catch (error) {
    console.warn('[DiagramStudio] Graphviz path failed, falling back to Mermaid:', error)
  }

  const code = compileFlowMermaid(spec, theme)
  const result = await generateMermaidDiagram(
    { diagramType: 'flowchart', code },
    { format: 'png' }
  )
  if (!result.success || !result.imageBase64) {
    throw new Error(result.error || 'Flowchart rendering failed')
  }
  return {
    buffer: Buffer.from(result.imageBase64, 'base64'),
    format: 'png',
    generatedCode: code,
  }
}

async function renderChart(spec: ChartSpec, theme: DiagramTheme): Promise<RenderedDiagram> {
  const config = chartSpecToQuickChartConfig(spec, theme)
  const result = await generateChartFromConfig(config, {
    title: spec.title,
    format: 'png',
    backgroundColor: theme.background,
  })
  if (!result.success || !result.imageBase64) {
    throw new Error(result.error || 'Chart rendering failed')
  }
  return {
    buffer: Buffer.from(result.imageBase64, 'base64'),
    format: 'png',
    generatedCode: JSON.stringify(config),
  }
}

/** Render LLM-written DOT code at print resolution. */
export async function renderFreeformDot(code: string): Promise<RenderedDiagram> {
  const svg = await renderGraphvizSvg(code)
  return { buffer: await rasterizeSvg(svg), format: 'png', generatedCode: code }
}

/** Re-execute a stored PythonChartSpec (LLM-written matplotlib code). */
async function renderStoredPythonSpec(pythonSpec: unknown): Promise<RenderedDiagram> {
  const { generatePythonChart } = await import('@/lib/figure-generation/python-chart-service')
  const result = await generatePythonChart(pythonSpec as never)
  if (!result.success || !result.imageBase64) {
    throw new Error(result.error || 'Statistical plot rendering failed')
  }
  return {
    buffer: Buffer.from(result.imageBase64, 'base64'),
    format: 'png',
    generatedCode: (pythonSpec as { code?: string })?.code,
  }
}

export async function renderDiagramSpec(
  spec: DiagramSpec,
  theme: DiagramTheme
): Promise<RenderedDiagram> {
  switch (spec.kind) {
    case 'gantt':
      return renderGantt(spec, theme)
    case 'logic_model':
      return renderLogicModel(spec, theme)
    case 'flowchart':
      return renderFlow(spec, theme)
    case 'chart':
      return renderChart(spec, theme)
    case 'freeform':
      return renderFreeformDot(spec.code)
    case 'plot':
      if (!spec.pythonSpec) {
        throw new Error('This plot has no stored matplotlib spec — regenerate it instead.')
      }
      return renderStoredPythonSpec(spec.pythonSpec)
    default:
      throw new Error(`Renderer for '${(spec as DiagramSpec).kind}' is handled outside renderDiagramSpec`)
  }
}

// ============================================================================
// Asset persistence
// ============================================================================

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'grant-diagrams')

export async function saveDiagramAsset(params: {
  diagramId: string
  version: number
  buffer: Buffer
  format: string
}): Promise<string> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const fileName = `grant_diagram_${params.diagramId}_v${params.version}.${params.format}`
  await fs.writeFile(path.join(UPLOAD_DIR, fileName), params.buffer)
  return `/uploads/grant-diagrams/${fileName}`
}

export async function deleteDiagramAsset(imagePath?: string | null): Promise<void> {
  if (!imagePath) return
  const normalized = imagePath.replace(/^[/\\]+/, '')
  if (!normalized.startsWith('uploads/grant-diagrams/')) return
  try {
    await fs.unlink(path.join(process.cwd(), 'public', normalized))
  } catch {
    // Asset already gone — nothing to clean up.
  }
}
