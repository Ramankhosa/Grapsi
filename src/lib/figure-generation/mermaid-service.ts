/**
 * Mermaid & Kroki Diagram Service
 * 
 * Generates diagrams using Mermaid syntax rendered via Kroki.io or local server.
 * Also supports PlantUML, GraphViz, and other diagram types through Kroki.
 * 
 * Supported Diagram Types:
 * - Flowchart (mermaid)
 * - Sequence diagram (mermaid, plantuml)
 * - Class diagram (mermaid, plantuml)
 * - State diagram (mermaid, plantuml)
 * - Entity-Relationship (mermaid)
 * - Gantt chart (mermaid)
 * - Mindmap (plantuml)
 * - Timeline (mermaid)
 * 
 * API: https://kroki.io/ (free, open source)
 */

import {
  DiagramType,
  FigureGenerationResult,
  FigureTheme,
  AcademicFigureStyle,
  MermaidConfig,
  KrokiRequest,
  FIGURE_DIMENSIONS
} from './types'
import crypto from 'crypto'

// ============================================================================
// Configuration
// ============================================================================

const KROKI_BASE_URL = process.env.KROKI_BASE_URL || 'https://kroki.io'
const PLANTUML_BASE_URL = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12)
}

// ============================================================================
// Mermaid Code Templates
// ============================================================================

/**
 * Builds Mermaid code header with theme configuration.
 */
function buildMermaidHeader(theme?: FigureTheme, academicStyle?: AcademicFigureStyle): string {
  // Determine theme based on style
  let mermaidTheme = 'default'
  
  if (theme?.preset === 'minimal' || academicStyle?.colorMode === 'grayscale') {
    mermaidTheme = 'neutral'
  } else if (theme?.preset === 'modern') {
    mermaidTheme = 'dark'
  }

  return `%%{init: {'theme': '${mermaidTheme}', 'themeVariables': { 'fontSize': '14px' }}}%%`
}

/**
 * Converts diagram type to Mermaid diagram declaration.
 */
function getMermaidDiagramType(type: DiagramType): string {
  const typeMap: Record<DiagramType, string> = {
    flowchart: 'flowchart TD',
    sequence: 'sequenceDiagram',
    class: 'classDiagram',
    activity: 'flowchart TD',
    component: 'flowchart LR',
    usecase: 'flowchart LR',
    state: 'stateDiagram-v2',
    er: 'erDiagram',
    gantt: 'gantt',
    mindmap: 'mindmap',
    timeline: 'timeline',
    architecture: 'flowchart LR',
    plantuml: '' // Not mermaid
  }
  return typeMap[type] || 'flowchart TD'
}

function splitMermaidPreamble(code: string): { preamble: string; body: string } {
  const trimmed = code.trim()
  const lines = trimmed.split('\n')
  const preambleLines: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      if (preambleLines.length > 0) {
        preambleLines.push(lines[index])
        index += 1
        continue
      }
      break
    }
    if (line.startsWith('%%{') || line.startsWith('%%')) {
      preambleLines.push(lines[index])
      index += 1
      continue
    }
    break
  }

  return {
    preamble: preambleLines.join('\n').trim(),
    body: lines.slice(index).join('\n').trim()
  }
}

export function hasMermaidDiagramDeclaration(code: string): boolean {
  const { body } = splitMermaidPreamble(code)
  return /^(flowchart\b|graph\s+(?:TD|TB|BT|RL|LR)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|mindmap\b|timeline\b)/.test(body)
}

export function buildFullMermaidCode(
  config: MermaidConfig,
  options?: {
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
  }
): string {
  const header = buildMermaidHeader(options?.theme, options?.academicStyle)
  const diagramDeclaration = getMermaidDiagramType(config.diagramType)
  const rawCode = config.code.trim()

  if (hasMermaidDiagramDeclaration(rawCode)) {
    return config.code
  }

  const { preamble, body } = splitMermaidPreamble(rawCode)
  const prefix = preamble || header

  return [prefix, diagramDeclaration, body].filter(Boolean).join('\n')
}

// ============================================================================
// Kroki API Integration
// ============================================================================

/**
 * Encodes diagram source for Kroki API.
 * Uses deflate compression and base64 encoding.
 */
