import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'

import { buildPaperDocxBuffer } from '@/lib/export/paper-docx-export'

const baseFormatting = {
  fontFamily: 'Times New Roman',
  fontSizePt: 11,
  lineSpacing: 1.15,
  marginsCm: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 },
  pageSize: 'A4' as const,
  columnLayout: 1 as const,
  includePageNumbers: false,
}

function readDocumentXml(buffer: Buffer) {
  const zip = new AdmZip(buffer)
  const entry = zip.getEntry('word/document.xml')
  if (!entry) throw new Error('DOCX document XML not found')
  return entry.getData().toString('utf8')
}

describe('paper DOCX export', () => {
  it('keeps content-only sections working', async () => {
    const buffer = await buildPaperDocxBuffer({
      title: 'Plain Export',
      sections: [
        { key: 'summary', title: 'Summary', content: 'First paragraph.\n\nSecond paragraph.' },
      ],
      formatting: baseFormatting,
    })

    const xml = readDocumentXml(buffer)
    expect(xml).toContain('Plain Export')
    expect(xml).toContain('First paragraph.')
    expect(xml).toContain('Second paragraph.')
  })

  it('renders paragraph, bullet, and table blocks', async () => {
    const buffer = await buildPaperDocxBuffer({
      title: 'Block Export',
      sections: [
        {
          key: 'attachments',
          title: 'Attachments',
          content: '',
          blocks: [
            { type: 'paragraph', text: 'Prepared attachments.' },
            { type: 'bullets', items: ['[x] CV uploaded', '[ ] Letter pending'] },
            {
              type: 'table',
              headers: ['Category', 'Amount'],
              rows: [['Equipment', '1000']],
            },
          ],
        },
      ],
      formatting: baseFormatting,
    })

    const xml = readDocumentXml(buffer)
    expect(xml).toContain('Prepared attachments.')
    expect(xml).toContain('[x] CV uploaded')
    expect(xml).toContain('Category')
    expect(xml).toContain('Equipment')
  })
})
