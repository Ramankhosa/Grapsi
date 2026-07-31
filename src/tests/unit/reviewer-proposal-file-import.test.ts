import { readFile } from 'fs/promises'

import { describe, expect, it } from 'vitest'

import {
  buildProposalTargets,
  matchSegmentsToTargets,
  splitProposalIntoSegments,
} from '@/lib/reviewer/proposalSplit'
import { extractTextFromDocumentBytes } from '@/lib/reviewer/sourceText'

const PROPOSAL_LINES = [
  'Clean Water Innovation Grant',
  'Applicant: Dr A. Researcher',
  '1. Executive Summary',
  'This project builds a low-cost sensor network for canal water quality across three districts.',
  '2. Statement of the Problem',
  'Existing monitoring is manual and monthly, so contamination is detected far too late.',
  '3. Objectives',
  'Deploy forty nodes and validate their readings against certified laboratory assays.',
  '4. Methodology',
  'Phase one designs the sensor node. Phase two runs a field trial across two canals.',
  '5. Budget Justification',
  'Equipment costs cover the nodes, the gateways, and one year of connectivity.',
]

const WORKSPACE_SECTIONS = [
  { section_title: 'Summary / Abstract', reviewerBucketKey: 'summary' },
  { section_title: 'Problem, Need & Call Fit', reviewerBucketKey: 'problem_need' },
  { section_title: 'Objectives & Specific Aims', reviewerBucketKey: 'objectives' },
  { section_title: 'Methodology / Approach', reviewerBucketKey: 'methodology' },
  { section_title: 'Budget & Justification', reviewerBucketKey: 'budget' },
]

const TEMPLATE_SECTIONS = [
  { label: 'Executive Summary', bucketKey: 'summary' },
  { label: 'Statement of the Problem', bucketKey: 'problem_need' },
  { label: 'Budget Justification', bucketKey: 'budget' },
]

async function buildDocx(): Promise<Buffer> {
  const { Document, Packer, Paragraph } = await import('docx')
  const doc = new Document({
    sections: [{ children: PROPOSAL_LINES.map((line) => new Paragraph(line)) }],
  })
  return Packer.toBuffer(doc) as unknown as Promise<Buffer>
}

/** Word headings applied as Heading 1 styles rather than numbered text. */
async function buildStyledDocx(): Promise<Buffer> {
  const { Document, HeadingLevel, Packer, Paragraph } = await import('docx')
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('A low-cost sensor network for canal water quality monitoring.'),
          new Paragraph({ text: 'Methodology', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('Phase one designs the node; phase two runs the field trial.'),
          new Paragraph({ text: 'Budget Justification', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('Equipment costs cover the nodes and the gateways.'),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc) as unknown as Promise<Buffer>
}

/** The label/value table layout most Indian agency application forms use. */
async function buildTableFormDocx(): Promise<Buffer> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, WidthType } = await import('docx')
  const row = (label: string, value: string) =>
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph(label)], width: { size: 30, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph(value)], width: { size: 70, type: WidthType.PERCENTAGE } }),
      ],
    })

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph('Application Form for Research Grant'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              row('Objectives', 'Deploy forty nodes and validate against certified laboratory assays.'),
              row('Methodology', 'Phase one designs the node; phase two runs the field trial.'),
              row('Budget Justification', 'Equipment costs cover the nodes and the gateways.'),
            ],
          }),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc) as unknown as Promise<Buffer>
}

/** A Word 97-2003 .doc: an OLE2 compound file, not a zip. */
function legacyDocBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(256, 0),
    Buffer.from('Objectives', 'utf8'),
  ])
}

/**
 * A real PDF, not a generated one. pdfkit and pdf-lib both emit structures the
 * bundled pdf.js in pdf-parse-fork rejects ("bad XRef entry"), so a synthetic
 * fixture would test the generator rather than the import path.
 */
const REAL_PDF_PATH = 'node_modules/pdf-parse-fork/test/data/01-valid.pdf'

