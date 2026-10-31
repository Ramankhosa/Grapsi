/** Data-only preflight. It never creates users, units, embeddings or permissions. */
export type RosterFields = { name: string; email: string; employeeId?: string; unitPath?: string; school?: string; department?: string;
  researchAreas?: string; keywords?: string; researchSummary?: string }
export type ExistingFaculty = { id: string; email: string; employeeId: string | null; unitId: string | null }
export type RosterUnit = { id: string; name: string; parentId: string | null; active: boolean }
export type RosterPreflightRow = { row: number; name: string; email: string; existingId: string | null; unitId: string | null;
  disposition: 'NEW' | 'UPDATE' | 'REVIEW'; issues: string[] }
const normal = (s: string | null | undefined) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()

export function reconcileFacultyRoster(rows: RosterFields[], people: ExistingFaculty[], units: RosterUnit[]) {
  const frequencies = (values: string[]) => values.reduce((m, v) => { if (v) m.set(v, (m.get(v) || 0) + 1); return m }, new Map<string, number>())
  const emails = frequencies(rows.map(r => normal(r.email))), staffIds = frequencies(rows.map(r => normal(r.employeeId)))
  const activeUnits = units.filter(u => u.active)
  const result: RosterPreflightRow[] = rows.map((row, i) => {
    const issues: string[] = [], email = normal(row.email), staffId = normal(row.employeeId)
    if (!row.name.trim()) issues.push('Name is required.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push('A valid real email is required.')
    if ((emails.get(email) || 0) > 1) issues.push('Duplicate email in this file; reconcile every occurrence.')
    if (staffId && (staffIds.get(staffId) || 0) > 1) issues.push('Duplicate employee ID in this file; reconcile every occurrence.')
    const byEmail = people.filter(p => normal(p.email) === email), byStaff = staffId ? people.filter(p => normal(p.employeeId) === staffId) : []
    if (byEmail.length > 1 || byStaff.length > 1) issues.push('Existing identity is ambiguous.')
    const person = byEmail.length === 1 ? byEmail[0] : null
    if (byStaff.length === 1 && byStaff[0].id !== person?.id) issues.push(person ? 'Email and employee ID identify different existing people.' : 'Employee ID already exists under a different email; reconcile the address before importing.')
    if (person?.employeeId && staffId && normal(person.employeeId) !== staffId) issues.push('Employee ID differs from the existing profile; verify identity.')
    let unitId: string | null = null
    const chain = row.unitPath?.trim() ? row.unitPath.split('>').map(s => s.trim()) : [row.school, row.department].filter((s): s is string => Boolean(s?.trim()))
    if (!row.unitPath?.trim() && row.department?.trim() && !row.school?.trim()) issues.push('Department needs its parent school.')
    if (chain.length) {
      let parentId: string | null = null
      for (const name of chain) {
        const candidates = activeUnits.filter(u => u.parentId === parentId && normal(u.name) === normal(name))
        if (candidates.length !== 1) { issues.push(`Unknown or ambiguous unit path at "${name}"; resolve against the existing hierarchy.`); unitId = null; break }
        unitId = candidates[0].id; parentId = unitId
      }
    } else if (person?.unitId && activeUnits.some(u => u.id === person.unitId)) unitId = person.unitId
    else issues.push('School/department placement is missing; do not infer it from research interests.')
    if (person?.unitId && unitId && person.unitId !== unitId) issues.push('School/department placement would change; verify the move.')
    const research = [row.researchAreas, row.keywords, row.researchSummary].filter(v => v?.trim())
    if (!research.length && !person) issues.push('Research evidence is missing for this new person.')
    const blankFields = (['researchAreas', 'keywords', 'researchSummary', 'school', 'department'] as const).filter(k => Object.prototype.hasOwnProperty.call(row, k) && !row[k]?.trim())
    if (person && blankFields.length) issues.push(`Blank update fields need a preserve-or-clear decision: ${blankFields.join(', ')}.`)
    return { row: i + 2, name: row.name.trim(), email, existingId: person?.id || byStaff[0]?.id || null, unitId,
      disposition: issues.length ? 'REVIEW' : person ? 'UPDATE' : 'NEW', issues }
  })
  return { previewOnly: true as const, rows: result, summary: { total: result.length, new: result.filter(r => r.disposition === 'NEW').length,
    updates: result.filter(r => r.disposition === 'UPDATE').length, review: result.filter(r => r.disposition === 'REVIEW').length } }
}
