/**
 * Grant Diagram Studio — deterministic logic-model SVG compiler.
 *
 * Fixed-column layout (inputs → activities → outputs → outcomes → impact)
 * with header pills, item cards, and inter-column arrows. Pure function.
 */

import type { LogicModelSpec } from './spec-types'
import { DiagramTheme, seriesColor, seriesFillColor } from './theme'

const COLUMN_WIDTH = 216
const COLUMN_GAP = 46
const HEADER_HEIGHT = 34
const ITEM_GAP = 10
const ITEM_PADDING_X = 12
const ITEM_PADDING_Y = 9
const LINE_HEIGHT = 15
const FONT_SIZE = 11.5
const CHARS_PER_LINE = 30
const MAX_LINES = 4
const TITLE_HEIGHT = 50
const PADDING = 22

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapText(text: string, charsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= charsPerLine) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word.length > charsPerLine ? `${word.slice(0, charsPerLine - 1)}…` : word
      if (lines.length === maxLines - 1) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, charsPerLine - 1)}…`
  }
  return lines
}

interface LaidOutItem {
  lines: string[]
  height: number
}

export function compileLogicModelSvg(spec: LogicModelSpec, theme: DiagramTheme): string {
  const columns = spec.columns
  const laidOut: LaidOutItem[][] = columns.map(col =>
    col.items.map(item => {
      const lines = wrapText(item.text, CHARS_PER_LINE, MAX_LINES)
      return { lines, height: lines.length * LINE_HEIGHT + ITEM_PADDING_Y * 2 }
    })
  )

  const columnHeights = laidOut.map(items =>
    HEADER_HEIGHT + ITEM_GAP + items.reduce((sum, item) => sum + item.height + ITEM_GAP, 0)
  )
  const bodyHeight = Math.max(...columnHeights)
  const width = PADDING * 2 + columns.length * COLUMN_WIDTH + (columns.length - 1) * COLUMN_GAP
  const height = PADDING * 2 + TITLE_HEIGHT + bodyHeight

  const columnX = (index: number) => PADDING + index * (COLUMN_WIDTH + COLUMN_GAP)
  const bodyTop = PADDING + TITLE_HEIGHT

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(theme.fontFamily)}">`
  )
  parts.push(`<rect width="${width}" height="${height}" fill="${theme.background}"/>`)
  parts.push(
    `<text x="${PADDING}" y="${PADDING + 24}" font-size="19" font-weight="700" fill="${theme.text}">${esc(spec.title)}</text>`
  )

  const arrowMarkerId = 'lm-arrow'
  parts.push(
    `<defs><marker id="${arrowMarkerId}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="${theme.mutedText}"/></marker></defs>`
  )

  columns.forEach((col, colIndex) => {
    const x = columnX(colIndex)
    const color = seriesColor(theme, colIndex)
    const fill = seriesFillColor(theme, colIndex)

    // Header pill
    parts.push(
      `<rect x="${x}" y="${bodyTop}" width="${COLUMN_WIDTH}" height="${HEADER_HEIGHT}" rx="8" fill="${color}"/>`
    )
    parts.push(
      `<text x="${x + COLUMN_WIDTH / 2}" y="${bodyTop + HEADER_HEIGHT / 2 + 4.5}" font-size="13" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(col.label.toUpperCase())}</text>`
    )

    // Inter-column arrow
    if (colIndex < columns.length - 1) {
      const arrowY = bodyTop + HEADER_HEIGHT / 2
      parts.push(
        `<line x1="${x + COLUMN_WIDTH + 6}" y1="${arrowY}" x2="${x + COLUMN_WIDTH + COLUMN_GAP - 8}" y2="${arrowY}" stroke="${theme.mutedText}" stroke-width="1.75" marker-end="url(#${arrowMarkerId})"/>`
      )
    }

    // Items
    let y = bodyTop + HEADER_HEIGHT + ITEM_GAP
    laidOut[colIndex].forEach(item => {
      parts.push(
        `<rect x="${x}" y="${y}" width="${COLUMN_WIDTH}" height="${item.height}" rx="7" fill="${fill}" stroke="${color}" stroke-width="1" opacity="0.95"/>`
      )
      item.lines.forEach((line, lineIndex) => {
        parts.push(
          `<text x="${x + ITEM_PADDING_X}" y="${y + ITEM_PADDING_Y + (lineIndex + 1) * LINE_HEIGHT - 4}" font-size="${FONT_SIZE}" fill="${theme.text}">${esc(line)}</text>`
        )
      })
      y += item.height + ITEM_GAP
    })
  })

  parts.push('</svg>')
  return parts.join('\n')
}
