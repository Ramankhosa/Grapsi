// Local-only document parser, run in a worker_thread by docParse.ts so a
// pathological file can be cancelled by terminating the thread. This file
// must never import anything that can reach the network or an LLM: page
// transcription is a separate, budgeted step (see C1 in the Source Watch plan).
import { createRequire } from 'node:module'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

const require = createRequire(import.meta.url)

const NEEDS_OCR_BELOW_CHARS = 30

function pageStatus(text) {
  return text.replace(/\s+/g, '').length < NEEDS_OCR_BELOW_CHARS ? 'NEEDS_OCR' : 'OK'
}

async function parsePdf(data, range, maxPages) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'))
    pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs').replace(/\\/g, '/')}`
  } catch {
    // main-thread fallback inside this worker is fine
  }
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    // Never fetch fonts, CMaps or anything else from the network.
    disableAutoFetch: true,
    disableStream: true,
    // Errors only: font-data warnings for unembedded standard fonts are noise.
    verbosity: 0,
  }).promise

  const pageCount = doc.numPages
  const first = Math.max(1, range ? range[0] : 1)
  const last = Math.min(pageCount, range ? range[1] : pageCount)
  const pages = []
  for (let page = first; page <= last; page += 1) {
    if (pages.filter((p) => p.status !== 'SKIPPED_LIMIT').length >= maxPages) {
      pages.push({ page, status: 'SKIPPED_LIMIT', text: '', chars: 0 })
      continue
    }
    try {
      const pdfPage = await doc.getPage(page)
      const content = await pdfPage.getTextContent()
      const text = content.items
        .map((item) => (typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
      pages.push({ page, status: pageStatus(text), text, chars: text.length })
      pdfPage.cleanup()
    } catch (error) {
      pages.push({ page, status: 'PARSE_FAILED', text: '', chars: 0, error: String(error?.message ?? error) })
    }
  }
  await doc.destroy()
  return { kind: 'pdf', pageCount, pages }
}

async function parseDocx(buffer) {
  const mammoth = require('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  const text = String(result.value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { kind: 'docx', pageCount: 1, pages: [{ page: 1, status: pageStatus(text), text, chars: text.length }] }
}

async function main() {
  const { buffer, kind, range, maxPages } = workerData
  const bytes = new Uint8Array(buffer)
  if (kind === 'pdf') return parsePdf(bytes, range, maxPages)
  if (kind === 'docx') return parseDocx(Buffer.from(bytes))
  throw new Error(`Unsupported document kind: ${kind}`)
}

main().then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (error) => parentPort.postMessage({ ok: false, error: String(error?.message ?? error) })
)
