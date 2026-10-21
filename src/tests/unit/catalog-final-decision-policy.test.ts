import { describe, it, expect } from 'vitest'
import { finalDecision } from '@/lib/fundingCatalogImport/finalDecisionPolicy'
const call = { title: 'Identical grant', agency: 'Agency A', source: 'https://agency.example/grant', description: 'Identical factual description. '.repeat(10), eligibility: 'Any researcher', amount: 'USD 5000', deadline: '{"close":"2027-01-01","sourceClosed":null}', disciplines: ['science'], countryRequirements: { applicant_scope: 'ANY' }, imported: true, catalogStatus: 'STAGED', visibility: 'GLOBAL_CATALOG' }
const snapshot = { reason: 'POSSIBLE_DUPLICATE', subject: call, candidate: { ...call } }
const result: any = { decision: 'SAME_OPPORTUNITY', confidence: .99, conflicts: ['DUPLICATE_LISTING'], explanation: 'Identical stored facts on both listings.', evidence: [{ side: 'subject', field: 'title', quote: call.title }, { side: 'candidate', field: 'title', quote: call.title }], suggestedFacts: [] }
describe('authorized final AI decisions', () => {
  it('archives only exact matching imported listings', () => expect(finalDecision(result, snapshot)).toBe('exact_duplicate'))
  it.each([{ title: 'Different grant' }, { eligibility: 'Only US citizens' }, { amount: 'USD 10000' }, { source: 'https://different.example' }, { countryRequirements: { applicant_scope: 'COUNTRIES' } }, { disciplines: ['arts'] }, { imported: false }, { visibility: 'GLOBAL_PUBLISHED' }, { catalogStatus: 'PUBLISHED' }, { descriptionTruncated: true }])('preserves a changed or protected candidate %j', change => {
    expect(finalDecision(result, { ...snapshot, candidate: { ...call, ...change } })).toBeNull()
  })
  it('does not archive listing variants just because the model is confident', () => {
    expect(finalDecision({ ...result, conflicts: ['ELIGIBILITY_CONFLICT'] }, snapshot)).toBeNull()
    expect(finalDecision({ ...result, confidence: .97 }, snapshot)).toBeNull()
  })
  it('allows keeping two well-supported opportunities with different funders and sources', () => {
    const candidate = { ...call, title: 'Another grant', agency: 'Agency B', source: 'https://agency-b.example/grant' }
    expect(finalDecision({ ...result, decision: 'SEPARATE_OPPORTUNITIES', confidence: .97, conflicts: ['FUNDER_CONFLICT', 'RELATED_PROGRAM'] }, { ...snapshot, candidate })).toBe('distinct')
  })
  it('keeps source conflicts and uncertain or missing facts held', () => {
    for (const decision of ['UNCERTAIN', 'NEEDS_INFORMATION']) expect(finalDecision({ ...result, decision }, snapshot)).toBeNull()
    expect(finalDecision({ ...result, decision: 'SEPARATE_OPPORTUNITIES', conflicts: ['SOURCE_CONFLICT'] }, snapshot)).toBeNull()
  })
})
