import { describe, expect, it } from 'vitest'
import { reconcileFacultyRoster, type RosterFields, type RosterUnit } from '@/lib/faculty/reconcileRoster'

const units: RosterUnit[] = [{ id: 's', name: 'CSE', parentId: null, active: true }, { id: 'd', name: 'Programming', parentId: 's', active: true },
  { id: 's2', name: 'Applications', parentId: null, active: true }, { id: 'd2', name: 'Programming', parentId: 's2', active: true }]
const existing = [{ id: 'old', email: 'old@lpu.edu', employeeId: '100', unitId: 'd' }]
const row = (patch: Partial<RosterFields> = {}): RosterFields => ({ name: 'Researcher', email: 'new@lpu.edu', school: 'CSE', department: 'Programming', researchSummary: 'Research on learning algorithms', ...patch })
const check = (rows: RosterFields[]) => reconcileFacultyRoster(rows, existing, units)

describe('additional faculty data preflight', () => {
  it('is a read-only plan with a resolved new person', () => expect(check([row()])).toMatchObject({ previewOnly: true, summary: { new: 1 }, rows: [{ unitId: 'd', disposition: 'NEW' }] }))
  it('normalises email case and whitespace to match an existing person', () => expect(check([row({ email: ' OLD@LPU.EDU ' })]).rows[0]).toMatchObject({ disposition: 'UPDATE', existingId: 'old' }))
  it('requires address reconciliation when an employee ID exists under another email', () => {
    const result = check([row({ employeeId: '100' })]).rows[0]
    expect(result.disposition).toBe('REVIEW'); expect(result.issues.join(' ')).toContain('different email')
  })
  it('blocks an employee ID that conflicts with an existing email identity', () => expect(check([row({ email: 'old@lpu.edu', employeeId: '999' })]).rows[0].issues.join(' ')).toContain('Employee ID differs'))
  it('flags every occurrence of duplicated emails rather than keeping the first', () => {
    const result = check([row(), row({ email: 'NEW@lpu.edu' })])
    expect(result.summary.review).toBe(2); expect(result.rows.every(r => r.issues.join(' ').includes('Duplicate email'))).toBe(true)
  })
  it('blocks duplicated staff numbers within the batch', () => expect(check([row({ employeeId: '200' }), row({ email: 'b@lpu.edu', employeeId: '200' })]).summary.review).toBe(2))
  it('resolves same-named departments within their actual school', () => expect(check([row({ school: 'Applications' })]).rows[0].unitId).toBe('d2'))
  it('uses an explicit hierarchy path before loose school/department columns', () => expect(check([row({ unitPath: 'Applications > Programming' })]).rows[0].unitId).toBe('d2'))
  it('never creates units for unknown spelling variations', () => {
    const result = check([row({ school: 'C S E' })]).rows[0]
    expect(result.disposition).toBe('REVIEW'); expect(result.unitId).toBeNull()
  })
  it('does not infer actual reporting placement from research evidence', () => expect(check([row({ school: '', department: '' })]).rows[0].issues.join(' ')).toContain('do not infer'))
  it('preserves an existing placement when the file omits placement columns', () => {
    const result = check([{ name: 'Researcher', email: 'old@lpu.edu' }]).rows[0]
    expect(result.unitId).toBe('d'); expect(result.disposition).toBe('UPDATE')
  })
  it('flags explicit blanks instead of silently erasing existing research fields', () => expect(check([row({ email: 'old@lpu.edu', researchSummary: '' })]).rows[0].issues.join(' ')).toContain('preserve-or-clear'))
  it('flags proposed placement changes for identity/HR review', () => expect(check([row({ email: 'old@lpu.edu', school: 'Applications' })]).rows[0].issues.join(' ')).toContain('verify the move'))
  it('does not count repeated uploads as new people', () => expect(check([row({ email: 'old@lpu.edu' })]).summary).toMatchObject({ new: 0, updates: 1 }))
  it('requires research evidence for a new person', () => expect(check([row({ researchSummary: '' })]).rows[0].issues.join(' ')).toContain('Research evidence is missing'))
  it('rejects an incomplete email', () => expect(check([row({ email: 'missing' })]).rows[0].disposition).toBe('REVIEW'))
})