async function encodeForKroki(source: string): Promise<string> {
  try {
    // Use pako for deflate compression in Node.js
    const pako = require('pako')
    const compressed = pako.deflate(source, { level: 9 })
    
    // Convert to URL-safe base64
    const base64 = Buffer.from(compressed)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    
    return base64
  } catch (error) {
    // Fallback: use simple base64 encoding if pako is not available
    // Kroki accepts both compressed and uncompressed payloads
    console.warn('[Mermaid] pako not available, using uncompressed encoding')
    return Buffer.from(source)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
}

/**
 * Gets Kroki diagram type from our internal type.
 */
function getKrokiDiagramType(type: DiagramType): string {
  const typeMap: Record<DiagramType, string> = {
    flowchart: 'mermaid',
    sequence: 'mermaid',
    class: 'mermaid',
    activity: 'mermaid',
    component: 'mermaid',
    usecase: 'mermaid',
    state: 'mermaid',
    er: 'mermaid',
    gantt: 'mermaid',
    mindmap: 'plantuml', // Mermaid mindmap support is limited
    timeline: 'mermaid',
    architecture: 'mermaid',
    plantuml: 'plantuml'
  }
  return typeMap[type] || 'mermaid'
}

/**
 * Clean PlantUML code from LLM artifacts
 */
function cleanPlantUMLCode(rawCode: string): string {
  let code = rawCode.trim()
  
  // Remove markdown code block wrappers
  const plantUMLBlockMatch = code.match(/```(?:plantuml|puml)?\s*\n([\s\S]*?)```/i)
  if (plantUMLBlockMatch) {
    code = plantUMLBlockMatch[1].trim()
  }
  
  // Ensure it starts with @startuml
  if (!code.includes('@startuml')) {
    code = '@startuml\n' + code
  }
  
  // Ensure it ends with @enduml
  if (!code.includes('@enduml')) {
    code = code + '\n@enduml'
  }
  
  // Remove duplicate @startuml/@enduml
  code = code.replace(/(@startuml\s*\n)+/g, '@startuml\n')
  code = code.replace(/(\n\s*@enduml)+/g, '\n@enduml')
  
  return code
}

// ============================================================================
// Diagram Generation
// ============================================================================

/**
 * Generates a diagram using Mermaid via Kroki.
 */
export async function generateMermaidDiagram(
  config: MermaidConfig,
  options?: {
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    width?: number
    height?: number
    format?: 'svg' | 'png' | 'pdf'
  }
): Promise<FigureGenerationResult> {
  const startTime = Date.now()
  
  try {
    // Build full Mermaid code with theme
    const fullCode = buildFullMermaidCode(config, options)

    const format = options?.format || 'svg'
    const krokiType = getKrokiDiagramType(config.diagramType)
    const codeHash = shortHash(fullCode)

    console.log(`[DiagramRender] renderer=kroki type=${krokiType} format=${format} codeHash=${codeHash} codeLen=${fullCode.length}`)

    // Encode the diagram source
    const encoded = await encodeForKroki(fullCode)
    
    // Build Kroki URL
    const url = `${KROKI_BASE_URL}/${krokiType}/${format}/${encoded}`

    // Add timeout to prevent hanging on external API
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30 second timeout

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': format === 'svg' ? 'image/svg+xml' : `image/${format}`
        },
        signal: controller.signal
      })
    } catch (fetchError) {
      clearTimeout(timeout)
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return {
          success: false,
          error: 'Diagram generation timed out after 30 seconds',
          errorCode: 'TIMEOUT',
          provider: 'kroki'
        }
      }
      throw fetchError
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      const summary = errorText.slice(0, 400)
      console.error(`[DiagramRender] renderer=kroki type=${krokiType} status=${response.status} codeHash=${codeHash} error=${summary}`)
      return {
        success: false,
        error: `KROKI_RENDER_ERROR status=${response.status} type=${krokiType} codeHash=${codeHash} details=${summary}`,
        errorCode: 'RENDERING_FAILED',
        provider: 'kroki'
      }
    }

    // Get image data
    const buffer = Buffer.from(await response.arrayBuffer())
    const imageBase64 = buffer.toString('base64')

    const duration = Date.now() - startTime
    console.log(`[DiagramRender] success renderer=kroki type=${krokiType} codeHash=${codeHash} durationMs=${duration} size=${buffer.length}`)

    return {
      success: true,
      imageBase64,
      format,
      fileSize: buffer.length,
      provider: 'kroki',
      apiCallDuration: duration,
      generatedCode: fullCode
    }

  } catch (error) {
    console.error('[Mermaid] Generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Diagram generation failed',
      errorCode: 'RENDERING_FAILED',
      provider: 'kroki',
      apiCallDuration: Date.now() - startTime
    }
  }
}

