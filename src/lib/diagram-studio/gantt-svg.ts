/**
 * Grant Diagram Studio — deterministic Gantt/workplan SVG compiler.
 *
 * Pure function: GanttSpec + theme → themed SVG string. No LLM, no external
 * service. Layout: title, month grid with quarter shading, work-package bands,
 * rounded task bars, milestone diamonds on a dedicated lane, legend.
 */

import type { GanttSpec } from './spec-types'
import { DiagramTheme, seriesColor, seriesFillColor } from './theme'

const LABEL_COL_WIDTH = 300
const ROW_HEIGHT = 34
const GROUP_HEADER_HEIGHT = 30
const TITLE_HEIGHT = 52
const AXIS_HEIGHT = 30
const MILESTONE_LANE_HEIGHT = 44
const LEGEND_HEIGHT = 34
const PADDING = 20
const BAR_HEIGHT = 18
const BAR_RADIUS = 5

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(value: string, max: number): string {
  const clean = value.trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function compileGanttSvg(spec: GanttSpec, theme: DiagramTheme): string {
  const totalMonths = Math.max(1, spec.totalMonths)
  const monthWidth = totalMonths <= 12 ? 64 : totalMonths <= 24 ? 44 : totalMonths <= 36 ? 32 : 24
  const chartWidth = totalMonths * monthWidth
  const width = PADDING * 2 + LABEL_COL_WIDTH + chartWidth

  const taskRows = spec.groups.reduce((sum, g) => sum + g.tasks.length, 0)
  const hasMilestones = (spec.milestones || []).length > 0
  const bodyHeight =
    spec.groups.length * GROUP_HEADER_HEIGHT +
    taskRows * ROW_HEIGHT +
    (hasMilestones ? MILESTONE_LANE_HEIGHT : 0)
  const height = PADDING * 2 + TITLE_HEIGHT + AXIS_HEIGHT + bodyHeight + LEGEND_HEIGHT

  const chartX = PADDING + LABEL_COL_WIDTH
  const chartTop = PADDING + TITLE_HEIGHT + AXIS_HEIGHT
  const monthX = (month: number) => chartX + (month - 1) * monthWidth

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(theme.fontFamily)}">`
  )
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${theme.background}"/>`)

  // Title
  parts.push(
    `<text x="${PADDING}" y="${PADDING + 24}" font-size="19" font-weight="700" fill="${theme.text}">${esc(truncate(spec.title, 110))}</text>`
  )

  // Quarter shading (alternate 3-month bands)
  for (let q = 0; q < Math.ceil(totalMonths / 3); q++) {
    if (q % 2 === 1) {
      const startM = q * 3 + 1
      const bandWidth = Math.min(3, totalMonths - (startM - 1)) * monthWidth
      parts.push(
        `<rect x="${monthX(startM)}" y="${chartTop}" width="${bandWidth}" height="${bodyHeight}" fill="${theme.headerBand}" opacity="0.55"/>`
      )
    }
  }

  // Month grid lines + axis labels
  const labelEvery = totalMonths <= 18 ? 1 : totalMonths <= 36 ? 3 : 6
  for (let m = 1; m <= totalMonths + 1; m++) {
    const x = monthX(m)
    const isQuarter = (m - 1) % 3 === 0
    parts.push(
      `<line x1="${x}" y1="${chartTop}" x2="${x}" y2="${chartTop + bodyHeight}" stroke="${isQuarter ? theme.gridStrong : theme.grid}" stroke-width="1"/>`
    )
    if (m <= totalMonths && (m === 1 || m % labelEvery === 0)) {
      parts.push(
        `<text x="${x + monthWidth / 2}" y="${chartTop - 9}" font-size="11" text-anchor="middle" fill="${theme.mutedText}">M${m}</text>`
      )
    }
  }
  parts.push(
    `<line x1="${chartX}" y1="${chartTop}" x2="${chartX + chartWidth}" y2="${chartTop}" stroke="${theme.gridStrong}" stroke-width="1"/>`
  )

  // Groups + tasks
  let y = chartTop
  spec.groups.forEach((group, groupIndex) => {
    const color = seriesColor(theme, groupIndex)
    const fill = seriesFillColor(theme, groupIndex)

    // Group band
    parts.push(
      `<rect x="${PADDING}" y="${y}" width="${LABEL_COL_WIDTH + chartWidth}" height="${GROUP_HEADER_HEIGHT}" fill="${theme.headerBand}"/>`
    )
    parts.push(
      `<rect x="${PADDING}" y="${y}" width="4" height="${GROUP_HEADER_HEIGHT}" fill="${color}"/>`
    )
    parts.push(
      `<text x="${PADDING + 12}" y="${y + 20}" font-size="13" font-weight="700" fill="${theme.text}">${esc(truncate(group.name, 66))}</text>`
    )
    y += GROUP_HEADER_HEIGHT

    group.tasks.forEach(task => {
      const rowCenter = y + ROW_HEIGHT / 2
      // Row separator
      parts.push(
        `<line x1="${PADDING}" y1="${y + ROW_HEIGHT}" x2="${width - PADDING}" y2="${y + ROW_HEIGHT}" stroke="${theme.grid}" stroke-width="0.5"/>`
      )
      // Task label
      parts.push(
        `<text x="${PADDING + 16}" y="${rowCenter + 4}" font-size="12" fill="${theme.text}">${esc(truncate(task.label, 46))}</text>`
      )
      // Bar
      const barX = monthX(task.startMonth)
      const barWidth = Math.max(monthWidth * 0.6, (task.endMonth - task.startMonth + 1) * monthWidth - 3)
      const barY = rowCenter - BAR_HEIGHT / 2
      parts.push(
        `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${BAR_HEIGHT}" rx="${BAR_RADIUS}" fill="${fill}" stroke="${task.critical ? theme.critical : color}" stroke-width="${task.critical ? 2 : 1.25}"/>`
      )
      // Duration hint inside bar when wide enough
      const duration = task.endMonth - task.startMonth + 1
      if (barWidth > 56) {
        parts.push(
          `<text x="${barX + barWidth / 2}" y="${barY + BAR_HEIGHT - 5}" font-size="10" text-anchor="middle" fill="${color}">M${task.startMonth}–M${task.endMonth} (${duration}m)</text>`
        )
      }
      y += ROW_HEIGHT
    })
  })

  // Milestone lane
  if (hasMilestones) {
    const laneCenter = y + MILESTONE_LANE_HEIGHT / 2
    parts.push(
      `<rect x="${PADDING}" y="${y}" width="${LABEL_COL_WIDTH + chartWidth}" height="${MILESTONE_LANE_HEIGHT}" fill="${theme.headerBand}" opacity="0.7"/>`
    )
    parts.push(
      `<text x="${PADDING + 12}" y="${laneCenter + 4}" font-size="13" font-weight="700" fill="${theme.text}">Milestones</text>`
    )
    const sorted = [...(spec.milestones || [])].sort((a, b) => a.month - b.month)
    sorted.forEach((milestone, index) => {
      const cx = monthX(milestone.month) + monthWidth / 2
      const cy = laneCenter
      const r = 7
      parts.push(
        `<path d="M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z" fill="${theme.milestone}" stroke="${theme.background}" stroke-width="1.5"/>`
      )
      // Alternate label above/below the diamond to reduce collisions
      const labelY = index % 2 === 0 ? cy - r - 4 : cy + r + 12
      parts.push(
        `<text x="${cx}" y="${labelY}" font-size="10" text-anchor="middle" fill="${theme.mutedText}">${esc(truncate(milestone.label, 26))}</text>`
      )
    })
    y += MILESTONE_LANE_HEIGHT
  }

  // Legend
  const legendY = y + 22
  let legendX = PADDING
  spec.groups.forEach((group, groupIndex) => {
    const color = seriesColor(theme, groupIndex)
    const label = truncate(group.name, 28)
    parts.push(`<rect x="${legendX}" y="${legendY - 10}" width="12" height="12" rx="3" fill="${color}"/>`)
    parts.push(
      `<text x="${legendX + 17}" y="${legendY}" font-size="11" fill="${theme.mutedText}">${esc(label)}</text>`
    )
    legendX += 17 + label.length * 6 + 26
  })
  if (hasMilestones) {
    parts.push(
      `<path d="M ${legendX + 6} ${legendY - 10} L ${legendX + 12} ${legendY - 4} L ${legendX + 6} ${legendY + 2} L ${legendX} ${legendY - 4} Z" fill="${theme.milestone}"/>`
    )
    parts.push(
      `<text x="${legendX + 17}" y="${legendY}" font-size="11" fill="${theme.mutedText}">Milestone</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}
