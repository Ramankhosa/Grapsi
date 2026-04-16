/**
 * Figure Generation Service - Main Entry Point
 * 
 * Unified API for generating all types of academic figures:
 * - Data charts (via QuickChart.io)
 * - Diagrams (via Mermaid/Kroki, PlantUML)
 * - Statistical plots (via Python execution)
 * - Illustrations (via AI image generation)
 * 
 * Usage:
 * ```ts
 * import { generateFigure, suggestFigures } from '@/lib/figure-generation'
 * 
 * // Generate a bar chart
 * const result = await generateFigure({
 *   category: 'DATA_CHART',
 *   chartType: 'bar',
 *   title: 'Results Comparison',
 *   data: {
 *     labels: ['A', 'B', 'C'],
 *     datasets: [{ label: 'Group 1', data: [10, 20, 30] }]
 *   }
 * })
 * 
 * // Generate a flowchart
 * const diagram = await generateFigure({
 *   category: 'DIAGRAM',
 *   diagramType: 'flowchart',
 *   code: 'A --> B --> C'
 * })
 * ```
 */

// Re-export types
export * from './types'

// Re-export composite figure service
export {
  composeMultiPanelFigure,
  saveCompositeFigure
} from './composite-figure-service'
export type { CompositeLayout, SubFigure, CompositeResult } from './composite-figure-service'

// Re-export Python chart service
export { generatePythonChart, isPythonChartServerHealthy } from './python-chart-service'
export type { PythonPlotType, PythonChartSpec } from './python-chart-service'

// Re-export service functions
export {
  generateChart,
  generateChartFromConfig,
  generateBarChart,
  generateLineChart,
  generateScatterPlot,
  generatePieChart,
  generateRadarChart,
  generateChartFromDescription,
  buildChartConfig
} from './quickchart-service'

export {
  generateMermaidDiagram,
  generatePlantUMLDiagram,
  generateFlowchart,
  generateSequenceDiagram,
  generateClassDiagram,
  generateERDiagram,
  generateGanttChart,
  generateStateDiagram,
  generateFromMermaidCode,
  generateFromPlantUMLCode
} from './mermaid-service'

import {
  FigureGenerationRequest,
  FigureGenerationResult,
  FigureCategory,
  FigureSuggestion,
  FigurePlan,
  DataChartType,
  DiagramType,
  FigureData
} from './types'

import {
  generateChart,
  generateBarChart,
  generateLineChart,
  generatePieChart
} from './quickchart-service'

import {
  generateMermaidDiagram,
  generatePlantUMLDiagram,
  generateFromMermaidCode
} from './mermaid-service'

// ============================================================================
// Unified Figure Generation
// ============================================================================

/**
 * Main entry point for generating any type of figure.
 * Routes to the appropriate service based on figure category.
 */
export async function generateFigure(
  request: FigureGenerationRequest
): Promise<FigureGenerationResult> {
  console.log(`[FigureService] Generating ${request.category} figure: ${request.title}`)
  
  const startTime = Date.now()
  
  try {
    switch (request.category) {
      case 'DATA_CHART':
        return await generateDataChart(request)
      
      case 'DIAGRAM':
        return await generateDiagram(request)
      
      case 'STATISTICAL_PLOT':
        return await generateStatisticalPlot(request)
      
      case 'ILLUSTRATED_FIGURE':
        return await generateIllustration(request)

      case 'ILLUSTRATION':
        return await generateIllustration(request)
      
      case 'TABLE':
        return await generateTable(request)
      
      case 'EQUATION':
        return await generateEquation(request)
      
      case 'CUSTOM':
        return {
          success: false,
          error: 'Custom figures require manual upload',
          errorCode: 'UNSUPPORTED_TYPE'
        }
      
      default:
        return {
          success: false,
          error: `Unknown figure category: ${request.category}`,
          errorCode: 'UNSUPPORTED_TYPE'
        }
    }
  } catch (error) {
    console.error('[FigureService] Generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Figure generation failed',
      errorCode: 'RENDERING_FAILED',
      apiCallDuration: Date.now() - startTime
    }
  }
}