/**
 * Generates a diagram using PlantUML via our existing proxy or Kroki.
 */
export async function generatePlantUMLDiagram(
  rawCode: string,
  options?: {
    format?: 'svg' | 'png'
    useProxy?: boolean
  }
): Promise<FigureGenerationResult> {
  const startTime = Date.now()
  const format = options?.format || 'svg'
  
  // Clean the code first
  const code = cleanPlantUMLCode(rawCode)

  try {
    // Option 1 (opt-in only): use PlantUML proxy/server.
    if (options?.useProxy === true) {
      const proxyResult = await generateViaProxy(code, format)
      if (proxyResult.success) {
        return proxyResult
      }
      console.warn('[PlantUML] Proxy failed, falling back to Kroki')
    }

    // Default renderer: Kroki
    const codeHash = shortHash(code)
    console.log(`[DiagramRender] renderer=kroki type=plantuml format=${format} codeHash=${codeHash} codeLen=${code.length}`)
    
    const encoded = await encodeForKroki(code)
    const url = `${KROKI_BASE_URL}/plantuml/${format}/${encoded}`

    // Add timeout for external API call
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': format === 'svg' ? 'image/svg+xml' : `image/${format}`
        },
        signal: controller.signal
      })
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return {
          success: false,
          error: 'Kroki request timed out after 30 seconds',
          errorCode: 'TIMEOUT',
          provider: 'kroki',
          apiCallDuration: Date.now() - startTime
        }
      }
      throw fetchError
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      const summary = errorText.slice(0, 500)
      console.error(`[DiagramRender] renderer=kroki type=plantuml status=${response.status} codeHash=${codeHash} error=${summary}`)
      return {
        success: false,
        error: `KROKI_RENDER_ERROR status=${response.status} type=plantuml codeHash=${codeHash} details=${summary}`,
        errorCode: 'RENDERING_FAILED',
        provider: 'kroki',
        apiCallDuration: Date.now() - startTime
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const imageBase64 = buffer.toString('base64')

    return {
      success: true,
      imageBase64,
      format,
      fileSize: buffer.length,
      provider: 'kroki',
      apiCallDuration: Date.now() - startTime,
      generatedCode: code
    }

  } catch (error) {
    console.error('[PlantUML] Generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PlantUML generation failed',
      errorCode: 'RENDERING_FAILED',
      provider: 'plantuml',
      apiCallDuration: Date.now() - startTime
    }
  }
}

/**
 * Uses our internal PlantUML proxy for rendering.
 */
async function generateViaProxy(
  code: string,
  format: 'svg' | 'png'
): Promise<FigureGenerationResult> {
  try {
    // This would call our internal API route
    // For now, we'll use the public PlantUML server directly
    let plantumlEncoder: any
    try {
      plantumlEncoder = require('plantuml-encoder')
    } catch {
      return { success: false, error: 'plantuml-encoder not installed', provider: 'plantuml' }
    }
    
    const encoded = plantumlEncoder.encode(code)
    const url = `${PLANTUML_BASE_URL}/${format}/${encoded}`

    // Add timeout for external API call
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    
    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return { success: false, error: 'PlantUML request timed out', provider: 'plantuml' }
      }
      throw fetchError
    } finally {
      clearTimeout(timeout)
    }
    
    if (!response.ok) {
      return { success: false, error: `PlantUML server returned ${response.status}`, provider: 'plantuml' }
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      success: true,
      imageBase64: buffer.toString('base64'),
      format,
      fileSize: buffer.length,
      provider: 'plantuml',
      generatedCode: code
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Proxy failed',
      provider: 'plantuml'
    }
  }
}

