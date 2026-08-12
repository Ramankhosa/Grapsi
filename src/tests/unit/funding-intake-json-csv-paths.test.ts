import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'

import { extractCsvIntakesFromZip } from '@/lib/fundingIntake/bulkCsvIngestion'
import {
  resolveBatchSourceAssignments,
  stampSourceDocumentKind,
} from '@/lib/fundingIntake/batchSourceMapping'
import { parseFundingCsvUpload } from '@/lib/fundingIntake/csvIngestion'
import {
  parseFundingJsonUpload,
  prepareFundingJsonIntake,
  readPreparedFundingJsonArtifacts,
} from '@/lib/fundingIntake/jsonIngestion'

const CSV = [
  'field,value',
  'agency_name,DST',
  'scheme_title,Clean Energy Mission',
  'description,Funds clean energy research across India.',
  'close_date,2026-09-30',
  'priority,Advance grid-scale storage',
  'budget_rule,Overheads capped at 20 percent',
  'template_section,"Project Summary: 500 words max"',
  'template_question,"Objectives: list up to five"',
  'document_url,https://agency.example.org/call.pdf',
].join('\n')

/**
 * Mirrors how prepareJobSourceData composes a JSON source's fetch metadata, so
 * these tests exercise the real artifact blob the batch path stamps.
 */
function buildJsonSourceMetadata(csvText: string) {
  const intakeObject = parseFundingCsvUpload(csvText)
  const parsed = parseFundingJsonUpload(JSON.stringify(intakeObject))
  const prepared = prepareFundingJsonIntake(parsed)

  return {
    json_upload: {
      ...prepared.metadata,
      original_name: 'call.csv',
      mime: 'text/csv',
      bytes: Buffer.byteLength(csvText, 'utf8'),
      checksum: 'abc123',
    },
    json_artifacts: {
      grant_template_json: prepared.template || null,
      guideline_pack_json: prepared.guidelinePack || null,
      document_urls: prepared.documentUrls || [],
    },
  }
}

describe('JSON and CSV intake survive document-kind stamping', () => {
  it('keeps the imported template, guideline pack and document URLs after stamping', () => {
    const metadata = buildJsonSourceMetadata(CSV)

    // Sanity: the artifacts exist before stamping.
    const before = readPreparedFundingJsonArtifacts(metadata)
    expect(before.template).not.toBeNull()
    expect(before.guidelinePack).not.toBeNull()
    expect(before.documentUrls).toContain('https://agency.example.org/call.pdf')

    const stamped = stampSourceDocumentKind(metadata, 'call_document')
    const after = readPreparedFundingJsonArtifacts(stamped)

    expect(stamped.document_kind).toBe('call_document')
    expect(after.template).toEqual(before.template)
    expect(after.guidelinePack).toEqual(before.guidelinePack)
    expect(after.documentUrls).toEqual(before.documentUrls)
    // json_upload must survive too — applied-call tracking reads from it.
    expect((stamped.json_upload as Record<string, unknown>).original_name).toBe('call.csv')
  })

  it('starts from an empty object for sources with no metadata yet', () => {
    expect(stampSourceDocumentKind(null, 'guideline_document')).toEqual({
      document_kind: 'guideline_document',
    })
    expect(stampSourceDocumentKind(undefined, 'call_document')).toEqual({
      document_kind: 'call_document',
    })
    // Prisma.JsonNull is an object with no own enumerable keys; it must not leak in.
    expect(stampSourceDocumentKind(['not', 'an', 'object'], 'call_document')).toEqual({
      document_kind: 'call_document',
    })
  })

  it('resolves the bulk-CSV job shape to a single call document', () => {
    const buffer = new AdmZip()
    buffer.addFile('call.csv', Buffer.from(CSV, 'utf8'))
    const extraction = extractCsvIntakesFromZip(buffer.toBuffer())

    expect(extraction.parsedCount).toBe(1)
    const job = extraction.jobs[0]

    // Bulk CSV sets every slot to source_1 and never tags a document kind.
    const assignment = resolveBatchSourceAssignments({
      sources: job.sources.map((source) => ({
        sourceKey: source.sourceKey,
        documentKind: source.documentKind || null,
      })),
      detailsSourceKey: job.detailsSourceKey,
      guidelinesSourceKey: job.guidelinesSourceKey,
      templateSourceKey: job.templateSourceKey,
    })

    expect(assignment).toEqual({
      detailsSourceKey: 'source_1',
      guidelinesSourceKey: 'source_1',
      templateSourceKey: 'source_1',
      documentKinds: { source_1: 'call_document' },
    })
  })

  it('keeps a single-source JSON upload valid without any document kind', () => {
    const assignment = resolveBatchSourceAssignments({
      sources: [{ sourceKey: 'source_1' }],
      detailsSourceKey: 'source_1',
      guidelinesSourceKey: 'source_1',
      templateSourceKey: 'source_1',
    })
    expect(assignment.documentKinds).toEqual({ source_1: 'call_document' })
  })
})
