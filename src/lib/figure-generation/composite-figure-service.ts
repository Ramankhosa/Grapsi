/**
 * Composite Figure Service
 *
 * Assembles multiple sub-figures into a single publication-grade composite
 * figure with sub-labels (a), (b), (c), etc. -- standard in Q1 journal papers.
 *
 * Uses jimp for image composition (already a project dependency).
 *
 * Supported layouts:
 *   1x2, 2x1, 1x3, 3x1, 2x2, 2x3, 3x2
 */

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

export type CompositeLayout = '1x2' | '2x1' | '1x3' | '3x1' | '2x2' | '2x3' | '3x2'

export interface SubFigure {
  imageBase64: string
  mimeType?: string
  label?: string
}

export interface CompositeResult {
  success: boolean
  imageBase64?: string
  mimeType?: string
  width?: number
  height?: number
  error?: string
}

interface LayoutConfig {
  cols: number
  rows: number
}

const LAYOUT_MAP: Record<CompositeLayout, LayoutConfig> = {
  '1x2': { cols: 2, rows: 1 },
  '2x1': { cols: 1, rows: 2 },
  '1x3': { cols: 3, rows: 1 },
  '3x1': { cols: 1, rows: 3 },
  '2x2': { cols: 2, rows: 2 },
  '2x3': { cols: 3, rows: 2 },
  '3x2': { cols: 2, rows: 3 },
}

const LABEL_HEIGHT = 28
const PADDING = 12
const INTER_CELL_GAP = 8
const BG_COLOR = 0xFFFFFFFF

/**
 * Compose multiple sub-figures into a single image with labeled panels.
 */
export async function composeMultiPanelFigure(
  subFigures: SubFigure[],
  layout: CompositeLayout,
  opts?: {
    targetCellWidth?: number
    labelStyle?: 'parenthetical' | 'bold'
  }
): Promise<CompositeResult> {
  if (subFigures.length === 0) {
    return { success: false, error: 'No sub-figures provided' }
  }

  const config = LAYOUT_MAP[layout]
  if (!config) {
    return { success: false, error: `Unknown layout: ${layout}` }
  }

  const totalCells = config.cols * config.rows
  if (subFigures.length > totalCells) {
    return { success: false, error: `Layout ${layout} supports max ${totalCells} panels, got ${subFigures.length}` }
  }

  try {
    const jimpMod: any = await import('jimp')
    const Jimp = jimpMod.default || jimpMod

    const cellWidth = opts?.targetCellWidth || 525
    const images: any[] = []

    for (const sf of subFigures) {
      const buf = Buffer.from(sf.imageBase64, 'base64')
      const img = await Jimp.read(buf)
      img.scaleToFit(cellWidth, cellWidth)
      images.push(img)
    }

    const maxCellH = Math.max(...images.map((img: any) => img.bitmap.height))
    const cellHeight = maxCellH + LABEL_HEIGHT

    const canvasW = config.cols * cellWidth + (config.cols - 1) * INTER_CELL_GAP + PADDING * 2
    const canvasH = config.rows * cellHeight + (config.rows - 1) * INTER_CELL_GAP + PADDING * 2

    const canvas = new Jimp(canvasW, canvasH, BG_COLOR)

    const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK)

    for (let i = 0; i < images.length; i++) {
      const col = i % config.cols
      const row = Math.floor(i / config.cols)

      const x = PADDING + col * (cellWidth + INTER_CELL_GAP)
      const y = PADDING + row * (cellHeight + INTER_CELL_GAP)

      const label = subFigures[i].label || `(${String.fromCharCode(97 + i)})`

      const imgCenterX = x + Math.floor((cellWidth - images[i].bitmap.width) / 2)
      canvas.composite(images[i], imgCenterX, y + LABEL_HEIGHT)

      canvas.print(font, x + 4, y + 2, label)
    }

    const outBuffer = await canvas.getBufferAsync(Jimp.MIME_PNG)
    const base64 = outBuffer.toString('base64')

    return {
      success: true,
      imageBase64: base64,
      mimeType: 'image/png',
      width: canvasW,
      height: canvasH,
    }
  } catch (err) {
    console.error('[CompositeFigure] Composition failed:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Composite figure generation failed',
    }
  }
}

/**
 * Save a composite figure to disk.
 */
export async function saveCompositeFigure(
  result: CompositeResult,
  sessionId: string
): Promise<{ imagePath: string } | { error: string }> {
  if (!result.success || !result.imageBase64) {
    return { error: result.error || 'No image to save' }
  }

  const uploadDir = path.join(process.cwd(), 'public/uploads/figures')
  await fs.mkdir(uploadDir, { recursive: true })

  const filename = `composite_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`
  const filePath = path.join(uploadDir, filename)
  const buffer = Buffer.from(result.imageBase64, 'base64')
  await fs.writeFile(filePath, buffer)

  return { imagePath: `/uploads/figures/${filename}` }
}