// ============================================================================
// Convenience Functions for Common Diagram Types
// ============================================================================

/**
 * Generate a flowchart diagram.
 */
export async function generateFlowchart(
  nodes: Array<{ id: string; label: string; shape?: 'rect' | 'round' | 'diamond' | 'circle' }>,
  edges: Array<{ from: string; to: string; label?: string }>,
  options?: {
    direction?: 'TD' | 'LR' | 'BT' | 'RL'
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    format?: 'svg' | 'png'
  }
): Promise<FigureGenerationResult> {
  const direction = options?.direction || 'TD'
  
  // Build node definitions
  const nodeShapes: Record<string, [string, string]> = {
    rect: ['[', ']'],
    round: ['(', ')'],
    diamond: ['{', '}'],
    circle: ['((', '))']
  }
  
  const nodeDefs = nodes.map(n => {
    const shape = nodeShapes[n.shape || 'rect']
    return `    ${n.id}${shape[0]}${n.label}${shape[1]}`
  }).join('\n')
  
  // Build edge definitions
  const edgeDefs = edges.map(e => {
    const arrow = e.label ? `-->|${e.label}|` : '-->'
    return `    ${e.from} ${arrow} ${e.to}`
  }).join('\n')
  
  const code = `${nodeDefs}\n${edgeDefs}`

  return generateMermaidDiagram(
    {
      diagramType: 'flowchart',
      code: `flowchart ${direction}\n${code}`,
      theme: options?.theme?.preset as any
    },
    {
      theme: options?.theme,
      academicStyle: options?.academicStyle,
      format: options?.format
    }
  )
}

/**
 * Generate a sequence diagram.
 */
export async function generateSequenceDiagram(
  participants: string[],
  messages: Array<{ from: string; to: string; message: string; type?: 'solid' | 'dashed' | 'async' }>,
  options?: {
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    format?: 'svg' | 'png'
  }
): Promise<FigureGenerationResult> {
  // Build participant declarations
  const participantDefs = participants.map(p => `    participant ${p}`).join('\n')
  
  // Build message definitions
  const arrowTypes: Record<string, string> = {
    solid: '->>',
    dashed: '-->>',
    async: '-)'
  }
  
  const messageDefs = messages.map(m => {
    const arrow = arrowTypes[m.type || 'solid']
    return `    ${m.from}${arrow}${m.to}: ${m.message}`
  }).join('\n')
  
  const code = `sequenceDiagram\n${participantDefs}\n${messageDefs}`

  return generateMermaidDiagram(
    {
      diagramType: 'sequence',
      code,
      theme: options?.theme?.preset as any
    },
    {
      theme: options?.theme,
      academicStyle: options?.academicStyle,
      format: options?.format
    }
  )
}

/**
 * Generate a class diagram.
 */
export async function generateClassDiagram(
  classes: Array<{
    name: string
    attributes?: string[]
    methods?: string[]
  }>,
  relationships: Array<{
    from: string
    to: string
    type: 'inheritance' | 'composition' | 'aggregation' | 'association' | 'dependency'
    label?: string
  }>,
  options?: {
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    format?: 'svg' | 'png'
  }
): Promise<FigureGenerationResult> {
  // Build class definitions
  const classDefs = classes.map(c => {
    const lines = [`    class ${c.name} {`]
    if (c.attributes) {
      c.attributes.forEach(a => lines.push(`        ${a}`))
    }
    if (c.methods) {
      c.methods.forEach(m => lines.push(`        ${m}()`))
    }
    lines.push('    }')
    return lines.join('\n')
  }).join('\n')
  
  // Build relationship definitions
  const relationshipArrows: Record<string, string> = {
    inheritance: '<|--',
    composition: '*--',
    aggregation: 'o--',
    association: '--',
    dependency: '..>'
  }
  
  const relationDefs = relationships.map(r => {
    const arrow = relationshipArrows[r.type]
    const label = r.label ? ` : ${r.label}` : ''
    return `    ${r.from} ${arrow} ${r.to}${label}`
  }).join('\n')
  
  const code = `classDiagram\n${classDefs}\n${relationDefs}`

  return generateMermaidDiagram(
    {
      diagramType: 'class',
      code,
      theme: options?.theme?.preset as any
    },
    {
      theme: options?.theme,
      academicStyle: options?.academicStyle,
      format: options?.format
    }
  )
}