/** Parse bytes, split into blocks, and map each block to a workspace section. */
function mapExtractedText(text: string) {
  const targets = buildProposalTargets(WORKSPACE_SECTIONS, TEMPLATE_SECTIONS)
  const matches = matchSegmentsToTargets(splitProposalIntoSegments(text), targets)
  return new Map(
    matches
      .filter((match) => match.targetTitle)
      .map((match) => [match.targetTitle as string, match])
  )
}

describe('proposal file import end to end', () => {
  it('parses a real DOCX and lands each heading in the right reviewer section', async () => {
    const { text, kind } = await extractTextFromDocumentBytes(await buildDocx(), 'proposal.docx')

    expect(kind).toBe('docx')
    expect(text).toContain('1. Executive Summary')

    const placed = mapExtractedText(text)

    expect(placed.get('Summary / Abstract')?.body).toContain('low-cost sensor network')
    expect(placed.get('Problem, Need & Call Fit')?.body).toContain('manual and monthly')
    expect(placed.get('Objectives & Specific Aims')?.body).toContain('forty nodes')
    expect(placed.get('Methodology / Approach')?.body).toContain('Phase one designs')
    expect(placed.get('Budget & Justification')?.body).toContain('Equipment costs')

    // Content must not bleed across the boundary into the next section.
    expect(placed.get('Objectives & Specific Aims')?.body).not.toContain('Phase one designs')
  })

  it('handles Word headings applied as styles, not just numbered text', async () => {
    const { text } = await extractTextFromDocumentBytes(await buildStyledDocx(), 'proposal.docx')
    const placed = mapExtractedText(text)

    expect(placed.get('Summary / Abstract')?.body).toContain('low-cost sensor network')
    expect(placed.get('Methodology / Approach')?.body).toContain('Phase one designs')
    expect(placed.get('Budget & Justification')?.body).toContain('Equipment costs')
  })

  it('handles a table-based application form and ignores its cover title', async () => {
    const { text } = await extractTextFromDocumentBytes(await buildTableFormDocx(), 'form.docx')
    const segments = splitProposalIntoSegments(text)

    // The form title must not be glued onto the first section's heading, or the
    // matcher stops recognising that section.
    expect(segments[0].heading).toBe('Objectives')

    const placed = mapExtractedText(text)
    expect(placed.get('Objectives & Specific Aims')?.body).toContain('forty nodes')
    expect(placed.get('Methodology / Approach')?.body).toContain('Phase one designs')
    expect(placed.get('Budget & Justification')?.body).toContain('Equipment costs')
  })

  it('rejects a legacy .doc with a message that says what to do instead', async () => {
    await expect(extractTextFromDocumentBytes(legacyDocBytes(), 'proposal.doc')).rejects.toThrow(
      /Save As to create a \.docx/
    )
    // Detected from the file signature too, whatever the file is named.
    await expect(extractTextFromDocumentBytes(legacyDocBytes(), 'proposal.txt')).rejects.toThrow(
      /old Word \.doc file/
    )
  })

  it('parses a real PDF into line-separated text the splitter can cut up', async () => {
    const bytes = await readFile(REAL_PDF_PATH)
    const { text, kind } = await extractTextFromDocumentBytes(bytes, 'proposal.pdf')

    expect(kind).toBe('pdf')
    // Line structure is what the splitter depends on; a PDF that extracted as
    // one continuous blob would silently import as a single section.
    expect(text.split('\n').filter((line) => line.trim()).length).toBeGreaterThan(20)

    const segments = splitProposalIntoSegments(text)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.some((segment) => segment.heading && segment.body)).toBe(true)
  })

  it('reads a plain text upload without a parser', async () => {
    const { text, kind } = await extractTextFromDocumentBytes(
      Buffer.from(PROPOSAL_LINES.join('\n'), 'utf8'),
      'proposal.txt'
    )

    expect(kind).toBe('text')
    expect(mapExtractedText(text).get('Methodology / Approach')?.body).toContain('Phase one designs')
  })
})
