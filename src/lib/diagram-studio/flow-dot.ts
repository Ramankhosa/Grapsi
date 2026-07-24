/**
 * Grant Diagram Studio — deterministic FlowSpec → Graphviz DOT compiler.
 *
 * Preferred flowchart renderer: Kroki's Graphviz returns pure-SVG text (no
 * foreignObject), so the result can be rasterized locally at print
 * resolution with full theme control. Mermaid remains the fallback.
 */

import type { FlowSpec, FlowNode } from './spec-types'
import { DiagramTheme, seriesColor, seriesFillColor } from './theme'

function escapeDot(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Insert \n breaks so node labels wrap instead of producing huge boxes. */
function wrapLabel(value: string, charsPerLine = 22): string {
  const words = value.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= charsPerLine) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.map(escapeDot).join('\\n')
}

function sanitizeId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `N_${cleaned}`
}

interface RoleStyle {
  shape: string
  extraStyle?: string
  fillIndex: number
}

const ROLE_STYLES: Record<FlowNode['role'], RoleStyle> = {
  start: { shape: 'box', extraStyle: 'rounded', fillIndex: -1 },
  end: { shape: 'box', extraStyle: 'rounded', fillIndex: -1 },
  input: { shape: 'parallelogram', fillIndex: 1 },
  process: { shape: 'box', extraStyle: 'rounded', fillIndex: 0 },
  decision: { shape: 'diamond', fillIndex: 3 },
  output: { shape: 'parallelogram', fillIndex: 2 },
  milestone: { shape: 'hexagon', fillIndex: 4 },
}

function nodeAttrs(node: FlowNode, theme: DiagramTheme): string {
  const role = ROLE_STYLES[node.role] || ROLE_STYLES.process
  const fill = role.fillIndex >= 0 ? seriesFillColor(theme, role.fillIndex) : theme.headerBand
  const stroke = role.fillIndex >= 0 ? seriesColor(theme, role.fillIndex) : theme.gridStrong
  const style = ['filled', role.extraStyle].filter(Boolean).join(',')
  return [
    `label="${wrapLabel(node.label)}"`,
    `shape=${role.shape}`,
    `style="${style}"`,
    `fillcolor="${fill}"`,
    `color="${stroke}"`,
    `fontcolor="${theme.text}"`,
    'penwidth=1.4',
  ].join(', ')
}

export function compileFlowDot(spec: FlowSpec, theme: DiagramTheme): string {
  const fontName = theme.fontFamily.split(',')[0].replace(/['"]/g, '').trim() || 'Arial'
  const lines: string[] = []

  lines.push('digraph grant_flow {')
  lines.push(`  rankdir=${spec.direction === 'LR' ? 'LR' : 'TB'};`)
  lines.push(`  bgcolor="${theme.background}";`)
  lines.push(`  fontname="${fontName}";`)
  lines.push('  pad=0.3;')
  lines.push('  nodesep=0.45;')
  lines.push('  ranksep=0.55;')
  lines.push('  splines=spline;')
  lines.push(`  node [fontname="${fontName}", fontsize=13, margin="0.22,0.13"];`)
  lines.push(
    `  edge [fontname="${fontName}", fontsize=11, color="${theme.mutedText}", fontcolor="${theme.mutedText}", arrowsize=0.85, penwidth=1.3];`
  )

  // Group nodes into clusters, preserving declaration order.
  const groups = new Map<string, FlowNode[]>()
  const ungrouped: FlowNode[] = []
  for (const node of spec.nodes) {
    const group = node.group?.trim()
    if (group) {
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push(node)
    } else {
      ungrouped.push(node)
    }
  }

  ungrouped.forEach(node => {
    lines.push(`  ${sanitizeId(node.id)} [${nodeAttrs(node, theme)}];`)
  })

  let clusterIndex = 0
  for (const [groupName, nodes] of groups) {
    lines.push(`  subgraph cluster_${clusterIndex++} {`)
    lines.push(`    label="${escapeDot(groupName)}";`)
    lines.push(`    fontname="${fontName}";`)
    lines.push('    fontsize=13;')
    lines.push(`    fontcolor="${theme.text}";`)
    lines.push(`    style="filled,rounded";`)
    lines.push(`    fillcolor="${theme.headerBand}";`)
    lines.push(`    color="${theme.gridStrong}";`)
    lines.push('    margin=14;')
    nodes.forEach(node => {
      lines.push(`    ${sanitizeId(node.id)} [${nodeAttrs(node, theme)}];`)
    })
    lines.push('  }')
  }

  const knownIds = new Set(spec.nodes.map(n => sanitizeId(n.id)))
  for (const edge of spec.edges) {
    const from = sanitizeId(edge.from)
    const to = sanitizeId(edge.to)
    if (!knownIds.has(from) || !knownIds.has(to)) continue
    const attrs: string[] = []
    if (edge.label) attrs.push(`label="${escapeDot(edge.label)}"`)
    if (edge.style === 'dashed') attrs.push('style=dashed')
    lines.push(`  ${from} -> ${to}${attrs.length ? ` [${attrs.join(', ')}]` : ''};`)
  }

  lines.push('}')
  return lines.join('\n')
}
