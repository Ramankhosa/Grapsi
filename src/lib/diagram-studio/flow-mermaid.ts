/**
 * Grant Diagram Studio — deterministic FlowSpec → Mermaid compiler.
 *
 * The LLM never writes Mermaid syntax; it emits a validated FlowSpec and this
 * compiler produces clean, themed Mermaid code that Kroki renders. This
 * removes the syntax-repair loops of the legacy pipeline.
 */

import type { FlowSpec, FlowNode } from './spec-types'
import { DiagramTheme, seriesFillColor, seriesColor } from './theme'

/** Mermaid-safe label: ASCII, no structural characters. */
function sanitizeLabel(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
  return normalized
    .replace(/[\[\]{}()|"'`;<>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function sanitizeId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `N_${cleaned}`
}

function nodeShape(node: FlowNode, label: string): string {
  switch (node.role) {
    case 'start':
    case 'end':
      return `(["${label}"])`
    case 'decision':
      return `{"${label}"}`
    case 'input':
      return `[/"${label}"/]`
    case 'output':
      return `[\\"${label}"\\]`
    case 'milestone':
      return `{{"${label}"}}`
    default:
      return `["${label}"]`
  }
}

export function compileFlowMermaid(spec: FlowSpec, theme: DiagramTheme): string {
  const lines: string[] = []

  // Kroki rasterizes at 1 SVG unit = 1px, so the 2x-scale font/spacing values
  // below are what give the exported PNG print-grade resolution.
  lines.push(
    `%%{init: {"theme": "base", "themeVariables": {` +
      `"fontFamily": "${theme.fontFamily.replace(/"/g, '')}", ` +
      `"fontSize": "30px", ` +
      `"primaryColor": "${seriesFillColor(theme, 0)}", ` +
      `"primaryTextColor": "${theme.text}", ` +
      `"primaryBorderColor": "${seriesColor(theme, 0)}", ` +
      `"lineColor": "${theme.mutedText}", ` +
      `"clusterBkg": "${theme.headerBand}", ` +
      `"clusterBorder": "${theme.gridStrong}", ` +
      `"edgeLabelBackground": "${theme.background}"` +
      `}, "flowchart": {"curve": "basis", "nodeSpacing": 92, "rankSpacing": 112, "padding": 20}}}%%`
  )
  lines.push(`flowchart ${spec.direction}`)

  // Group nodes into subgraphs, preserving declaration order.
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

  const declareNode = (node: FlowNode, indent: string) => {
    const id = sanitizeId(node.id)
    const label = sanitizeLabel(node.label) || id
    lines.push(`${indent}${id}${nodeShape(node, label)}`)
    lines.push(`${indent}class ${id} role_${node.role}`)
  }

  ungrouped.forEach(node => declareNode(node, '    '))
  let groupIndex = 0
  for (const [groupName, nodes] of groups) {
    const groupId = sanitizeId(`grp_${groupIndex++}_${groupName}`)
    lines.push(`    subgraph ${groupId}["${sanitizeLabel(groupName)}"]`)
    nodes.forEach(node => declareNode(node, '        '))
    lines.push('    end')
  }

  const knownIds = new Set(spec.nodes.map(n => sanitizeId(n.id)))
  for (const edge of spec.edges) {
    const from = sanitizeId(edge.from)
    const to = sanitizeId(edge.to)
    if (!knownIds.has(from) || !knownIds.has(to)) continue
    const arrow = edge.style === 'dashed' ? '-.->' : '-->'
    const label = edge.label ? sanitizeLabel(edge.label) : ''
    lines.push(label ? `    ${from} ${arrow}|"${label}"| ${to}` : `    ${from} ${arrow} ${to}`)
  }

  // Role styling
  const roleStyles: Array<[string, string, string]> = [
    ['role_start', theme.headerBand, theme.gridStrong],
    ['role_end', theme.headerBand, theme.gridStrong],
    ['role_input', seriesFillColor(theme, 1), seriesColor(theme, 1)],
    ['role_process', seriesFillColor(theme, 0), seriesColor(theme, 0)],
    ['role_decision', seriesFillColor(theme, 3), seriesColor(theme, 3)],
    ['role_output', seriesFillColor(theme, 2), seriesColor(theme, 2)],
    ['role_milestone', seriesFillColor(theme, 4), seriesColor(theme, 4)],
  ]
  for (const [cls, fill, stroke] of roleStyles) {
    lines.push(
      `    classDef ${cls} fill:${fill},stroke:${stroke},stroke-width:3px,color:${theme.text}`
    )
  }

  return lines.join('\n')
}