/**
 * Generate an ER diagram.
 */
export async function generateERDiagram(
  entities: Array<{
    name: string
    attributes: Array<{ name: string; type: string; key?: 'PK' | 'FK' }>
  }>,
  relationships: Array<{
    from: string
    to: string
    fromCardinality: '||' | '|o' | '}|' | '}o'
    toCardinality: '||' | 'o|' | '|{' | 'o{'
    label: string
  }>,
  options?: {
    title?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    format?: 'svg' | 'png'
  }
): Promise<FigureGenerationResult> {
  // Build entity definitions
  const entityDefs = entities.map(e => {
    const attrLines = e.attributes.map(a => {
      const keyPrefix = a.key ? `${a.key} ` : ''
      return `        ${a.type} ${a.name} ${keyPrefix}`
    }).join('\n')
    return `    ${e.name} {\n${attrLines}\n    }`
  }).join('\n')
  
  // Build relationship definitions
  const relationDefs = relationships.map(r => {
    return `    ${r.from} ${r.fromCardinality}--${r.toCardinality} ${r.to} : ${r.label}`
  }).join('\n')
  
  const code = `erDiagram\n${entityDefs}\n${relationDefs}`

  return generateMermaidDiagram(
    {
      diagramType: 'er',
      code,
      theme: options?.theme?.preset as any
    },
    {
      theme: options?.theme,
      academicStyle: options?.academicStyle,
      format: options?.format
    }
  )
}

/**
 * Generate a Gantt chart.
 */
export async function generateGanttChart(
  title: string,
  sections: Array<{
    name: string
    tasks: Array<{
      name: string
      start: string  // Date string or 'after task1'
      duration: string  // e.g., '3d', '1w'
      id?: string
      status?: 'done' | 'active' | 'crit'
    }>
  }>,
  options?: {
    dateFormat?: string
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    format?: 'svg' | 'png'
  }
): Promise<FigureGenerationResult> {
  const dateFormat = options?.dateFormat || 'YYYY-MM-DD'
  
  // Build Gantt code
  const sectionDefs = sections.map(s => {
    const taskLines = s.tasks.map(t => {
      const statusPrefix = t.status ? `${t.status}, ` : ''
      const id = t.id ? `${t.id}, ` : ''
      return `        ${t.name} :${statusPrefix}${id}${t.start}, ${t.duration}`
    }).join('\n')
    return `    section ${s.name}\n${taskLines}`
  }).join('\n')
  
  const code = `gantt
    title ${title}
    dateFormat ${dateFormat}
${sectionDefs}`

  return generateMermaidDiagram(
    {
      diagramType: 'gantt',
      code,
      theme: options?.theme?.preset as any
    },
    {
      theme: options?.theme,
      academicStyle: options?.academicStyle,
      format: options?.format
    }
  )
}

/**
 * Generate a state diagram.
 */
export async function generateStateDiagram(
  states: Array<{ id: string; label?: string; type?: 'normal' | 'fork' | 'join' | 'choice' }>,
  transitions: Array<{ from: string; to: string; label?: string }>,
  options?: {
    initialState?: string
    finalStates?: string[]
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    format?: 'svg' | 'png'
  }
): Promise<FigureGenerationResult> {
  // Build state definitions
  const stateDefs = states
    .filter(s => s.label)
    .map(s => `    ${s.id} : ${s.label}`)
    .join('\n')
  
  // Build transition definitions
  const transitionDefs: string[] = []
  
  // Initial transition
  if (options?.initialState) {
    transitionDefs.push(`    [*] --> ${options.initialState}`)
  }
  
  // Regular transitions
  transitions.forEach(t => {
    const label = t.label ? ` : ${t.label}` : ''
    transitionDefs.push(`    ${t.from} --> ${t.to}${label}`)
  })
  
  // Final transitions
  if (options?.finalStates) {
    options.finalStates.forEach(s => {
      transitionDefs.push(`    ${s} --> [*]`)
    })
  }
  
  const code = `stateDiagram-v2\n${stateDefs}\n${transitionDefs.join('\n')}`

  return generateMermaidDiagram(
    {
      diagramType: 'state',
      code,
      theme: options?.theme?.preset as any
    },
    {
      theme: options?.theme,
      academicStyle: options?.academicStyle,
      format: options?.format
    }
  )
}

