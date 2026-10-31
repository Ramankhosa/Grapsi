import { CALL_MATCH_CENSUS_VERSION, CENSUS_FRESH_MS } from '@/lib/researcherMatching/config'
import { bandForScore, type MatchWidth } from './matchBands'
import { isQualifyingMatch } from './reportDefinitions'

export type RoutingSnapshot = {
  version: string; fingerprint: string; basis: string; refreshedAt: string
} | null
export type SnapshotStatus = 'MISSING' | 'STALE' | 'UNVERIFIED' | 'RECORDED'
export function routingSnapshotStatus(snapshot: RoutingSnapshot, fingerprint: string, now = new Date()): SnapshotStatus {
  if (!snapshot) return 'MISSING'
  const age = now.getTime() - new Date(snapshot.refreshedAt).getTime()
  if (!Number.isFinite(age) || age < -60_000 || age > CENSUS_FRESH_MS || snapshot.fingerprint !== fingerprint || snapshot.version !== CALL_MATCH_CENSUS_VERSION) return 'STALE'
  return snapshot.basis === 'rerank' ? 'RECORDED' : 'UNVERIFIED'
}

export type PreviewMatch = {
  userId: string; name: string; schoolId: string; unitId: string | null; unitName: string | null
  actualSchoolId: string | null; score: number | null; storedBand: string | null
  reason: string | null; inferred: boolean; sourceVersion: string | null; current: boolean
  careerStage: string | null; institutionType: string | null
}
export type PreviewSchool = { id: string; name: string; coordinator: string | null; institutional: boolean }
export type PreviewPerson = {
  id: string; name: string; unitName: string | null; score: number; band: 'strong' | 'moderate'
  reason: string; eligibility: 'REVIEW_REQUIRED' | 'KNOWN_CONFLICT'; eligibilityNotes: string[]
}
export type SchoolRoutingPreview = PreviewSchool & {
  status: 'RESEARCHER_FIT' | 'BORDERLINE_REVIEW' | 'INSTITUTIONAL_REVIEW' | 'NO_RECORDED_FIT'
  people: PreviewPerson[]; matchingPeople: number; strongPeople: number; borderlinePeople: number
  placementConflicts: number; explanation: string
}

function eligibilityNotes(person: PreviewMatch, call: { careerStages: string[]; institutionTypes: string[] }) {
  const notes: string[] = []
  const matches = (values: string[], value: string) => values.some(v => v.toLowerCase() === value.toLowerCase())
  if (call.careerStages.length && person.careerStage && !matches(call.careerStages, person.careerStage)) notes.push('Recorded career stage does not match the call.')
  if (call.institutionTypes.length && person.institutionType && !matches(call.institutionTypes, person.institutionType)) notes.push('Recorded institution type does not match the call.')
  return notes
}

/** Pure preview policy. No writes, search/provider calls, notification or allocation. */
export function buildSchoolRoutingPreview(schools: PreviewSchool[], matches: PreviewMatch[], width: MatchWidth,
  eligibility: { careerStages: string[]; institutionTypes: string[] }): SchoolRoutingPreview[] {
  return schools.map(school => {
    const people = new Map<string, PreviewPerson>(), borderline = new Set<string>(), conflicts = new Set<string>()
    for (const m of matches) {
      if (m.schoolId !== school.id || !m.current || m.inferred || m.sourceVersion !== CALL_MATCH_CENSUS_VERSION || m.score === null || !Number.isFinite(m.score)) continue
      if (m.actualSchoolId !== school.id || !m.unitId) { conflicts.add(m.userId); continue }
      const counted = isQualifyingMatch({ inferred: m.inferred, source_version: m.sourceVersion, match_tier: m.storedBand, match_score: m.score, first_seen_at: new Date(0) }, null, width)
      if (!counted) { borderline.add(m.userId); continue }
      const notes = eligibilityNotes(m, eligibility)
      const person: PreviewPerson = { id: m.userId, name: m.name, unitName: m.unitName, score: m.score,
        band: bandForScore(m.score, width) as 'strong' | 'moderate', reason: m.reason || 'Saved research match; supporting evidence needs review.',
        eligibility: notes.length ? 'KNOWN_CONFLICT' : 'REVIEW_REQUIRED',
        eligibilityNotes: notes.length ? notes : ['Full call eligibility and lead-investigator requirements have not been verified.'] }
      if (!people.has(m.userId) || people.get(m.userId)!.score < m.score) people.set(m.userId, person)
    }
    for (const id of people.keys()) borderline.delete(id)
    const list = [...people.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    const status = list.length ? 'RESEARCHER_FIT' : borderline.size ? 'BORDERLINE_REVIEW' : school.institutional ? 'INSTITUTIONAL_REVIEW' : 'NO_RECORDED_FIT'
    const explanation = status === 'RESEARCHER_FIT' ? 'These individuals support school relevance. Review evidence and eligibility before creating responsibility.'
      : status === 'BORDERLINE_REVIEW' ? 'Only below-threshold suggestions are recorded. Central review is needed; do not create school workload from these alone.'
      : status === 'INSTITUTIONAL_REVIEW' ? 'An active institutional mapping exists, but no qualifying individual is recorded. Review the school scope separately.'
      : 'No qualifying stored researcher match or active institutional mapping. This is not proof that the school lacks relevant expertise.'
    return { ...school, status, people: list, matchingPeople: list.length, strongPeople: list.filter(p => p.band === 'strong').length,
      borderlinePeople: borderline.size, placementConflicts: conflicts.size, explanation }
  })
}