/**
 * Generates a data chart using QuickChart.io.
 */
async function generateDataChart(
  request: FigureGenerationRequest
): Promise<FigureGenerationResult> {
  if (!request.chartType) {
    return { success: false, error: 'Chart type is required', errorCode: 'INVALID_DATA' }
  }
  
  if (!request.data) {
    return { success: false, error: 'Data is required for charts', errorCode: 'INVALID_DATA' }
  }

  return generateChart(
    request.chartType,
    request.data,
    {
      title: request.title,
      theme: request.theme,
      academicStyle: request.academicStyle,
      width: request.width,
      height: request.height,
      format: request.outputFormat as 'png' | 'svg'
    }
  )
}

/**
 * Generates a diagram using Mermaid or PlantUML.
 */
async function generateDiagram(
  request: FigureGenerationRequest
): Promise<FigureGenerationResult> {
  if (!request.code) {
    return { success: false, error: 'Diagram code is required', errorCode: 'INVALID_DATA' }
  }

  // PlantUML diagrams
  if (request.diagramType === 'plantuml' || request.code.includes('@startuml')) {
    return generatePlantUMLDiagram(request.code, {
      format: (request.outputFormat as 'png' | 'svg') || 'svg'
    })
  }

  // Mermaid diagrams
  return generateFromMermaidCode(request.code, {
    theme: request.theme,
    academicStyle: request.academicStyle,
    format: (request.outputFormat as 'png' | 'svg') || 'svg'
  })
}

/**
 * Generates a publication-grade statistical plot using the Python matplotlib server.
 * Generic QuickChart fallback is intentionally disabled.
 */
async function generateStatisticalPlot(
  request: FigureGenerationRequest
): Promise<FigureGenerationResult> {
  if (!request.data && !request.code) {
    return { success: false, error: 'Data or code is required for statistical plots', errorCode: 'INVALID_DATA' }
  }

  const {
    isPythonChartServerHealthy,
    generatePythonChart,
    figureDataToPythonSpec,
    isPublicationGradePythonPlotType,
    PUBLICATION_GRADE_PYTHON_PLOT_TYPES
  } = await import('./python-chart-service')

  if (!request.plotType || !isPublicationGradePythonPlotType(request.plotType)) {
    return {
      success: false,
      error: `No publication-grade statistical renderer is configured for '${request.plotType}'. Supported plot types: ${PUBLICATION_GRADE_PYTHON_PLOT_TYPES.join(', ')}.`,
      errorCode: 'UNSUPPORTED_TYPE'
    }
  }

  const healthy = await isPythonChartServerHealthy()
  if (!healthy) {
    return {
      success: false,
      error: 'Python chart server is unavailable. Start the docker/python-charts service to render publication-grade statistical plots.',
      errorCode: 'API_ERROR'
    }
  }

  const spec = figureDataToPythonSpec(
    request.plotType,
    request.data,
    { title: request.title, xAxisLabel: undefined, yAxisLabel: undefined }
  )
  if (spec) {
    return generatePythonChart(spec)
  }

  return {
    success: false,
    error: `Invalid data shape for statistical plot type '${request.plotType}'. Provide the exact structured payload required by the Python renderer.`,
    errorCode: 'INVALID_DATA'
  }
}

/**
 * Generates an illustration using AI image generation.
 * Delegates to the existing sketch service.
 */
async function generateIllustration(
  request: FigureGenerationRequest
): Promise<FigureGenerationResult> {
  if (!request.prompt) {
    return { success: false, error: 'Prompt is required for illustrations', errorCode: 'INVALID_DATA' }
  }

  // TODO: Integrate with sketch-service for AI illustration generation
  // For now, return a helpful error message
  return {
    success: false,
    error: 'AI illustration generation is available through the Sketch service. Use the Figure Planner UI for AI-generated figures.',
    errorCode: 'UNSUPPORTED_TYPE'
  }
}

/**
 * Generates a table figure.
 * Creates an HTML/image representation of tabular data.
 */
