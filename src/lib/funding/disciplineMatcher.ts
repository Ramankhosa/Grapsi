/**
 * Matching free text against the research-area catalog.
 *
 * Pure text logic — no database, no env, no LLM — so classification behaviour
 * is unit-testable in isolation, the same split `alertKeywordBoost` uses
 * against `fundingAlertService`.
 *
 * This is what makes classification free for most calls: the catalog's
 * `aliases` column carries the vocabulary calls actually use ("digital health",
 * "agronomy", "drug delivery"), so an alias sweep resolves the great majority
 * and the LLM is only paid for when it genuinely cannot.
 */

export interface MatchableArea {
  id: string
  level1Code: string
  level1Name: string
  level2Code: string
  level2Name: string
  aliases: string[]
}

/**
 * The text of the thing being classified, kept in separate fields because
 * WHERE a term appears changes what it means. A call whose curated
 * `disciplines` tags say "pharmacology" is about pharmacology; one that merely
 * mentions "law" once in eligibility boilerplate is not a law call. Flattening
 * these into one haystack loses exactly that distinction.
 */
export interface MatchableText {
  /** Curated topic tags — the strongest signal available. */
  tags?: string[] | null
  /** Title / scheme title / unit name. Strong, and short enough to stay clean. */
  title?: string | null
  /** Summary, description, prose. Weakest — long text mentions everything. */
  body?: string | null
}

export interface AreaMatch {
  areaId: string
  /** Accumulated evidence weight, before normalisation. */
  score: number
  confidence: number
  /** The catalog terms that fired, for the "why is this here" explanation. */
  matchedTerms: string[]
  /**
   * `specific` is a named level-2 area; `broad` is a whole discipline group —
   * "we know this is Engineering, not which kind". A broad answer is less
   * accurate but still correct, and relevance already handles it: a group
   * mapping matches every call in the group at the `broad` tier.
   */
  breadth: 'specific' | 'broad'
}

/** A catalog row with no level-2 code stands for the whole discipline group. */
export function isGroupArea(area: MatchableArea): boolean {
  return !area.level2Code
}

/** Field weights. A tag hit alone clears ACCEPT_THRESHOLD; a body hit alone does not. */
const WEIGHT_TAG = 3
const WEIGHT_TITLE = 2
const WEIGHT_BODY = 1

/**
 * Minimum evidence for an automatic mapping. Set at the weight of a single
 * title hit, so prose alone never classifies a call on its own — that was the
 * failure mode worth designing against, since a description mentioning
 * "innovation" or "ethics" in passing would otherwise tag half the catalog.
 */
export const ACCEPT_THRESHOLD = WEIGHT_TITLE

/** Evidence at which we call it certain, for scaling confidence into 0..1. */
const SATURATION_SCORE = 8

/**
 * Aliases shorter than this only match tags and titles, never body prose.
 * "AI" is genuinely how calls describe themselves, but a two-letter token loose
 * in a 4,000-word guideline document is noise.
 */
const SHORT_TERM_MAX_LENGTH = 3

const MAX_AREAS_PER_ITEM = 4

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function joinField(values: Array<string | null | undefined>): string {
  return normalize(values.filter(Boolean).join(' . '))
}

/**
 * Whether `term` occurs in `haystack` as a whole word.
 *
 * Word-like terms match on boundaries so "gene" does not hit "generation";
 * terms carrying symbols ("COVID-19", "C++") fall back to substring matching,
 * since \b behaves unhelpfully around punctuation. Same rule as
 * `matchedAlertKeywords`, deliberately — two different answers to "does this
 * keyword appear" would be a bug generator.
 */
function occurs(haystack: string, term: string): boolean {
  if (!haystack || !term) return false
  const wordLike = /^[\p{L}\p{N} ]+$/u.test(term)
  return wordLike
    ? new RegExp(`\\b${escapeRegExp(term)}\\b`, 'u').test(haystack)
    : haystack.includes(term)
}

/**
 * Every catalog term that should identify an area, longest first.
 *
 * A level-2 row is identified by its OWN name and aliases — deliberately not by
 * its group's name. Matching level-2 rows on the group name made one broad
 * phrase fire on every area beneath it: "School of Chemical Engineering and
 * Physical Sciences" pulled Physics, Maths AND Astronomy off the words
 * "physical sciences". Broad phrases now belong to the group row, which answers
 * them once and honestly.
 */
