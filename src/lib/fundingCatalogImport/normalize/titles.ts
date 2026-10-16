/**
 * Titles: keep the original, split a bilingual title only when confident,
 * and derive a series key that SUGGESTS a recurring programme.
 *
 * Scientify appends its own tags as "(topic | scope)", which accounts for most
 * of the 6,207 titles containing "|". Those are not bilingual and are never
 * split. A genuine bilingual title looks like "Anslag till forskning |
 * Research grant (…)": a top-level " | " with a non-English left side.
 */
import { matchKey } from './text'

/** Splits on " | " outside parentheses only. */
function topLevelPipeParts(title: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < title.length; i++) {
    const ch = title[i]
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && ch === '|') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

const ENGLISH_MARKERS = /\b(grant|grants|award|awards|prize|fellowship|fellowships|scholarship|research|programme|program|funding|call|for|the|and|of|in|on|project|projects|support|young|early|career|international|innovation|science|health|travel|postdoctoral|doctoral|visiting|network|collaboration|pilot|seed|centre|center|fund|foundation)\b/i

export function splitBilingualTitle(title: string): { native: string | null } {
  const parts = topLevelPipeParts(title)
  if (parts.length !== 2) return { native: null }
  const [left, right] = parts
  // "2027 FEBS | EMBO …" is a joint name: a left side made only of acronyms
  // and numbers is never a translation.
  const leftWords = left.split(/[\s/–—-]+/).filter((w) => /\p{L}/u.test(w))
  if (leftWords.length === 0 || leftWords.every((w) => /^[\p{Lu}\d&.]+$/u.test(w))) return { native: null }
  const leftHasNonAscii = /[^\u0000-\u007f]/.test(left)
  const leftLooksEnglish = ENGLISH_MARKERS.test(left)
  const rightLooksEnglish = ENGLISH_MARKERS.test(right)
  // Two English halves ("FEBS | EMBO Women in Science Award") are joint
  // names, not translations.
  if (rightLooksEnglish && (!leftLooksEnglish || leftHasNonAscii) && matchKey(left) !== matchKey(right)) {
    return { native: left }
  }
  return { native: null }
}

/** Removes Scientify's trailing "(topic | scope)" tag group. */
export function stripSourceTagSuffix(title: string): string {
  return title.replace(/\s*\([^()]*\|[^()]*\)\s*$/, '').trim()
}

const EDITION_WORDS = /\b(19|20)\d{2}(\s*[-/]\s*(19|20)?\d{2})?\b|\b(round|call|cycle|edition|cohort|wave)\s*\d+\b|\b\d+(st|nd|rd|th)\b|\b(spring|summer|autumn|fall|winter)\b|\b(i{1,3}|iv|v|vi{0,3})\b$/gi

/** Title with years/rounds/editions and the source tag suffix removed. */
export function seriesTitle(title: string): string {
  return matchKey(stripSourceTagSuffix(title).replace(EDITION_WORDS, ' '))
}

/** funder + title-without-editions. A suggestion of recurrence, never identity. */
export function buildSeriesKey(funderKey: string | null, title: string): string | null {
  const base = seriesTitle(title)
  if (!base) return null
  return `${funderKey || 'unknown'}::${base}`.slice(0, 300)
}
