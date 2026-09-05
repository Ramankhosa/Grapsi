import { describe, expect, it } from 'vitest'

import { registerToCsv, type RegisterRow } from '@/lib/proposals/register'

/**
 * The register leaves this system as a spreadsheet somebody else opens, which
 * is exactly where a quoting mistake stops being cosmetic.
 */

function row(overrides: Partial<RegisterRow> = {}): RegisterRow {
  return {
    school: 'School of Sciences',
    department: 'Physics',
    pi: 'Dr Neha Sharma',
    employeeId: 'EMP-1001',
    designation: 'Professor',
    title: 'Coastal resilience mapping',
    agency: 'DST',
    scheme: 'SERB Core',
    status: 'Submitted to agency',
    versions: 2,
    lastScore: '6.4',
    reviewsShared: 1,
    cutoff: '2026-09-15',
    agencyDeadline: '2026-09-18',
    clearedOn: '2026-09-16',
    submittedOn: '2026-09-17',
    reference: 'REF/2026/77',
    requested: '1600000',
    sanctioned: '',
    currency: 'INR',
    sanctionOrder: '',
    coInvestigators: 'Dr A Rao; Dr B Iyer (external)',
    createdOn: '2026-08-01',
    ...overrides,
  }
}

describe('registerToCsv', () => {
  it('writes a header and one line per proposal', () => {
    const csv = registerToCsv([row(), row({ title: 'Second' })])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Principal Investigator')
    expect(lines[0]).toContain('Amount sanctioned')
  })

  it('quotes a field containing a comma, so columns do not shift', () => {
    const csv = registerToCsv([row({ title: 'Water, energy and food' })])
    expect(csv).toContain('"Water, energy and food"')
  })

  it('doubles an embedded quote rather than ending the field early', () => {
    const csv = registerToCsv([row({ title: 'The "resilience" question' })])
    expect(csv).toContain('"The ""resilience"" question"')
  })

  it('keeps a multi-line note inside one cell', () => {
    const csv = registerToCsv([row({ coInvestigators: 'Dr A Rao\nDr B Iyer' })])
    expect(csv).toContain('"Dr A Rao\nDr B Iyer"')
  })

  it('defuses a title Excel would run as a formula', () => {
    // A proposal titled "=cmd|..." is a spreadsheet injection, not a title.
    const csv = registerToCsv([row({ title: '=HYPERLINK("http://evil","click")' })])
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toMatch(/,=HYPERLINK/)
  })

  it('renders an empty column as empty, never as "null"', () => {
    const csv = registerToCsv([row({ sanctioned: '', sanctionOrder: '' })])
    expect(csv).not.toContain('null')
    expect(csv).not.toContain('undefined')
  })
})