function termsForArea(area: MatchableArea): string[] {
  const own = isGroupArea(area) ? area.level1Name : area.level2Name
  const terms = [own, ...(area.aliases || [])]
    .map((term) => normalize(term || ''))
    .filter(Boolean)
  // Longest first so "materials chemistry" is reported rather than "chemistry"
  // when both fire — the specific term is the better explanation.
  return Array.from(new Set(terms)).sort((left, right) => right.length - left.length)
}

/**
 * The terms that actually fire in one field.
 *
 * A shorter term is SHADOWED when a longer term that contains it also occurs:
 * "food technology" suppresses "technology", "regenerative medicine" suppresses
 * "medicine", "machine design" suppresses "design". Without this the generic
 * half of every compound term fires a second, wrong area — a researcher whose
 * keywords said "low-resource languages" pulled their entire School of
 * Engineering into Languages & Linguistics.
 *
 * It also means a specific area beats its own group without special-casing:
 * "mechanical engineering" shadows "engineering", so the group row stays quiet
 * when a level-2 row already answered.
 */
function firingTerms(fieldText: string, allTerms: string[], allowShort: boolean): Set<string> {
  if (!fieldText) return new Set()

  const occurring = allTerms.filter((term) => {
    if (!allowShort && term.length <= SHORT_TERM_MAX_LENGTH) return false
    return occurs(fieldText, term)
  })

  const firing = new Set(occurring)
  for (const term of occurring) {
    for (const other of occurring) {
      if (other.length <= term.length || other === term) continue
      // Whole-word containment only, so "art" is not shadowed by "smart".
      if (occurs(other, term)) {
        firing.delete(term)
        break
      }
    }
  }
  return firing
}

/**
 * Score every area against the given text.
 *
 * Returns only areas at or above ACCEPT_THRESHOLD, best first, capped at
 * MAX_AREAS_PER_ITEM. An empty result means "this needs the LLM", not "this
 * belongs nowhere".
 */
export function matchAreas(text: MatchableText, areas: MatchableArea[]): AreaMatch[] {
  const tagText = joinField(text.tags || [])
  const titleText = joinField([text.title])
  const bodyText = joinField([text.body])

  if (!tagText && !titleText && !bodyText) {
    return []
  }

  const termsByArea = new Map(areas.map((area) => [area.id, termsForArea(area)]))
  const allTerms = Array.from(new Set(Array.from(termsByArea.values()).flat()))

  // Resolved once per field, not per area: shadowing is a property of the text,
  // and asking it per area would let one area's terms shadow only its own.
  const firingInTags = firingTerms(tagText, allTerms, true)
  const firingInTitle = firingTerms(titleText, allTerms, true)
  // Short terms are excluded from prose on purpose — see SHORT_TERM_MAX_LENGTH.
  const firingInBody = firingTerms(bodyText, allTerms, false)

  const matches: AreaMatch[] = []

  for (const area of areas) {
    let score = 0
    const matchedTerms: string[] = []

    for (const term of termsByArea.get(area.id) || []) {
      let termScore = 0
      if (firingInTags.has(term)) termScore += WEIGHT_TAG
      if (firingInTitle.has(term)) termScore += WEIGHT_TITLE
      if (firingInBody.has(term)) termScore += WEIGHT_BODY

      if (termScore > 0) {
        score += termScore
        matchedTerms.push(term)
      }
    }

    if (score >= ACCEPT_THRESHOLD) {
      matches.push({
        areaId: area.id,
        score,
        confidence: Math.min(1, Math.round((score / SATURATION_SCORE) * 100) / 100),
        matchedTerms: matchedTerms.slice(0, 5),
        breadth: isGroupArea(area) ? 'broad' : 'specific',
      })
    }
  }

  // A specific area beats a group at equal evidence: the group row exists to
  // answer questions the level-2 rows could not, not to compete with them.
  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(left.breadth === 'broad') - Number(right.breadth === 'broad') ||
        left.areaId.localeCompare(right.areaId)
    )
    .slice(0, MAX_AREAS_PER_ITEM)
}
