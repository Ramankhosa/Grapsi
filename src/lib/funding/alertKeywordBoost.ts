/**
 * Keyword boost for funding alerts.
 *
 * Researchers save alert keywords on their profile; a call whose text hits one
 * of them is promoted from a `weak` embedding match to `moderate`, so it clears
 * the default dispatch tier. Pure text logic — no database, no env — so the
 * dispatch behavior is unit-testable in isolation.
 */

export type AlertMatchTier = 'strong' | 'moderate' | 'weak'

export interface AlertCallText {
  title?: string | null
  schemeTitle?: string | null
  summary?: string | null
  description?: string | null
  disciplines?: string[] | null
}

/** Keywords shorter than this are discarded — "AI" would hit half the catalog. */
const MIN_KEYWORD_LENGTH = 3

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildHaystack(call: AlertCallText): string {
  return [call.title, call.schemeTitle, call.summary, call.description, ...(call.disciplines ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * The user's alert keywords that appear in the call's text.
 *
 * Word-like keywords match on word boundaries ("gene" does not hit
 * "generation"); keywords carrying other symbols ("COVID-19", "C++") fall back
 * to plain substring matching, since \b behaves unhelpfully around symbols.
 */
export function matchedAlertKeywords(call: AlertCallText, alertKeywords: string[]): string[] {
  if (!alertKeywords.length) {
    return []
  }
  const haystack = buildHaystack(call)
  if (!haystack) {
    return []
  }

  const hits: string[] = []
  const seen = new Set<string>()
  for (const raw of alertKeywords) {
    const keyword = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (keyword.length < MIN_KEYWORD_LENGTH || seen.has(keyword)) {
      continue
    }
    seen.add(keyword)

    const wordLike = /^[\p{L}\p{N} ]+$/u.test(keyword)
    const matched = wordLike
      ? new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'u').test(haystack)
      : haystack.includes(keyword)
    if (matched) {
      hits.push(raw.trim())
    }
  }
  return hits
}

/**
 * A weak match becomes moderate when the researcher's own keywords hit the
 * call. Higher tiers pass through untouched — the boost only rescues matches
 * that would otherwise fall below the default dispatch tier.
 */
export function boostTierForKeywords(
  tier: AlertMatchTier | string,
  alertKeywords: string[],
  call: AlertCallText
): AlertMatchTier | string {
  if (tier !== 'weak') {
    return tier
  }
  return matchedAlertKeywords(call, alertKeywords).length > 0 ? 'moderate' : tier
}