async function generateTable(
  request: FigureGenerationRequest
): Promise<FigureGenerationResult> {
  if (!request.data?.headers || !request.data?.rows) {
    return { success: false, error: 'Table requires headers and rows', errorCode: 'INVALID_DATA' }
  }

  // TODO: Implement table rendering (via HTML-to-image or LaTeX)
  return {
    success: false,
    error: 'Table figure generation not yet implemented. Export tables directly in the paper export.',
    errorCode: 'UNSUPPORTED_TYPE'
  }
}

/**
 * Generates an equation figure.
 * Renders LaTeX math equations as images.
 */
async function generateEquation(
  request: FigureGenerationRequest
): Promise<FigureGenerationResult> {
  if (!request.code) {
    return { success: false, error: 'LaTeX code is required for equations', errorCode: 'INVALID_DATA' }
  }

  // TODO: Implement equation rendering (via KaTeX/MathJax)
  return {
    success: false,
    error: 'Equation figure generation not yet implemented. Use LaTeX directly in the paper.',
    errorCode: 'UNSUPPORTED_TYPE'
  }
}

// ============================================================================
// AI-Powered Figure Suggestions
// ============================================================================

/**
 * Analyzes paper content and suggests appropriate figures.
 * This should be called with context from the paper drafting session.
 */
export async function suggestFigures(
  paperContext: {
    title: string
    abstract?: string
    sections?: Record<string, string>
    researchType?: string
    dataDescription?: string
  }
): Promise<FigurePlan> {
  // Default suggestions based on paper type
  const suggestions: FigureSuggestion[] = []
  
  // Always suggest a methodology diagram
  suggestions.push({
    title: 'Research Methodology Overview',
    description: 'A flowchart showing the research methodology and process flow',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: 'methodology',
    importance: 'recommended'
  })
  
  // Suggest results visualization if data is mentioned
  if (paperContext.dataDescription || paperContext.sections?.results) {
    suggestions.push({
      title: 'Results Comparison',
      description: 'A bar or line chart comparing key results',
      category: 'DATA_CHART',
      suggestedType: 'bar',
      relevantSection: 'results',
      importance: 'recommended'
    })
  }
  
  // Suggest system architecture for technical papers
  if (paperContext.researchType === 'technical' || 
      paperContext.abstract?.toLowerCase().includes('system') ||
      paperContext.abstract?.toLowerCase().includes('architecture')) {
    suggestions.push({
      title: 'System Architecture',
      description: 'A diagram showing the system components and their relationships',
      category: 'DIAGRAM',
      suggestedType: 'architecture',
      relevantSection: 'methodology',
      importance: 'recommended'
    })
  }
  
  // Count by category
  const byCategory: Record<FigureCategory, number> = {
    DATA_CHART: 0,
    DIAGRAM: 0,
    STATISTICAL_PLOT: 0,
    ILLUSTRATED_FIGURE: 0,
    ILLUSTRATION: 0,
    SKETCH: 0,
    TABLE: 0,
    EQUATION: 0,
    CUSTOM: 0
  }
  
  suggestions.forEach(s => {
    byCategory[s.category]++
  })

  return {
    suggestions,
    totalFigures: suggestions.length,
    byCategory,
    estimatedGenerationTime: suggestions.length * 5 // ~5 seconds per figure
  }
}

// ============================================================================
// Quick Generate Functions for Common Use Cases
// ============================================================================

/**
 * Quickly generate a comparison bar chart.
 */
export async function quickBarChart(
  title: string,
  labels: string[],
  data: number[],
  datasetLabel?: string
): Promise<FigureGenerationResult> {
  return generateBarChart(
    labels,
    [{ label: datasetLabel || 'Values', data }],
    { title, theme: { preset: 'academic' } }
  )
}

/**
 * Quickly generate a trend line chart.
 */
export async function quickLineChart(
  title: string,
  labels: string[],
  data: number[],
  datasetLabel?: string
): Promise<FigureGenerationResult> {
  return generateLineChart(
    labels,
    [{ label: datasetLabel || 'Values', data }],
    { title, theme: { preset: 'academic' } }
  )
}

