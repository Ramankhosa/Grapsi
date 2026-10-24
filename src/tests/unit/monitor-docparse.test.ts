import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { DocumentParseError, joinedText, parseLocal } from '@/lib/monitor/docParse'

/**
 * C1: local-only parsing. The shared intake parser transcribes sparse pages
 * with an LLM (sending the whole PDF each time) and turns failures into empty
 * text; this one must make no model or network call, ever, and must say which
 * pages need OCR instead of returning silent empties.
 */

async function textPdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    const page = doc.addPage([595, 842])
    page.drawText(text, { x: 50, y: 780, size: 12, font })
  }
  return Buffer.from(await doc.save())
}

/** Pages with only drawn shapes — what a scanned notice looks like to a text parser. */
async function scannedPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595, 842])
    page.drawRectangle({ x: 40, y: 40, width: 515, height: 762, color: rgb(0.9, 0.9, 0.9) })
  }
  return Buffer.from(await doc.save())
}

describe('parseLocal', () => {
  it('extracts text pages as OK', async () => {
    const pdf = await textPdf([
      'Call for proposals: Women Scientists Scheme 2026. Last date for submission 30 November 2026.',
      'Eligibility: Indian women scientists aged 27 to 57 holding a PhD in science or engineering.',
    ])
    const result = await parseLocal(pdf, 'pdf')
    expect(result.status).toBe('OK')
    expect(result.pageCount).toBe(2)
    expect(result.pages.map((page) => page.status)).toEqual(['OK', 'OK'])
    expect(joinedText(result)).toContain('Last date for submission 30 November 2026')
  })

  it('marks every page of a 30-page scan NEEDS_OCR, with no transcription attempted', async () => {
    const result = await parseLocal(await scannedPdf(30), 'pdf', { maxPages: 40 })
    expect(result.status).toBe('NEEDS_OCR')
    expect(result.pages).toHaveLength(30)
    expect(result.pages.every((page) => page.status === 'NEEDS_OCR' && page.text === '')).toBe(true)
  })

  it('reports mixed documents as PARTIAL rather than complete', async () => {
    const doc = await PDFDocument.load(await textPdf(['A page with plenty of readable text about the funding call.']))
    doc.addPage([595, 842])
    const result = await parseLocal(Buffer.from(await doc.save()), 'pdf')
    expect(result.status).toBe('PARTIAL')
    expect(result.pages.map((page) => page.status)).toEqual(['OK', 'NEEDS_OCR'])
  })

  it('honours a page range and a page budget, marking the rest SKIPPED_LIMIT', async () => {
    const pdf = await textPdf(Array.from({ length: 12 }, (_, i) => `Page ${i + 1} of the guidelines with enough text to count.`))
    const ranged = await parseLocal(pdf, 'pdf', { pages: [3, 4] })
    expect(ranged.pages.map((page) => page.page)).toEqual([3, 4])

    const budgeted = await parseLocal(pdf, 'pdf', { maxPages: 5 })
    expect(budgeted.pages.filter((page) => page.status === 'OK')).toHaveLength(5)
    expect(budgeted.pages.filter((page) => page.status === 'SKIPPED_LIMIT')).toHaveLength(7)
    expect(budgeted.status).toBe('PARTIAL')
  })

  it('refuses oversized input before parsing', async () => {
    await expect(parseLocal(Buffer.alloc(2048), 'pdf', { maxBytes: 1024 })).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('cancels by terminating the worker thread', async () => {
    const pdf = await textPdf(Array.from({ length: 30 }, () => 'Some text on a page that takes a moment to parse.'))
    const controller = new AbortController()
    const pending = parseLocal(pdf, 'pdf', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(DocumentParseError)
  })

  it('reports garbage as PARSE_FAILED, never as an empty success', async () => {
    await expect(parseLocal(Buffer.from('%PDF-1.7 this is not really a pdf'), 'pdf')).rejects.toMatchObject({ code: 'PARSE_FAILED' })
  })
})

describe('the local parser has no network or model path', () => {
  const root = join(__dirname, '..', '..', 'lib', 'monitor')

  it('imports only pdfjs, mammoth and Node built-ins in the worker', () => {
    const source = readFileSync(join(root, 'docParse.worker.mjs'), 'utf8')
    const imports = [...source.matchAll(/(?:import\s*\(|from\s+|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const specifier of imports) {
      expect(['node:module', 'node:path', 'node:worker_threads', 'pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/package.json', 'mammoth']).toContain(
        specifier
      )
    }
  })

  it('never reaches the metering gateway or the shared transcribing parser', () => {
    const source = readFileSync(join(root, 'docParse.ts'), 'utf8')
    expect(source).not.toMatch(/@\/lib\/metering|llmRouting|fundingDocuments\/parser|from ['"]undici['"]|fetch\(/)
  })
})
