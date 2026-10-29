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

/**
 * Pages that need no reading at all. Applied only to a page with no funding
 * word in its title, link context or address (and none of the source's own
 * keywords), so a news item announcing a call, or an event page for a
 * fellowship, is still read. 29 Oct 2026: on production nearly every link on
 * a site was queued for the laptop; a sitemap alone gave nsf.gov 4,000 pages of
 * events and award-winner profiles.
 */
const FUNDING_PATH = /fund|grant|fellow|scholar|bursar|stipend|call|opportunit|programme|program|scheme|award|apply|applica|proposal|solicitation|nofo|rfp|foerder|forder|förder|ausschreib|bewerb|bourse|subvention|financ|finansi|beca|bidrag|anslag|utlys|ansøg|ansog|opslag|bevill|anudan|yojana|yojna/i
const NOISE_SEGMENTS = new Set([
  'event', 'events', 'webinar', 'webinars', 'news', 'nyheder', 'nyheter', 'nieuws', 'aktuelles', 'aktuelt', 'actualites', 'actualités',
  'press', 'press-releases', 'pressreleases', 'pressemitteilungen', 'media', 'blog', 'blogs', 'podcast', 'podcasts', 'video', 'videos', 'gallery',
  'people', 'staff', 'team', 'our-people', 'directory', 'recipients', 'awardees', 'laureates', 'honorary-awards', 'alumni',
  'forschungsradar', 'gepris', 'jobs', 'careers', 'vacancies', 'tag', 'tags', 'category', 'author',
])
export type ShortlistSkip = 'SITEMAP_NOT_FUNDING' | 'NOT_FUNDING_SECTION' | 'OLD_DATED_PAGE'
export const SHORTLIST_REASONS: Record<ShortlistSkip, string> = {
  SITEMAP_NOT_FUNDING: 'Sitemap entry outside the funding pages, with no funding word',
  NOT_FUNDING_SECTION: 'Event, news, people or archive page with no funding word',
  OLD_DATED_PAGE: 'Dated page from before last year, with no funding word',
}
export function shortlistSkip(url: string, onlyInSitemaps: boolean, now = new Date()): ShortlistSkip | null {
  let path: string
  try { path = decodeURIComponent(new URL(url).pathname).toLowerCase() } catch { return null }
  // Call documents often sit under /media/ or /wp-content/; a document is always read.
  if (/\.(pdf|docx?|xlsx?|odt|rtf|zip)$/.test(path)) return null
  const segments = path.split('/').filter(Boolean)
  if (segments.some(s => NOISE_SEGMENTS.has(s))) return 'NOT_FUNDING_SECTION'
  const dated = path.match(/(?:^|\/|-)(20\d{2})[-/](0[1-9]|1[0-2])(?:[-/](0[1-9]|[12]\d|3[01]))?(?:\/|-|$)/)
  if (dated && Number(dated[1]) < now.getUTCFullYear() - 1) return 'OLD_DATED_PAGE'
  if (onlyInSitemaps && !FUNDING_PATH.test(path)) return 'SITEMAP_NOT_FUNDING'
  return null
}

/** The keyword score, narrowed by `shortlistSkip` for pages with no funding word. */
export function scoreShortlist(title: string, context: string, url: string, config: RelevanceConfig, onlyInSitemaps: boolean, now = new Date()) {
  const score = scoreRelevance(title, context, url, config)
  if (score.outcome !== 'UNCERTAIN') return score
  // A title with a funding-like stem in any watched language is always read,
  // so "£7 million awarded" or a Danish "ansøg nu" news item is kept.
  if (FUNDING_PATH.test(title)) return score
  const skip = shortlistSkip(url, onlyInSitemaps, now)
  return skip ? { ...score, outcome: 'STRONG_NEGATIVE' as RelevanceOutcome, reasons: [SHORTLIST_REASONS[skip]] } : score
}

/** Similarity retrieves candidates only; it never proves a duplicate. */
export function jaccard(a: string, b: string): number {
  const left = new Set(tokens(a)); const right = new Set(tokens(b))
  const union = new Set([...left, ...right]).size
  return union ? [...left].filter(t => right.has(t)).length / union : 0
}
