import { describe, expect, it } from 'vitest'
import { buildSchoolRoutingPreview, routingSnapshotStatus, type PreviewMatch, type PreviewSchool } from '../researcherRoutingPolicy'
import { CALL_MATCH_CENSUS_VERSION, CENSUS_FRESH_MS } from '@/lib/researcherMatching/config'

const school: PreviewSchool = { id: 'biotech', name: 'Biotechnology', coordinator: 'Officer', institutional: false }
const match = (patch: Partial<PreviewMatch> = {}): PreviewMatch => ({ userId: 'a', name: 'Faculty A', schoolId: 'biotech',
  unitId: 'dept', unitName: 'Microbiology', actualSchoolId: 'biotech', score: .8, storedBand: 'weak', reason: 'Microbial research',
  inferred: false, sourceVersion: CALL_MATCH_CENSUS_VERSION, current: true, careerStage: null, institutionType: null, ...patch })
const eligibility = { careerStages: [], institutionTypes: [] }

describe('researcher-based school preview policy', () => {
  it('counts and lists exactly eight individuals rather than expanding to a school roster', () => {
    const matches = Array.from({ length: 8 }, (_, i) => match({ userId: `faculty-${i}` }))
    const [row] = buildSchoolRoutingPreview([school], matches, 'NARROW', eligibility)
    expect(row.matchingPeople).toBe(8); expect(row.people).toHaveLength(8); expect(row.status).toBe('RESEARCHER_FIT')
  })
  it('uses the configured score width rather than the saved tier', () => {
    const rows = [match({ score: .4, storedBand: 'strong' })]
    expect(buildSchoolRoutingPreview([school], rows, 'NARROW', eligibility)[0].matchingPeople).toBe(0)
    expect(buildSchoolRoutingPreview([school], rows, 'WIDE', eligibility)[0].matchingPeople).toBe(1)
  })
  it('does not propose school workload from a weak nearest neighbour', () => {
    const [row] = buildSchoolRoutingPreview([school], [match({ score: .3 })], 'NARROW', eligibility)
    expect(row).toMatchObject({ status: 'BORDERLINE_REVIEW', matchingPeople: 0, borderlinePeople: 1 })
  })
  it.each([{ inferred: true }, { current: false }, { sourceVersion: 'person-call-census-v1' }, { sourceVersion: 'manual-allocation-v1' },
    { sourceVersion: null }, { score: null }, { score: Number.NaN }])('excludes unverified/historical rows: %j', patch => {
    expect(buildSchoolRoutingPreview([school], [match(patch)], 'NARROW', eligibility)[0].matchingPeople).toBe(0)
  })
  it('excludes a researcher who moved schools instead of assigning their expertise to both', () => {
    const [row] = buildSchoolRoutingPreview([school], [match({ actualSchoolId: 'cse' })], 'NARROW', eligibility)
    expect(row).toMatchObject({ matchingPeople: 0, placementConflicts: 1 })
  })
  it('does not invent placement for a researcher without an active unit', () => {
    const [row] = buildSchoolRoutingPreview([school], [match({ actualSchoolId: null, unitId: null })], 'NARROW', eligibility)
    expect(row).toMatchObject({ matchingPeople: 0, placementConflicts: 1 })
  })
  it('deduplicates a researcher by identity and retains their strongest evidence', () => {
    const [row] = buildSchoolRoutingPreview([school], [match({ score: .55 }), match({ score: .9 }), match({ score: .2 })], 'NARROW', eligibility)
    expect(row.matchingPeople).toBe(1); expect(row.borderlinePeople).toBe(0); expect(row.people[0].score).toBe(.9)
  })
  it('retains institutional review with zero matched faculty', () => {
    expect(buildSchoolRoutingPreview([{ ...school, institutional: true }], [], 'NARROW', eligibility)[0]).toMatchObject({ status: 'INSTITUTIONAL_REVIEW', matchingPeople: 0 })
  })
  it('does not declare a medical-AI match an eligible clinical PI', () => {
    const [row] = buildSchoolRoutingPreview([school], [match({ reason: 'Medical image analysis' })], 'NARROW', eligibility)
    expect(row.people[0].eligibility).toBe('REVIEW_REQUIRED')
  })
  it('keeps research relevance separate from a recorded eligibility conflict', () => {
    const [row] = buildSchoolRoutingPreview([school], [match({ careerStage: 'established' })], 'NARROW', { careerStages: ['early'], institutionTypes: [] })
    expect(row.matchingPeople).toBe(1); expect(row.people[0].eligibility).toBe('KNOWN_CONFLICT')
  })
  it('does not interpret a missing result as proof of no capability', () => {
    expect(buildSchoolRoutingPreview([school], [], 'NARROW', eligibility)[0].explanation).toContain('not proof')
  })
})

describe('saved routing result readiness', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  const snapshot = { version: CALL_MATCH_CENSUS_VERSION, fingerprint: 'current', basis: 'rerank', refreshedAt: now.toISOString() }
  it('distinguishes a missing snapshot', () => expect(routingSnapshotStatus(null, 'current', now)).toBe('MISSING'))
  it('accepts only the unchanged, recent reranked snapshot as recorded', () => expect(routingSnapshotStatus(snapshot, 'current', now)).toBe('RECORDED'))
  it.each([{ fingerprint: 'old' }, { version: 'old' }, { refreshedAt: 'invalid' }, { refreshedAt: new Date(now.getTime() - CENSUS_FRESH_MS - 1).toISOString() },
    { refreshedAt: new Date(now.getTime() + 120000).toISOString() }])('marks stale state %j', patch => expect(routingSnapshotStatus({ ...snapshot, ...patch }, 'current', now)).toBe('STALE'))
  it('does not certify a text/vector fallback as validated reranking', () => expect(routingSnapshotStatus({ ...snapshot, basis: 'vector' }, 'current', now)).toBe('UNVERIFIED'))
})
