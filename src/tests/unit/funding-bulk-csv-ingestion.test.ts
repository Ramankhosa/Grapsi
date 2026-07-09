import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'

import { extractCsvIntakesFromZip } from '@/lib/fundingIntake/bulkCsvIngestion'

function csvFor(agency: string, title: string): string {
  return [
    'field,value',
    `agency_name,${agency}`,
    `scheme_title,${title}`,
    `description,Funds ${title} research.`,
    'close_date,2026-09-30',
    'priority,Advance the field',
    'document_url,https://agency.example.org/call.pdf',
  ].join('\n')
}

function zipWith(files: Record<string, string>): Buffer {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, 'utf8'))
  }
  return zip.toBuffer()
}

describe('bulk CSV zip ingestion', () => {
  it('turns each CSV entry into an auto-draft JSON batch job in stable order', () => {
    const buffer = zipWith({
      'b-call.csv': csvFor('NSF', 'AI for Health'),
      'a-call.csv': csvFor('NIH', 'Quantum Materials'),
    })

    const result = extractCsvIntakesFromZip(buffer, { operatorNotes: 'June batch' })

    expect(result.totalCsvFiles).toBe(2)
    expect(result.parsedCount).toBe(2)
    expect(result.failedCount).toBe(0)
    // Entries are sorted by name so jobs/results are deterministic.
    expect(result.results.map((item) => item.name)).toEqual(['a-call.csv', 'b-call.csv'])
    expect(result.results[0]).toMatchObject({ ok: true, agencyName: 'NIH', schemeTitle: 'Quantum Materials' })

    expect(result.jobs).toHaveLength(2)
    const job = result.jobs[0]
    expect(job.autoCreateDraft).toBe(true)
    expect(job.extractAll).toBe(true)
    expect(job.operatorNotes).toBe('June batch')
    expect(job.sources).toHaveLength(1)
    expect(job.sources[0].inputType).toBe('json')
    // The JSON source carries the same intake object the single-CSV path produces.
    const intake = JSON.parse(job.sources[0].sourceJsonText || '{}')
    expect(intake.call.fields.agency_name).toBe('NIH')
    expect(intake.document_urls).toContain('https://agency.example.org/call.pdf')
  })

  it('records a per-file error for an unparseable CSV without dropping the good ones', () => {
    const buffer = zipWith({
      'good.csv': csvFor('NSF', 'AI for Health'),
      'bad.csv': 'this is not,a funding call\nnonsense,row',
    })

    const result = extractCsvIntakesFromZip(buffer)

    expect(result.totalCsvFiles).toBe(2)
    expect(result.parsedCount).toBe(1)
    expect(result.failedCount).toBe(1)
    const bad = result.results.find((item) => item.name === 'bad.csv')
    expect(bad?.ok).toBe(false)
    expect(bad?.error).toBeTruthy()
  })

  it('ignores directories, macOS resource forks, and non-CSV files', () => {
    const buffer = zipWith({
      'calls/one.csv': csvFor('NSF', 'AI for Health'),
      '__MACOSX/._one.csv': 'junk',
      'readme.txt': 'not a csv',
      '.hidden.csv': 'field,value\nagency_name,Ghost',
    })

    const result = extractCsvIntakesFromZip(buffer)

    expect(result.totalCsvFiles).toBe(1)
    expect(result.results[0].name).toBe('calls/one.csv')
  })

  it('throws a friendly error when the buffer is not a valid zip', () => {
    expect(() => extractCsvIntakesFromZip(Buffer.from('not a zip at all'))).toThrow(/valid \.zip/i)
  })
})
