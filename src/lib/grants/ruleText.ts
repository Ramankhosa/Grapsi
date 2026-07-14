/**
 * Sanitizers for guideline/template rule text before it becomes a compliance
 * requirement or user-facing message.
 *
 * The guideline and template extractors are grounded LLMs: their `text` output
 * sometimes embeds raw source citations — full URLs with scroll-to-text
 * fragments ("www.icmr.gov.in/...pdf#:~:text=b,as%20therapeutics...") glued
 * straight onto the prose. Left in place, those strings poison keyword-based
 * compliance matching (a rule containing a URL can never be "covered" by a
 * draft) and render as garbage in every rules panel.
 */

const SCHEME_URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi
/** Bare domain + path with no scheme, e.g. "icmr.gov.in/icmrobject/uploads/...". */
const BARE_DOMAIN_PATH_PATTERN = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,}\/[^\s]*/gi
/** Scroll-to-text fragments that survived URL removal. */
const TEXT_FRAGMENT_PATTERN = /#:~:text=[^\s]*/gi
/** Runs of percent-encoded fragment leftovers ("%20therapeutics%2C%20..."). */
const PERCENT_RUN_PATTERN = /[^\s]*(?:%[0-9a-fA-F]{2}){2,}[^\s]*/g

/**
 * Strip embedded URLs / citation fragments and normalize whitespace. Returns
 * plain prose; empty string when nothing survives.
 */
export function sanitizeGrantRuleText(value: unknown): string {
  return String(value ?? '')
    .replace(SCHEME_URL_PATTERN, ' ')
    .replace(TEXT_FRAGMENT_PATTERN, ' ')
    .replace(BARE_DOMAIN_PATH_PATTERN, ' ')
    .replace(PERCENT_RUN_PATTERN, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .replace(/[,;:]+\s*$/, '')
    .trim()
}

/** Sanitize then truncate at a word boundary for labels and messages. */
export function summarizeGrantRuleText(value: unknown, maxLength = 140): string {
  const text = sanitizeGrantRuleText(value)
  if (text.length <= maxLength) return text
  const slice = text.slice(0, maxLength)
  const cut = slice.lastIndexOf(' ')
  return `${slice.slice(0, cut > Math.floor(maxLength / 2) ? cut : maxLength).replace(/[,;:.\s]+$/, '')}…`
}

/** Split on sentence enders, keeping abbreviations intact is not required for rule prose. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Split a comma/semicolon-separated enumeration at the TOP level only —
 * "objectives, study design (including participants, outcomes), risks" must
 * not break inside the parenthetical.
 */
function splitTopLevelList(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    if ((char === ',' || char === ';') && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.map((entry) => entry.trim()).filter(Boolean)
}

function hasSubstance(text: string): boolean {
  return /[a-zA-Z]{4,}/.test(text)
}

/**
 * Turn one rule paragraph into a short list of atomic, individually checkable
 * points. Guideline "must address" rules frequently arrive as one enormous
 * enumeration sentence ("Concept notes must specify the domain and priority
 * area, TRL (>=3), objectives, study design..., risks..., expected outcomes
 * and references") — as a single required point it can never be keyword-
 * matched, so every draft fails. Split it and each fragment becomes a
 * meaningful checklist entry.
 */
export function splitGrantRuleTextIntoPoints(
  value: unknown,
  options?: { maxPoints?: number; maxPointLength?: number }
): string[] {
  const maxPoints = options?.maxPoints ?? 6
  const maxPointLength = options?.maxPointLength ?? 180
  const text = sanitizeGrantRuleText(value)
  if (!text) return []
  if (text.length <= maxPointLength) return [text]

  const fragments = splitSentences(text).flatMap((sentence) =>
    sentence.length > maxPointLength ? splitTopLevelList(sentence) : [sentence]
  )

  const points = (fragments.length ? fragments : [text])
    .filter(hasSubstance)
    .map((entry) => summarizeGrantRuleText(entry, maxPointLength))
    .filter(Boolean)

  return points.length ? points.slice(0, maxPoints) : [summarizeGrantRuleText(text, maxPointLength)]
}
