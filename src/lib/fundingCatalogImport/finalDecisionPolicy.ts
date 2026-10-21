import { canApproveDistinct, type Recommendation } from './aiReviewPolicy'

const norm = (v: unknown) => String(v || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const canonical = (v: any): string => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map(canonical).sort() : Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v)
function deadline(v: string) {
  try { const d = JSON.parse(v); return canonical({ ...d, sourceClosed: Boolean(d.sourceClosed) }) } catch { return v }
}
function years(title: string) { return [...title.matchAll(/\b20\d{2}\b/g)].map(m => m[0]).sort().join(',') }

/** Operator-approved finalization: no publication, editing facts or deleting records. */
export function finalDecision(result: Recommendation, snapshot: any): 'distinct' | 'exact_duplicate' | null {
  const a = snapshot.subject, b = snapshot.candidate
  if (snapshot.reason !== 'POSSIBLE_DUPLICATE' || !a || !b || !a.imported || a.catalogStatus !== 'STAGED' || a.visibility !== 'GLOBAL_CATALOG') return null
  if (!b.imported || b.visibility !== 'GLOBAL_CATALOG') return null
  if (a.descriptionTruncated || b.descriptionTruncated || a.eligibilityTruncated || b.eligibilityTruncated) return null
  if (!result.evidence.some(e => e.side === 'subject') || !result.evidence.some(e => e.side === 'candidate')) return null
  if (canApproveDistinct(result, snapshot)) return 'distinct'
  if (result.decision === 'SEPARATE_OPPORTUNITIES' && result.confidence >= .95 &&
      result.conflicts.every(c => ['RELATED_PROGRAM', 'DIFFERENT_ROUND', 'FUNDER_CONFLICT', 'AMOUNT_CONFLICT', 'DEADLINE_CONFLICT'].includes(c))) {
    const differentFunders = norm(a.agency) && norm(b.agency) && norm(a.agency) !== norm(b.agency)
    const differentSources = a.source && b.source && norm(a.source) !== norm(b.source)
    const differentRounds = years(a.title) && years(b.title) && years(a.title) !== years(b.title) && deadline(a.deadline) !== deadline(b.deadline)
    if ((differentFunders && differentSources && norm(a.title) !== norm(b.title)) || differentRounds) return 'distinct'
  }
  if (result.decision !== 'SAME_OPPORTUNITY' || result.confidence < .98 ||
      result.conflicts.some(c => c !== 'DUPLICATE_LISTING') || !b.imported || b.catalogStatus !== 'STAGED' || b.visibility !== 'GLOBAL_CATALOG') return null
  // Restrict archiving to identical listings. Variants, complementary eligibility,
  // changed dates or metadata remain held even when the model calls them the same.
  if (norm(a.title) !== norm(b.title) || !a.source || norm(a.source) !== norm(b.source) ||
      !a.agency || norm(a.agency) !== norm(b.agency) || norm(a.description).length < 100 ||
      norm(a.description) !== norm(b.description) || norm(a.eligibility) !== norm(b.eligibility) ||
      norm(a.amount) !== norm(b.amount) || deadline(a.deadline) !== deadline(b.deadline) ||
      canonical(a.disciplines) !== canonical(b.disciplines) || canonical(a.countryRequirements) !== canonical(b.countryRequirements)) return null
  return 'exact_duplicate'
}
