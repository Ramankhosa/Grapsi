import { parentPort, workerData } from 'node:worker_threads'
import { PDFDocument } from 'pdf-lib'
try {
  const source = await PDFDocument.load(new Uint8Array(workerData.bytes), { updateMetadata: false })
  const selected = workerData.pages
  if (!selected.length || selected.length > 2 || selected.some(n => !Number.isInteger(n) || n < 1 || n > source.getPageCount())) throw new Error('Invalid selected PDF pages')
  const output = await PDFDocument.create()
  for (const page of await output.copyPages(source, selected.map(n => n - 1))) output.addPage(page)
  const bytes = await output.save({ useObjectStreams: false })
  parentPort.postMessage({ ok: true, bytes })
} catch (error) { parentPort.postMessage({ ok: false, error: error.message }) }
