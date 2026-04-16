/**
 * QuickChart.io Service
 * 
 * Integrates with QuickChart.io API for generating beautiful data visualizations.
 * Supports: bar, line, scatter, pie, radar, and more chart types.
 * 
 * Features:
 * - Academic-quality styling presets
 * - Colorblind-friendly palettes
 * - High DPI output for print
 * - SVG and PNG formats
 * 
 * API Documentation: https://quickchart.io/documentation/
 */

import {
  DataChartType,
  ChartDataset,
  FigureData,
  FigureTheme,
  AcademicFigureStyle,
  FigureGenerationResult,
  QuickChartConfig,
  ACADEMIC_COLOR_PALETTES,
  FIGURE_DIMENSIONS
} from './types'

// ============================================================================
// Configuration
// ============================================================================

const QUICKCHART_BASE_URL = process.env.QUICKCHART_BASE_URL || 'https://quickchart.io'
const QUICKCHART_API_KEY = process.env.QUICKCHART_API_KEY // Optional for higher limits

// Default styling for academic figures
// Sized for 300 DPI journal print quality
const ACADEMIC_DEFAULTS = {
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
  titleFontSize: 14,
  labelFontSize: 11,
  tickFontSize: 10,
  legendFontSize: 10,
  gridLineWidth: 0.4,
  borderWidth: 1.2,
  devicePixelRatio: 3
}

// ============================================================================
// Chart Configuration Builder
// ============================================================================

/**
 * Builds a QuickChart configuration from figure data and styling options.
 */
export function buildChartConfig(
  chartType: DataChartType,
  data: FigureData,
  title?: string,
  theme?: FigureTheme,
  academicStyle?: AcademicFigureStyle
): QuickChartConfig {
  // Get color palette
  const palette = getColorPalette(theme, academicStyle)
  
  // Build datasets with colors
  const datasets = (data.datasets || []).map((ds, idx) => ({
    ...ds,
    backgroundColor: ds.backgroundColor || getColorWithOpacity(palette[idx % palette.length], chartType),
    borderColor: ds.borderColor || palette[idx % palette.length],
    borderWidth: ds.borderWidth ?? ACADEMIC_DEFAULTS.borderWidth,
    fill: ds.fill ?? (chartType === 'area' || chartType === 'radar')
  }))

  // Build chart options
  const options = buildChartOptions(chartType, title, theme, academicStyle)

  return {
    type: normalizeChartType(chartType),
    data: {
      labels: data.labels || [],
      datasets
    },
    options
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function deepMergeChartOptions(base: any, override: any): any {
  if (!isPlainObject(base)) return override
  if (!isPlainObject(override)) return base

  const merged: Record<string, any> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeChartOptions(merged[key], value)
    } else {
      merged[key] = value
    }
  }
  return merged
}

function mergeChartDatasets(baseDatasets: ChartDataset[], overrideDatasets?: ChartDataset[]): ChartDataset[] {
  if (!overrideDatasets?.length) return baseDatasets

  return overrideDatasets.map((dataset, index) => ({
    ...(baseDatasets[index] || {}),
    ...dataset
  }))
}

function normalizeConfigType(type: string | undefined): DataChartType {
  const validTypes: DataChartType[] = ['bar', 'horizontalBar', 'line', 'scatter', 'pie', 'doughnut', 'radar', 'polarArea', 'bubble', 'area']
  if (type && validTypes.includes(type as DataChartType)) {
    return type as DataChartType
  }
  return 'bar'
}

