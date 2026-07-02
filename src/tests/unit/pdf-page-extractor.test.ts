import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'

import { extractSelectedPdfPages, getPdfPageCount } from '@/lib/pdf/pdfPageExtractor'

async function createPdf(pageCount: number) {
  const document = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([300, 400])
  }
  return Buffer.from(await document.save())
}

describe('PDF page extractor', () => {
  it('copies selected pages into a reduced PDF in the requested order', async () => {
    const source = await createPdf(5)
    const reduced = await extractSelectedPdfPages(source, [4, 2, 2])

    expect(reduced.originalPageCount).toBe(5)
    expect(reduced.selectedPages).toEqual([2, 4])
    await expect(getPdfPageCount(reduced.bytes)).resolves.toBe(2)
  })

  it('rejects empty and out-of-range page selections', async () => {
    const source = await createPdf(3)

    await expect(extractSelectedPdfPages(source, [])).rejects.toThrow('Select at least one')
    await expect(extractSelectedPdfPages(source, [4])).rejects.toThrow('outside')
  })
})
