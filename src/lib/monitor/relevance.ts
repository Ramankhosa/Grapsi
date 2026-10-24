/** Cheap, deliberately high-recall screening. Absence of a keyword is uncertainty. */
export const RELEVANCE_VERSION = 'relevance-1'
export type RelevanceOutcome = 'STRONG_POSITIVE' | 'UNCERTAIN' | 'STRONG_NEGATIVE'
export function tokens(text: string): string[] {
  return text.normalize('NFC').toLocaleLowerCase('en').match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
}
const POSITIVE = [
  'grant', 'grants', 'funding', 'fellowship', 'fellowships', 'scholarship', 'scholarships',
  'call for proposals', 'research proposal', 'financial assistance', 'seed fund', 'extramural',
  'अनुदान', 'वित्तपोषण', 'छात्रवृत्ति', 'अध्येतावृत्ति', 'प्रस्ताव आमंत्रित', 'प्रस्तावों',
]
const APPLICATION = ['apply', 'application', 'applications', 'deadline', 'closing', 'proposal', 'proposals', 'आवेदन', 'अंतिम तिथि']
const NEGATIVE = ['privacy policy', 'cookie policy', 'terms of use', 'accessibility statement', 'sitemap', 'login', 'sign in', 'contact us']
function normal(text: string) { return ` ${tokens(text).join(' ')} ` }
function hits(text: string, phrases: string[]) { return phrases.filter(p => text.includes(normal(p))) }
export interface RelevanceConfig { include?: string[]; exclude?: string[]; languages?: string[] }
export function scoreRelevance(title: string, context: string, url: string, config: RelevanceConfig = {}) {
  const primary = normal(title)
  const all = normal(`${title} ${context} ${url.replace(/[/_-]/g, ' ')}`)
  const positive = hits(all, [...POSITIVE, ...(config.include ?? [])])
  const applications = hits(all, APPLICATION)
  const excludes = hits(primary, config.exclude ?? [])
  // A funding word outweighs a general navigation negative, but never an
  // explicit reviewer-authored exclusion. These decisions are audit sampled.
  const negative = excludes.length > 0 || (positive.length === 0 && NEGATIVE.some(n => primary === normal(n)))
  const score = positive.length * 3 + Math.min(2, applications.length)
  const outcome: RelevanceOutcome = negative ? 'STRONG_NEGATIVE' : positive.length > 0 ? 'STRONG_POSITIVE' : 'UNCERTAIN'
  return { outcome, score, reasons: [...positive, ...applications, ...excludes].slice(0, 8), policy: RELEVANCE_VERSION }
}

/** Similarity retrieves candidates only; it never proves a duplicate. */
export function jaccard(a: string, b: string): number {
  const left = new Set(tokens(a)); const right = new Set(tokens(b))
  const union = new Set([...left, ...right]).size
  return union ? [...left].filter(t => right.has(t)).length / union : 0
}