export function buildAcademicChartConfig(
  config: QuickChartConfig,
  options?: {
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): QuickChartConfig {
  const chartType = normalizeConfigType(config?.type)
  const baseConfig = buildChartConfig(
    chartType,
    {
      labels: config?.data?.labels || [],
      datasets: config?.data?.datasets || []
    },
    options?.title,
    options?.theme,
    options?.academicStyle
  )

  const merged: QuickChartConfig = {
    ...baseConfig,
    ...config,
    type: normalizeChartType(chartType),
    data: {
      labels: config?.data?.labels || baseConfig.data.labels,
      datasets: mergeChartDatasets(baseConfig.data.datasets, config?.data?.datasets)
    },
    options: deepMergeChartOptions(baseConfig.options || {}, config?.options || {})
  }

  if (['pie', 'doughnut', 'radar', 'polarArea'].includes(merged.type) && merged.options?.scales) {
    delete merged.options.scales
  }

  return merged
}

/**
 * Normalizes chart type for QuickChart API.
 */
function normalizeChartType(type: DataChartType): DataChartType {
  const typeMap: Record<DataChartType, DataChartType> = {
    bar: 'bar',
    horizontalBar: 'horizontalBar',
    line: 'line',
    scatter: 'scatter',
    pie: 'pie',
    doughnut: 'doughnut',
    radar: 'radar',
    polarArea: 'polarArea',
    bubble: 'bubble',
    area: 'line' // Line with fill
  }
  return typeMap[type] || type
}

/**
 * Gets color palette based on theme and academic style.
 */
function getColorPalette(
  theme?: FigureTheme,
  academicStyle?: AcademicFigureStyle
): string[] {
  // If explicit colors provided
  if (theme?.secondaryColors?.length) {
    return [theme.primaryColor || '#4E79A7', ...theme.secondaryColors]
  }

  // Journal-specific palettes
  if (academicStyle?.journalStyle) {
    const journalPalettes: Record<string, keyof typeof ACADEMIC_COLOR_PALETTES> = {
      nature: 'nature',
      ieee: 'ieee',
      elsevier: 'colorblind',
      springer: 'nature',
      acs: 'viridis',
      apa: 'seaborn'
    }
    const paletteName = journalPalettes[academicStyle.journalStyle]
    if (paletteName) return [...ACADEMIC_COLOR_PALETTES[paletteName]]
  }

  // Grayscale mode
  if (academicStyle?.colorMode === 'grayscale') {
    return [...ACADEMIC_COLOR_PALETTES.grayscale]
  }

  // Theme presets
  if (theme?.preset) {
    const presetPalettes: Record<string, string[]> = {
      academic: [...ACADEMIC_COLOR_PALETTES.nature],
      modern: ['#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#16A34A'],
      minimal: ['#1F2937', '#4B5563', '#9CA3AF', '#D1D5DB'],
      colorful: [...ACADEMIC_COLOR_PALETTES.seaborn],
      grayscale: [...ACADEMIC_COLOR_PALETTES.grayscale]
    }
    return presetPalettes[theme.preset] || [...ACADEMIC_COLOR_PALETTES.nature]
  }

  // Default: Nature-style palette (colorblind-friendly)
  return [...ACADEMIC_COLOR_PALETTES.colorblind]
}

/**
 * Gets color with appropriate opacity for chart type.
 */
function getColorWithOpacity(color: string, chartType: DataChartType): string {
  // These chart types look better with semi-transparent fills
  const needsOpacity = ['bar', 'area', 'radar', 'polarArea']
  
  if (needsOpacity.includes(chartType)) {
    // Convert hex to rgba with 0.7 opacity
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, 0.7)`
    }
  }
  
  return color
}

/**
 * Builds chart options for academic-quality output.
 */
function buildChartOptions(
  chartType: DataChartType,
  title?: string,
  theme?: FigureTheme,
  academicStyle?: AcademicFigureStyle
): any {
  const fontFamily = theme?.fontFamily || ACADEMIC_DEFAULTS.fontFamily
  const textColor = theme?.textColor || '#1F2937'
  const gridColor = theme?.gridColor || '#E5E7EB'

  const isPieType = ['pie', 'doughnut', 'polarArea'].includes(chartType)

  const baseOptions: any = {
    responsive: true,
    maintainAspectRatio: true,
    layout: {
      padding: { top: 4, right: 8, bottom: 4, left: 8 }
    },
    plugins: {
      title: {
        display: !!title,
        text: title || '',
        font: {
          family: fontFamily,
          size: theme?.titleFontSize || ACADEMIC_DEFAULTS.titleFontSize,
          weight: 'bold'
        },
        color: textColor,
        padding: { top: 6, bottom: 14 }
      },
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          font: {
            family: fontFamily,
            size: theme?.labelFontSize || ACADEMIC_DEFAULTS.legendFontSize
          },
          color: textColor,
          usePointStyle: true,
          padding: 12,
          boxWidth: 10
        }
      },
      tooltip: {
        enabled: false
      },
      // Data labels for pie/doughnut
      ...(isPieType ? {
        datalabels: {
          display: true,
          color: '#1F2937',
          font: { family: fontFamily, size: ACADEMIC_DEFAULTS.tickFontSize, weight: 'bold' },
          formatter: (value: number, context: any) => {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0)
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0'
            return `${pct}%`
          }
        }
      } : {})
    }
  }

  // Add scales for appropriate chart types
  const needsScales = ['bar', 'horizontalBar', 'line', 'scatter', 'area', 'bubble']
  if (needsScales.includes(chartType)) {
    baseOptions.scales = {
      x: {
        grid: {
          color: gridColor,
          lineWidth: ACADEMIC_DEFAULTS.gridLineWidth,
          drawBorder: true
        },
        ticks: {
          font: {
            family: fontFamily,
            size: ACADEMIC_DEFAULTS.tickFontSize
          },
          color: textColor
        },
        title: {
          display: false,
          font: {
            family: fontFamily,
            size: ACADEMIC_DEFAULTS.labelFontSize
          }
        }
      },
      y: {
        grid: {
          color: gridColor,
          lineWidth: ACADEMIC_DEFAULTS.gridLineWidth,
          drawBorder: true
        },
        ticks: {
          font: {
            family: fontFamily,
            size: ACADEMIC_DEFAULTS.tickFontSize
          },
          color: textColor
        },
        title: {
          display: false,
          font: {
            family: fontFamily,
            size: ACADEMIC_DEFAULTS.labelFontSize
          }
        },
        beginAtZero: chartType === 'bar'
      }
    }
  }

  return baseOptions
}

// ============================================================================
// Chart Generation
// ============================================================================

/**
 * Generates a chart using QuickChart.io API.
 */
export async function generateChart(
  chartType: DataChartType,
  data: FigureData,
  options?: {
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    width?: number
    height?: number
    format?: 'png' | 'svg' | 'webp'
    backgroundColor?: string
  }
): Promise<FigureGenerationResult> {
  const config = buildChartConfig(
    chartType,
    data,
    options?.title,
    options?.theme,
    options?.academicStyle
  )

  return generateChartFromConfig(config, options)
}

export async function generateChartFromConfig(
  config: QuickChartConfig,
  options?: {
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    width?: number
    height?: number
    format?: 'png' | 'svg' | 'webp'
    backgroundColor?: string
  }
): Promise<FigureGenerationResult> {
  const startTime = Date.now()

  try {
    if (!config?.data?.labels?.length && !config?.data?.datasets?.length) {
      return {
        success: false,
        error: 'No data provided for chart generation',
        errorCode: 'INVALID_DATA',
        provider: 'quickchart'
      }
    }

    const finalConfig = buildAcademicChartConfig(config, options)
    const chartType = normalizeConfigType(finalConfig.type)
    const dimensions = getDimensions(chartType, options?.academicStyle)
    const width = options?.width || dimensions.width
    const height = options?.height || dimensions.height
    const format = options?.format || 'png'

    console.log(`[QuickChart] Generating ${chartType} chart: ${width}x${height} ${format}`)

    const configJson = JSON.stringify(finalConfig)
    const usePost = configJson.length > 1500

    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const dpr = ACADEMIC_DEFAULTS.devicePixelRatio

      if (usePost) {
        response = await fetch(`${QUICKCHART_BASE_URL}/chart`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': format === 'svg' ? 'image/svg+xml' : `image/${format}`
          },
          body: JSON.stringify({
            chart: finalConfig,
            width,
            height,
            format,
            backgroundColor: options?.backgroundColor || '#FFFFFF',
            devicePixelRatio: dpr
          }),
          signal: controller.signal
        })
      } else {
        const chartUrl = buildChartUrl(finalConfig, {
          width,
          height,
          format,
          backgroundColor: options?.backgroundColor || '#FFFFFF',
          devicePixelRatio: dpr
        })
        response = await fetch(chartUrl, {
          method: 'GET',
          headers: {
            'Accept': format === 'svg' ? 'image/svg+xml' : `image/${format}`
          },
          signal: controller.signal
        })
      }
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      console.error('[QuickChart] API error:', response.status, errorText)
      return {
        success: false,
        error: `QuickChart API error: ${response.status}`,
        errorCode: 'API_ERROR',
        provider: 'quickchart'
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const imageBase64 = buffer.toString('base64')
    const duration = Date.now() - startTime
    console.log(`[QuickChart] Chart generated in ${duration}ms, size: ${buffer.length} bytes`)

    return {
      success: true,
      imageBase64,
      format,
      width,
      height,
      fileSize: buffer.length,
      provider: 'quickchart',
      apiCallDuration: duration,
      generatedCode: JSON.stringify(finalConfig, null, 2)
    }
  } catch (error) {
    console.error('[QuickChart] Generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Chart generation failed',
      errorCode: 'RENDERING_FAILED',
      provider: 'quickchart',
      apiCallDuration: Date.now() - startTime
    }
  }
}

/**
 * Builds the QuickChart URL with all parameters.
 */
function buildChartUrl(
  config: QuickChartConfig,
  options: {
    width: number
    height: number
    format: string
    backgroundColor: string
    devicePixelRatio: number
  }
): string {
  const params = new URLSearchParams({
    c: JSON.stringify(config),
    w: options.width.toString(),
    h: options.height.toString(),
    f: options.format,
    bkg: options.backgroundColor,
    devicePixelRatio: options.devicePixelRatio.toString()
  })

  // Add API key if available
  if (QUICKCHART_API_KEY) {
    params.set('key', QUICKCHART_API_KEY)
  }

  return `${QUICKCHART_BASE_URL}/chart?${params.toString()}`
}

/**
 * Gets appropriate dimensions based on chart type and academic style.
 */
function getDimensions(
  chartType: DataChartType,
  academicStyle?: AcademicFigureStyle
): { width: number; height: number } {
  // Journal-specific sizing
  if (academicStyle?.singleColumn) {
    return FIGURE_DIMENSIONS.singleColumn
  }

  // Chart-specific defaults
  const chartDimensions: Partial<Record<DataChartType, { width: number; height: number }>> = {
    pie: FIGURE_DIMENSIONS.square,
    doughnut: FIGURE_DIMENSIONS.square,
    radar: FIGURE_DIMENSIONS.square,
    polarArea: FIGURE_DIMENSIONS.square,
    horizontalBar: { width: 1200, height: 800 }
  }

  return chartDimensions[chartType] || FIGURE_DIMENSIONS.singleColumn
}

// ============================================================================
// Convenience Functions for Common Chart Types
// ============================================================================

/**
 * Generate a bar chart with academic styling.
 */
export async function generateBarChart(
  labels: string[],
  datasets: Array<{ label: string; data: number[] }>,
  options?: {
    title?: string
    horizontal?: boolean
    stacked?: boolean
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): Promise<FigureGenerationResult> {
  const data: FigureData = {
    labels,
    datasets: datasets.map(ds => ({
      label: ds.label,
      data: ds.data
    }))
  }

  return generateChart(
    options?.horizontal ? 'horizontalBar' : 'bar',
    data,
    {
      title: options?.title,
      theme: options?.theme,
      academicStyle: options?.academicStyle
    }
  )
}

/**
 * Generate a line chart with academic styling.
 */
export async function generateLineChart(
  labels: string[],
  datasets: Array<{ label: string; data: number[] }>,
  options?: {
    title?: string
    fill?: boolean
    smooth?: boolean
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): Promise<FigureGenerationResult> {
  const data: FigureData = {
    labels,
    datasets: datasets.map(ds => ({
      label: ds.label,
      data: ds.data,
      fill: options?.fill ?? false
    }))
  }

  return generateChart(
    options?.fill ? 'area' : 'line',
    data,
    {
      title: options?.title,
      theme: options?.theme,
      academicStyle: options?.academicStyle
    }
  )
}

/**
 * Generate a scatter plot with academic styling.
 */
export async function generateScatterPlot(
  datasets: Array<{ label: string; data: Array<{ x: number; y: number }> }>,
  options?: {
    title?: string
    xLabel?: string
    yLabel?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): Promise<FigureGenerationResult> {
  const data: FigureData = {
    datasets: datasets.map(ds => ({
      label: ds.label,
      data: ds.data as any
    }))
  }

  return generateChart('scatter', data, {
    title: options?.title,
    theme: options?.theme,
    academicStyle: options?.academicStyle
  })
}

/**
 * Generate a pie chart with academic styling.
 */
export async function generatePieChart(
  labels: string[],
  values: number[],
  options?: {
    title?: string
    doughnut?: boolean
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): Promise<FigureGenerationResult> {
  const data: FigureData = {
    labels,
    datasets: [{
      label: 'Values',
      data: values
    }]
  }

  return generateChart(
    options?.doughnut ? 'doughnut' : 'pie',
    data,
    {
      title: options?.title,
      theme: options?.theme,
      academicStyle: options?.academicStyle
    }
  )
}

/**
 * Generate a radar chart with academic styling.
 */
export async function generateRadarChart(
  labels: string[],
  datasets: Array<{ label: string; data: number[] }>,
  options?: {
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): Promise<FigureGenerationResult> {
  const data: FigureData = {
    labels,
    datasets: datasets.map(ds => ({
      label: ds.label,
      data: ds.data,
      fill: true
    }))
  }

  return generateChart('radar', data, {
    title: options?.title,
    theme: options?.theme,
    academicStyle: options?.academicStyle
  })
}

// ============================================================================
// AI-Assisted Chart Generation
// ============================================================================

/**
 * Generates chart configuration from natural language description.
 * Uses LLM to parse data and determine appropriate chart type.
 */
export interface AIChartRequest {
  description: string
  data?: string | FigureData
  preferredType?: DataChartType
}

/**
 * Parses chart request from natural language and generates the chart.
 * This function is designed to be called after an LLM processes the request.
 */
export async function generateChartFromDescription(
  parsedConfig: {
    chartType: DataChartType
    title: string
    labels: string[]
    datasets: Array<{ label: string; data: number[] }>
  },
  options?: {
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): Promise<FigureGenerationResult> {
  return generateChart(
    parsedConfig.chartType,
    {
      labels: parsedConfig.labels,
      datasets: parsedConfig.datasets
    },
    {
      title: parsedConfig.title,
      ...options
    }
  )
}

