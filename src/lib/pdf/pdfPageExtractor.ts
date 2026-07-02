import { PDFDocument } from 'pdf-lib'

import {
  MAX_SELECTED_TEMPLATE_PDF_PAGES,
  normalizeSelectedPages,
} from './pageSelection'

export type SelectedPdfPageExtraction = {
  bytes: Buffer
  originalPageCount: number
  selectedPages: number[]
}

export function mapPdfLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (lower.includes('encrypted') || lower.includes('password')) {
    return 'This PDF is encrypted or password protected. Upload an unlocked PDF.'
  }

  if (lower.includes('invalid') || lower.includes('xref') || lower.includes('parse')) {
    return 'This PDF could not be read. Upload a valid PDF file.'
  }

  return `This PDF could not be processed${message ? `: ${message}` : ''}`
}

export async function getPdfPageCount(bytes: Buffer | Uint8Array) {
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false })
  return document.getPageCount()
}

export async function extractSelectedPdfPages(
  bytes: Buffer | Uint8Array,
  selectedPagesInput: unknown,
  maxPages = MAX_SELECTED_TEMPLATE_PDF_PAGES
): Promise<SelectedPdfPageExtraction> {
  const sourceDocument = await PDFDocument.load(bytes, { ignoreEncryption: false })
  const originalPageCount = sourceDocument.getPageCount()
  const normalized = normalizeSelectedPages(selectedPagesInput, {
    totalPages: originalPageCount,
    maxPages,
  })

  if (normalized.error) {
    throw new Error(normalized.error)
  }
  if (normalized.pages.length === 0) {
    throw new Error('Select at least one PDF page before extracting the template.')
  }

  const targetDocument = await PDFDocument.create()
  const copiedPages = await targetDocument.copyPages(
    sourceDocument,
    normalized.pages.map((page) => page - 1)
  )

  for (const page of copiedPages) {
    targetDocument.addPage(page)
  }

  const outputBytes = await targetDocument.save()
  return {
    bytes: Buffer.from(outputBytes),
    originalPageCount,
    selectedPages: normalized.pages,
  }
}