// ============================================================================
// Raw Mermaid/PlantUML Code Generation
// ============================================================================

/**
 * Clean Mermaid code from LLM artifacts (markdown blocks, extra text, etc.)
 */
function cleanMermaidCode(rawCode: string): string {
  let code = rawCode.trim()
  
  // Remove markdown code block wrappers
  const mermaidBlockMatch = code.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/i)
  if (mermaidBlockMatch) {
    code = mermaidBlockMatch[1].trim()
  }
  
  // Remove any leading/trailing text that's not Mermaid syntax
  const mermaidStartPatterns = [
    'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 
    'stateDiagram', 'erDiagram', 'gantt', 'mindmap', 'timeline', '%%{'
  ]
  
  // Find where Mermaid code actually starts
  for (const pattern of mermaidStartPatterns) {
    const idx = code.indexOf(pattern)
    if (idx > 0) {
      // Check if there's just text before the pattern
      const beforePattern = code.slice(0, idx).trim()
      if (!beforePattern.includes('\n') || beforePattern.length < 50) {
        code = code.slice(idx)
        break
      }
    }
  }
  
  // Remove any trailing explanatory text (after the last closing bracket/statement)
  const lines = code.split('\n')
  let lastValidLineIdx = lines.length - 1
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    // Keep lines that look like Mermaid syntax
    if (line.match(/^[A-Za-z0-9_\[\](){}<>|"'`\-\s:;@#.,!?%&*+=]+$/) || 
        line === '' || 
        line.startsWith('%%') ||
        line.startsWith('end') ||
        line.includes('-->') ||
        line.includes('---') ||
        line.includes('===')) {
      lastValidLineIdx = i
      break
    }
  }
  
  code = lines.slice(0, lastValidLineIdx + 1).join('\n').trim()
  
  return code
}

/**
 * Generate diagram from raw Mermaid code.
 */
export async function generateFromMermaidCode(
  code: string,
  options?: {
    theme?: FigureTheme
    academicStyle?: AcademicFigureStyle
    format?: 'svg' | 'png'
  }
): Promise<FigureGenerationResult> {
  // Clean the code from LLM artifacts
  const cleanedCode = cleanMermaidCode(code)
  
  console.log('[Mermaid] Cleaned code preview:', cleanedCode.slice(0, 150))
  
  // Auto-detect diagram type from code
  let diagramType: DiagramType = 'flowchart'
  
  if (cleanedCode.includes('sequenceDiagram')) diagramType = 'sequence'
  else if (cleanedCode.includes('classDiagram')) diagramType = 'class'
  else if (cleanedCode.includes('stateDiagram')) diagramType = 'state'
  else if (cleanedCode.includes('erDiagram')) diagramType = 'er'
  else if (cleanedCode.includes('gantt')) diagramType = 'gantt'
  else if (cleanedCode.includes('mindmap')) diagramType = 'mindmap'
  else if (cleanedCode.includes('timeline')) diagramType = 'timeline'
  else if (cleanedCode.match(/^graph\s+(TD|TB|BT|RL|LR)/m)) diagramType = 'flowchart'
  else if (cleanedCode.match(/^flowchart\s+(TD|TB|BT|RL|LR)/m)) diagramType = 'flowchart'

  return generateMermaidDiagram(
    { diagramType, code: cleanedCode },
    options
  )
}

/**
 * Generate diagram from raw PlantUML code.
 */
export async function generateFromPlantUMLCode(
  code: string,
  options?: {
    format?: 'svg' | 'png'
    useProxy?: boolean
  }
): Promise<FigureGenerationResult> {
  // cleanPlantUMLCode is called inside generatePlantUMLDiagram
  return generatePlantUMLDiagram(code, options)
}

