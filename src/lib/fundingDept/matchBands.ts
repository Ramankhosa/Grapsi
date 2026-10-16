/**
 * How good a match has to be before it counts — and who decides.
 *
 * A reranker score is a number on a scale nobody outside the model has an
 * intuition for, and its *absolute* meaning shifts with the material: calls and
 * profiles written broadly score lower than sharply-worded ones, a biomedical
 * corpus sits differently from a humanities one, and an agency's house style
 * moves the whole distribution. There is therefore no cutoff that is right for
 * every institution, and picking one in the source means picking wrong for most
 * of them.
 *
 * So the cutoff is a setting, expressed the way the office actually thinks
 * about it — **narrow or wide** — and the admin chooses it with the counts it
 * would produce in front of them (`previewMatchBands`).
 *
 * The one rule that is NOT negotiable: whatever width is chosen, the figure a
 * report counts and the list a screen shows are derived from the same scores by
 * the same comparison. Tunable width, single scoring. (The bug this whole area
 * came from was two scorings, not a badly chosen threshold.)
 *
 * ## Why the band is derived, never stored
 *
 * `funding_opportunity_matches.match_tier` is still written, for history and
 * for rows that predate scoring. But every count and label is derived from
 * `match_score` at read time. That is what makes the setting usable: moving it
 * re-labels every report instantly, with no re-census and no reranker spend. If
 * bands were stored, changing the width would mean re-scoring the catalogue.
 */

import { Prisma } from '@/lib/prisma-generated'

/** Stored codes. Unchanged, so no migration and no rewrite of history. */
export const MATCH_BANDS = ['strong', 'moderate', 'weak'] as const
export type MatchBand = (typeof MATCH_BANDS)[number]

/**
 * What a person reads on a card.
 *
 * These are the words faculty already saw on "Funding in my areas", kept rather
 * than replaced: the researcher being matched is the one most affected by the
 * wording, and "Possible match" is both kinder and more accurate than "Weak"
 * for somebody the office may still approach.
 */
export const MATCH_BAND_LABELS: Record<MatchBand, string> = {
  strong: 'Strong match',
  moderate: 'Good match',
  weak: 'Possible match',
}

export const MATCH_BAND_HELP: Record<MatchBand, string> = {
  strong: 'Clearly in this researcher’s field — approach them first.',
  moderate: 'A real overlap worth putting to them.',
  weak: 'Some overlap, shown so you can judge; not counted as a match.',
}

/** Bands that count as "matched faculty". Weak is shown, never counted. */
export const COUNTED_BANDS: MatchBand[] = ['strong', 'moderate']

export const MATCH_WIDTHS = ['NARROW', 'BALANCED', 'WIDE'] as const
export type MatchWidth = (typeof MATCH_WIDTHS)[number]

export interface MatchCutoffs {
  /** At or above this, a match is `strong`. */
  strong: number
  /** At or above this, a match is `moderate` — and counts. */
  moderate: number
}

/**
 * The three widths.
 *
 * NARROW is exactly the thresholds that shipped before this was a setting, so a
 * tenant that never opens the screen sees no change at all. The other two are
 * offered because on real corpora the top of the distribution can sit below
 * 0.50 entirely, and an office that would rather see candidates than an empty
 * report should not have to edit an environment variable to get them.
 */
export const MATCH_WIDTH_CUTOFFS: Record<MatchWidth, MatchCutoffs> = {
  NARROW: { strong: 0.65, moderate: 0.5 },
  BALANCED: { strong: 0.55, moderate: 0.42 },
  WIDE: { strong: 0.45, moderate: 0.35 },
}

export const MATCH_WIDTH_COPY: Record<MatchWidth, { label: string; help: string }> = {
  NARROW: {
    label: 'Narrow',
    help: 'Only clear matches count. Fewest people, highest confidence — a report with a name on it is worth acting on.',
  },
  BALANCED: {
    label: 'Balanced',
    help: 'Counts real overlaps as well as clear ones. Suits most offices.',
  },
  WIDE: {
    label: 'Wide',
    help: 'Counts anything with genuine overlap. Most people to consider, and more judgement needed on each.',
  },
}

export const DEFAULT_MATCH_WIDTH: MatchWidth = 'NARROW'

export function isMatchWidth(value: unknown): value is MatchWidth {
  return typeof value === 'string' && MATCH_WIDTHS.includes(value as MatchWidth)
}

export function cutoffsFor(width: MatchWidth | null | undefined): MatchCutoffs {
  return MATCH_WIDTH_CUTOFFS[isMatchWidth(width) ? width : DEFAULT_MATCH_WIDTH]
}

/**
 * The band for one score.
 *
 * A row with no score at all predates scoring; it keeps whatever band was
 * written for it rather than being silently demoted to weak, because those are
 * reconstructed historical rows and are excluded from counts by version anyway.
 */
export function bandForScore(
  score: number | null | undefined,
  width: MatchWidth,
  storedBand?: string | null
): MatchBand {
  if (score === null || score === undefined) {
    return (MATCH_BANDS as readonly string[]).includes(storedBand || '') ? (storedBand as MatchBand) : 'weak'
  }
  const cutoffs = cutoffsFor(width)
  if (score >= cutoffs.strong) return 'strong'
  if (score >= cutoffs.moderate) return 'moderate'
  return 'weak'
}

export function isCountedBand(band: MatchBand) {
  return COUNTED_BANDS.includes(band)
}

/** `bandForScore` in SQL, for the reports that count in the database. */
export function bandSql(matchAlias: string, width: MatchWidth): Prisma.Sql {
  const { strong, moderate } = cutoffsFor(width)
  return Prisma.raw(`(CASE
    WHEN ${matchAlias}.match_score IS NULL THEN COALESCE(${matchAlias}.match_tier, 'weak')
    WHEN ${matchAlias}.match_score >= ${strong} THEN 'strong'
    WHEN ${matchAlias}.match_score >= ${moderate} THEN 'moderate'
    ELSE 'weak' END)`)
}

/**
 * "Does this row count as a match at this width?", in SQL.
 *
 * Scored rows are judged on the score so the width setting applies to them;
 * unscored historical rows fall back to the band that was written at the time.
 */
export function countsAtWidthSql(matchAlias: string, width: MatchWidth): Prisma.Sql {
  const { moderate } = cutoffsFor(width)
  const counted = COUNTED_BANDS.map((band) => `'${band}'`).join(',')
  return Prisma.raw(`(CASE
    WHEN ${matchAlias}.match_score IS NOT NULL THEN ${matchAlias}.match_score >= ${moderate}
    ELSE COALESCE(${matchAlias}.match_tier,'') IN (${counted}) END)`)
}