/**
 * Quickly generate a distribution pie chart.
 */
export async function quickPieChart(
  title: string,
  labels: string[],
  values: number[]
): Promise<FigureGenerationResult> {
  return generatePieChart(labels, values, { title, theme: { preset: 'academic' } })
}

/**
 * Quickly generate a simple flowchart from text description.
 * Format: "A -> B -> C" or "A --> B --> C"
 */
export async function quickFlowchart(
  title: string,
  steps: string[]
): Promise<FigureGenerationResult> {
  // Limit steps to prevent overly complex diagrams
  const maxSteps = 50
  const limitedSteps = steps.slice(0, maxSteps)
  
  // Generate node IDs that work for any number of steps
  const getNodeId = (index: number): string => {
    if (index < 26) return String.fromCharCode(65 + index) // A-Z
    return `N${index}` // N26, N27, etc. for more than 26 nodes
  }
  
  // Build simple flowchart code
  const nodes = limitedSteps.map((step, i) => `    ${getNodeId(i)}[${step}]`).join('\n')
  const edges = limitedSteps.slice(0, -1).map((_, i) => 
    `    ${getNodeId(i)} --> ${getNodeId(i + 1)}`
  ).join('\n')
  
  const code = `flowchart TD\n${nodes}\n${edges}`
  
  return generateFromMermaidCode(code, { theme: { preset: 'academic' } })
}

// ============================================================================
// Figure Storage Integration
// ============================================================================

import { prisma } from '@/lib/prisma'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

const FIGURE_UPLOAD_DIR = 'public/uploads/figures'

/**
 * Saves a generated figure to disk and creates a database record.
 */
export async function saveFigure(
  result: FigureGenerationResult,
  metadata: {
    paperId?: string
    sessionId?: string
    figureNumber: number
    title: string
    caption?: string
    category: FigureCategory
    subType?: string
  }
): Promise<{ figureId: string; imageUrl: string } | { error: string }> {
  if (!result.success || !result.imageBase64) {
    return { error: result.error || 'No image data to save' }
  }

  // Validate required sessionId for database record
  if (!metadata.sessionId) {
    return { error: 'sessionId is required to save figure' }
  }

  try {
    // Use absolute path for reliable file operations
    const uploadDir = path.join(process.cwd(), FIGURE_UPLOAD_DIR)
    
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true })

    // Generate filename with sanitized figureNumber
    const format = result.format || 'png'
    const timestamp = Date.now()
    const safeNumber = Math.max(1, Math.min(9999, metadata.figureNumber))
    const filename = `figure_${safeNumber}_${timestamp}.${format}`
    const filePath = path.join(uploadDir, filename)

    // Save image to disk
    const buffer = Buffer.from(result.imageBase64, 'base64')
    
    // Check file size (max 10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      return { error: 'Generated image exceeds 10MB size limit' }
    }
    
    await fs.writeFile(filePath, buffer)

    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex')

    // Create database record
    // NOTE: imagePath and other metadata stored in nodes JSON (schema doesn't have dedicated fields)
    const figureRecord = await prisma.figurePlan.create({
      data: {
        sessionId: metadata.sessionId,
        figureNo: metadata.figureNumber,
        title: metadata.title,
        description: metadata.caption || '',
        nodes: {
          category: metadata.category,
          subType: metadata.subType,
          imagePath: `/uploads/figures/${filename}`,
          isAiGenerated: true,
          format: format,
          checksum: checksum,
          generatedCode: result.generatedCode,
          provider: result.provider,
          apiCallDuration: result.apiCallDuration,
          fileSize: buffer.length,
          width: result.width,
          height: result.height,
          status: 'GENERATED'
        },
        edges: []
      }
    })

    console.log(`[FigureService] Saved figure: ${filename} (${buffer.length} bytes)`)

    return {
      figureId: figureRecord.id,
      imageUrl: `/uploads/figures/${filename}`
    }
  } catch (error) {
    console.error('[FigureService] Failed to save figure:', error)
    return { error: error instanceof Error ? error.message : 'Failed to save figure' }
  }
}

