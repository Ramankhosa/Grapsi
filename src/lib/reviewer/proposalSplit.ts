import { bucketFromText, containsPhrase, matchSynonymBucket } from '@/lib/reviewer/buckets'

/**
 * Deterministic full-proposal splitter for the reviewer workspace.
 *
 * Takes the text of a whole proposal, cuts it at heading lines, and matches
 * each piece to the workspace's sections (which mirror the approved template's
 * structure). Pure and client-safe so the preview is instant and editable
 * before anything is written; the user reassigns whatever it could not place.
 *
 * Built for messy real documents: numbering styles vary wildly, section names
 * are near-synonyms rather than exact matches, sections go missing, and
 * narrative sections carry sub-headings and numbered lists. Everything below is
 * a heuristic with an explicit reason code (`matchedBy`) so the UI can show the
 * user why a block landed where it did, and they can override it.
 */

export interface ProposalSegment {
  /** Heading line as it appeared, '' for preamble text before the first heading. */
  heading: string
  body: string
  order: number
}

export interface ProposalTarget {
  /** Workspace section title the segment can be assigned to. */
  title: string
  bucketKey?: string | null
  /** Extra labels that mean this target (template section labels in the same bucket). */
  aliases?: string[]
  wordLimit?: number | null
  charLimit?: number | null
}

export type ProposalMatchReason =
  /** Heading is the section title (or contains it). */
  | 'title'
  /** Heading matches a section name the call's own template uses. */
  | 'alias'
  /** Heading matches a well-known wording for this section. */
  | 'synonym'
  /** Enough significant words overlap. */
  | 'tokens'
  /** Topic keywords point at this section. */
  | 'bucket'
  /** A sub-heading or continuation of the block above it. */
  | 'continuation'
  /** Reference lists, annexures and forms: deliberately not imported. */
  | 'excluded'
  | 'none'

export interface ProposalMatch extends ProposalSegment {
  /** Matched target title, or null when the matcher could not place the segment. */
  targetTitle: string | null
  matchedBy: ProposalMatchReason
}

const MAX_HEADING_CHARS = 90

const NOISE_LINE =
  /^\s*(page\s+\d+(\s+of\s+\d+)?|\d+\s*\/\s*\d+|[-_=*]{3,}|confidential|draft)\s*$/i

/**
 * Fixed-format furniture, agency-agnostic. Grant agencies distribute a format
 * document; applicants type into it and submit the whole thing, so the import
 * arrives with the format's own text interleaved with the user's: word-limit
 * instructions ("Up to 500 words."), cross-reference parentheticals ("(See
 * Point No. 5.3 of the Guidelines)"), and empty table skeletons. These shapes
 * recur across agencies even though the wording differs, which is what makes
 * stripping them safe without knowing the specific format.
 */
const WORD_LIMIT_PHRASE =
  /\(?\s*(?:up\s*to|max(?:imum)?\.?|not\s+(?:more|exceeding)\s+than|not\s+to\s+exceed|within|about|approx(?:imately)?\.?|word\s+limit:?|limit:?)\s+\d{1,3}(?:,\d{3})*(?:\s*(?:-|–|—|to)\s*\d{1,3}(?:,\d{3})*)?\s*(?:words?|characters?|chars?|pages?)\s*\)?\s*\.?/gi

/** "(500 words)" / "(2 pages max)" — the number-first variant of the same. */
const WORD_LIMIT_PAREN = /\(\s*\d{1,3}(?:,\d{3})*\s*(?:words?|characters?|chars?|pages?)(?:\s+max(?:imum)?)?\s*\)\s*\.?/gi

/**
 * Parentheticals that start with an instruction verb are the format talking to
 * the applicant, never the applicant's own text: "(copy from your online
 * application)", "(See Point No. 1.2 of the Guidelines)", "(same as in the
 * online application)", "(to be filled by the office)". A parenthetical that
 * does not open with one of these verbs — "(CLF)", "(2020)" — is content.
 */
const INSTRUCTION_PARENTHETICAL =
  /\(\s*(?:please\s+)?(?:see|refer(?:\s+to)?|as\s+per|copy\s+from|same\s+as|to\s+be\s+|this\s+will\s+be\s+decided|if\s+applicable|attach|enclose|do\s+not|use\s+only)[^()]*\)/gi

function stripInstructionText(value: string): string {
  return String(value || '')
    .replace(INSTRUCTION_PARENTHETICAL, ' ')
    .replace(WORD_LIMIT_PHRASE, ' ')
    .replace(WORD_LIMIT_PAREN, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Words that carry prose, as opposed to amounts, dates and table frame. */
function proseWordCount(value: string): number {
  return (String(value || '').match(/[A-Za-zÀ-ɏ]{2,}/g) || []).length
}

/**
 * A table row that survived text extraction as literal pipes. Rows whose cells
 * are all empty (or timeline placeholders like "6 months") are the format's
 * blank skeleton; a row a user actually filled keeps other words and is kept.
 */
function isTableSkeletonRow(line: string): boolean {
  const trimmed = line.trim()
  if ((trimmed.match(/\|/g) || []).length < 2) return false

  const cells = trimmed.split('|').map((cell) => cell.trim())
  const meaningful = cells.filter((cell) => cell && !/^[-:\s]+$/.test(cell))
  if (meaningful.length === 0) return true
  if (meaningful.every((cell) => /^\d+\s*(?:months?|weeks?|years?|days?)$/i.test(cell))) return true

  // A separator run glued together with empty cells ("| Head | ||---|| | |")
  // is skeleton; a plain markdown separator row from a real pasted table is not.
  const emptyCells = cells.filter((cell) => cell === '').length
  return /-{4,}/.test(trimmed) && emptyCells >= 2
}

const MARKDOWN_HEADING = /^\s*#{1,4}\s+\S/

/**
 * Numbering styles seen in real proposals: `1.`, `1)`, `(1)`, `1.2.3`, `IV.`,
 * `(iv)`, `A.`, `b)`, and worded forms like `Section 3:` or `Part B -`.
 * A marker must be followed by text, so a bare "1." line is not a heading.
 */
const NUMERIC_MARKER = /^\s*\(?(\d+(?:\.\d+)*)\)?\s*[.):\]]?[\s-–—:]+(?=\S)/
const ROMAN_MARKER = /^\s*\(?([ivxlcdm]{1,7})\)?\s*[.):\]][\s-–—:]*(?=\S)/i
const LETTER_MARKER = /^\s*\(?([a-z])\)?\s*[.):\]][\s-–—:]*(?=\S)/i
const WORDED_MARKER =
  /^\s*(?:section|part|chapter|step|phase|stage|module|component)\s+([0-9]+(?:\.[0-9]+)*|[ivxlcdm]{1,7}|[a-z])\s*[.):\-–—:]*\s*/i

/** Any of the above, for stripping the marker off a heading before matching. */
const ANY_MARKER = [WORDED_MARKER, NUMERIC_MARKER, ROMAN_MARKER, LETTER_MARKER]

/**
 * Headings that are never proposal narrative. These are not imported and they
 * also stop a continuation from running past them into unrelated material.
 */
const EXCLUDED_HEADING =
  /\b(reference|references|bibliography|citation|annexure|annex|appendix|appendices|enclosure|declaration|certificate|undertaking|endorsement|checklist|biodata|curriculum\s+vitae|cv|signature|acknowledgement)\b/i

function normalizeTitle(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Remove numbering/markdown decoration and trailing punctuation from a heading. */
export function stripHeadingDecoration(line: string): string {
  let text = String(line || '').replace(/^\s*#{1,4}\s+/, '')
  for (const marker of ANY_MARKER) {
    const stripped = text.replace(marker, '')
    if (stripped !== text) {
      text = stripped
      break
    }
  }
  return text.replace(/[:.\s]+$/, '').trim()
}

/** The dotted number a heading carries, e.g. "4.1" for "4.1 Study Design". */
function headingNumber(line: string): string | null {
  const worded = String(line || '').match(WORDED_MARKER)
  if (worded && /^[0-9.]+$/.test(worded[1])) return worded[1]
  const numeric = String(line || '').match(NUMERIC_MARKER)
  return numeric ? numeric[1] : null
}

function looksLikeTitleCase(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 10) return false
  const significant = words.filter((word) => word.length > 3)
  if (significant.length === 0) return false
  const capitalized = significant.filter((word) => /^[A-Z]/.test(word))
  return capitalized.length / significant.length >= 0.6
}

type LineKind = 'strong' | 'weak' | 'body' | 'noise'

interface LineInfo {
  kind: LineKind
  /** Nesting depth for numeric headings: "4" is 1, "4.1" is 2. */
  depth: number
}

/**
 * Classify one line.
 *
 * `strong` = an explicit heading marker (markdown hashes, "3.", "(iv)",
 * "Part B -"). `weak` = looks like a heading only by shape (ALL CAPS, Title
 * Case, or a known section keyword); weak candidates are demoted in
 * `classifyLines` when they appear in a run, because a stack of short
 * title-case lines is a cover page, not a series of one-line sections.
 */
function classifyLine(line: string): LineInfo {
  const trimmed = line.trim()
  if (!trimmed) return { kind: 'noise', depth: 0 }
  if (NOISE_LINE.test(trimmed)) return { kind: 'noise', depth: 0 }
  if (trimmed.length > MAX_HEADING_CHARS) return { kind: 'body', depth: 0 }
  if (MARKDOWN_HEADING.test(trimmed)) return { kind: 'strong', depth: 0 }

  // List items are prose fragments, and a line closing with sentence
  // punctuation is prose too (a trailing colon still reads as a heading).
  if (/^[-*•‣◦]\s/.test(trimmed)) return { kind: 'body', depth: 0 }

  const number = headingNumber(trimmed)
  const marked =
    WORDED_MARKER.test(trimmed) ||
    NUMERIC_MARKER.test(trimmed) ||
    ROMAN_MARKER.test(trimmed) ||
    LETTER_MARKER.test(trimmed)

  if (marked) {
    const rest = stripHeadingDecoration(trimmed)
    // "1. Deploy forty nodes and validate them." is a list item, not a heading:
    // headings do not end in sentence punctuation and are not full sentences.
    const sentenceLike = /[.;,]$/.test(trimmed) || rest.split(/\s+/).length > 12
    if (!rest || sentenceLike) return { kind: 'body', depth: 0 }
    return { kind: 'strong', depth: number ? number.split('.').length : 1 }
  }

  if (/[.;,]$/.test(trimmed)) return { kind: 'body', depth: 0 }

  const allCaps = /^[^a-z]+$/.test(trimmed) && /[A-Z]/.test(trimmed)
  const knownSection = bucketFromText(trimmed) !== 'other' && trimmed.split(/\s+/).length <= 8
  const knownSynonym = matchSynonymBucket(normalizeTitle(trimmed)) !== null
  if (allCaps || knownSection || knownSynonym || looksLikeTitleCase(trimmed)) {
    return { kind: 'weak', depth: 0 }
  }

  return { kind: 'body', depth: 0 }
}

function classifyLines(lines: string[]): LineInfo[] {
  const infos = lines.map(classifyLine)
  const original = infos.map((info) => ({ ...info }))

  for (let index = 0; index < original.length; index++) {
    const previous = index > 0 ? original[index - 1] : null
    const next = index + 1 < original.length ? original[index + 1] : null

    // Runs of adjacent weak candidates are a title block ("Grant Application
    // Form" / "Applicant: …"), not two headings. Decisions read from a snapshot:
    // demoting in place would let the second line of a pair see an already
    // demoted neighbour and survive as a heading.
    if (original[index].kind === 'weak' && (previous?.kind === 'weak' || next?.kind === 'weak')) {
      infos[index].kind = 'body'
      continue
    }

    // Adjacent numbered lines at the same depth are a numbered list ("1. Deploy
    // nodes" / "2. Validate readings"), not consecutive sections — real sections
    // have body text or a blank line between them. Different depths are genuine
    // nesting ("4. Methodology" above "4.1 Study Design") and are kept.
    //
    // A line that names a known section survives regardless: a list often runs
    // straight into the next heading with no blank line ("3. Publish the
    // dataset" / "4. Methodology"), and demoting that heading would swallow the
    // whole next section into the previous one.
    if (original[index].kind === 'strong' && original[index].depth > 0) {
      if (looksLikeSectionName(stripHeadingDecoration(lines[index]))) continue

      const sameDepth = (other: LineInfo | null) =>
        other?.kind === 'strong' && other.depth === original[index].depth
      if (sameDepth(previous) || sameDepth(next)) {
        infos[index].kind = 'body'
      }
    }
  }

  return infos
}

/**
 * Cut proposal text into heading-led segments. Text before the first heading
 * becomes a heading-less preamble segment (title pages, applicant info).
 */
export function splitProposalIntoSegments(text: string): ProposalSegment[] {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const segments: ProposalSegment[] = []
  let currentHeading = ''
  let currentBody: string[] = []
  let order = 0

  const flush = () => {
    const body = currentBody.join('\n').trim()
    if (!body && !currentHeading) return
    segments.push({ heading: currentHeading, body, order: order++ })
  }

  const infos = classifyLines(lines)

  for (let index = 0; index < lines.length; index++) {
    const kind = infos[index].kind
    if (kind === 'noise') {
      // Keep paragraph breaks inside the body text.
      if (!lines[index].trim()) currentBody.push('')
      continue
    }

    if (kind === 'strong' || kind === 'weak') {
      flush()
      currentHeading = lines[index].trim()
      currentBody = []
    } else {
      currentBody.push(lines[index])
    }
  }
  flush()

  // "4. Methodology" sitting directly above "4.1 Study Design" has no body of
  // its own, so fold it into the child to keep the outer title. Both sides must
  // be explicitly marked headings: a document title above the first section
  // ("Application Form for Research Grant" above "Objectives") is not a parent,
  // and merging it would corrupt the heading the matcher relies on. Capped at
  // one level so a run of headings can never collapse into a mega-heading.
  const merged: ProposalSegment[] = []
  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    const isNesting =
      previous &&
      !previous.body &&
      previous.heading &&
      !previous.heading.includes(' — ') &&
      classifyLine(previous.heading).kind === 'strong' &&
      classifyLine(segment.heading).kind === 'strong'

    if (isNesting) {
      previous.heading = `${previous.heading} — ${segment.heading}`.replace(/ — $/, '')
      previous.body = segment.body
      continue
    }
    merged.push(segment)
  }

  // A heading with no text under it carries nothing to import (cover pages,
  // stray form labels), so it is not offered as a block.
  return merged
    .filter((segment) => segment.body.trim().length > 0)
    .map((segment, index) => ({ ...segment, body: segment.body.trim(), order: index }))
}

/** Whole-phrase containment, so "aim" does not match inside "claim". */
/**
 * Is this heading text essentially just a section name? True for "Methodology"
 * and "Budget Justification", false for "Validate the methodology in phase two",
 * where the synonym is only an incidental word in a longer sentence.
 */
function looksLikeSectionName(text: string): boolean {
  const norm = normalizeTitle(text)
  if (!norm) return false
  const synonym = matchSynonymBucket(norm)
  return Boolean(synonym && synonym.length / norm.length >= 0.7)
}

function tokenOverlapScore(headingNorm: string, candidateNorm: string): number {
  if (!headingNorm || !candidateNorm) return 0
  const headingTokens = new Set(headingNorm.split(' ').filter((token) => token.length > 3))
  const candidateTokens = candidateNorm.split(' ').filter((token) => token.length > 3)
  if (headingTokens.size === 0 || candidateTokens.length === 0) return 0
  const hits = candidateTokens.filter((token) => headingTokens.has(token)).length
  return hits / candidateTokens.length
}

/**
 * Assign each segment to the best-matching target.
 *
 * Confidence order: the section's own title, then a name the call's template
 * uses, then a well-known synonym, then word overlap, then topic keywords.
 * Anything below that stays unassigned for the user to place, and reference
 * lists and annexures are excluded outright. A final pass hands sub-headings
 * and unlabelled continuations to the section they sit under.
 */
export function matchSegmentsToTargets(
  segments: ProposalSegment[],
  targets: ProposalTarget[]
): ProposalMatch[] {
  const prepared = targets.map((target) => ({
    target,
    titleNorm: normalizeTitle(target.title),
    aliasNorms: (target.aliases || []).map(normalizeTitle).filter(Boolean),
    bucketKey: target.bucketKey ? String(target.bucketKey) : null,
  }))

  // Every section in a bucket, not just the first. A synonym match names a
  // bucket, and a bucket can hold several sections — sending them all to
  // whichever came first is what merged "Review of Literature" into
  // "Introduction".
  const byBucket = new Map<string, typeof prepared>()
  for (const entry of prepared) {
    if (!entry.bucketKey) continue
    const list = byBucket.get(entry.bucketKey)
    if (list) list.push(entry)
    else byBucket.set(entry.bucketKey, [entry])
  }

  /** Within a bucket, the section whose title or aliases fit this heading best. */
  const bestInBucket = (bucketKey: string, headingNorm: string): string | null => {
    const candidates = byBucket.get(bucketKey)
    if (!candidates || candidates.length === 0) return null
    let bestTitle: string | null = null
    let bestScore = -1
    for (const entry of candidates) {
      const score = Math.max(
        labelAffinity(headingNorm, entry.titleNorm),
        ...entry.aliasNorms.map((alias) => labelAffinity(headingNorm, alias)),
        0
      )
      if (score > bestScore) {
        bestScore = score
        bestTitle = entry.target.title
      }
    }
    return bestTitle
  }

  const direct: ProposalMatch[] = segments.map((segment) => {
    // Formats often glue the instruction onto the heading line itself
    // ("Review of Key Research Works   Up to 600 words"), which would poison
    // every downstream comparison if left in place.
    const headingCore = stripInstructionText(stripHeadingDecoration(segment.heading))
    const headingNorm = normalizeTitle(headingCore)

    if (!headingNorm) {
      return { ...segment, targetTitle: null, matchedBy: 'none' as const }
    }

    if (EXCLUDED_HEADING.test(headingCore)) {
      return { ...segment, targetTitle: null, matchedBy: 'excluded' as const }
    }

    let best: { title: string; score: number; reason: ProposalMatchReason } | null = null
    const consider = (title: string, score: number, reason: ProposalMatchReason) => {
      if (score <= 0) return
      if (!best || score > best.score) best = { title, score, reason }
    }

    for (const { target, titleNorm, aliasNorms } of prepared) {
      if (titleNorm && (headingNorm === titleNorm || containsPhrase(headingNorm, titleNorm) || containsPhrase(titleNorm, headingNorm))) {
        consider(target.title, 1000, 'title')
        continue
      }
      const alias = aliasNorms.find(
        (item) => headingNorm === item || containsPhrase(headingNorm, item) || containsPhrase(item, headingNorm)
      )
      if (alias) {
        consider(target.title, 800 + alias.length, 'alias')
      }
    }

    // A well-known wording for the section, e.g. "Aims and Objectives".
    const synonym = matchSynonymBucket(headingNorm)
    if (synonym) {
      const title = bestInBucket(synonym.bucketKey, headingNorm)
      if (title) consider(title, 500 + synonym.length, 'synonym')
    }

    for (const { target, titleNorm, aliasNorms } of prepared) {
      const overlap = Math.max(
        tokenOverlapScore(headingNorm, titleNorm),
        ...aliasNorms.map((item) => tokenOverlapScore(headingNorm, item)),
        0
      )
      if (overlap >= 0.5) consider(target.title, 100 + overlap * 50, 'tokens')
    }

    if (!best) {
      const bucket = bucketFromText(headingCore)
      const title = bucket !== 'other' ? bestInBucket(bucket, headingNorm) : null
      if (title) consider(title, 50, 'bucket')
    }

    const resolved = best as { title: string; reason: ProposalMatchReason } | null
    return {
      ...segment,
      targetTitle: resolved ? resolved.title : null,
      matchedBy: resolved ? resolved.reason : ('none' as const),
    }
  })

  return inheritContinuations(direct, segments)
}

/**
 * Give unplaced blocks to the section they belong under.
 *
 * A numbered sub-heading ("4.1 Sampling") joins its parent ("4. Methodology").
 * An unlabelled block directly after a placed one is treated as a continuation
 * of it. Excluded blocks (references, annexures) never inherit, and they break
 * the chain so nothing after them is swept into the previous section.
 */
function inheritContinuations(matches: ProposalMatch[], segments: ProposalSegment[]): ProposalMatch[] {
  const result = [...matches]
  const numbers = segments.map((segment) => headingNumber(segment.heading))

  // Where each numbered heading landed, so "4.2" can find "4" even after its
  // sibling "4.1" has been placed.
  const placedByNumber = new Map<string, string>()
  let carriedTitle: string | null = null

  const nearestPlacedAncestor = (number: string): string | null => {
    const parts = number.split('.')
    while (parts.length > 1) {
      parts.pop()
      const title = placedByNumber.get(parts.join('.'))
      if (title) return title
    }
    return null
  }

  for (let index = 0; index < result.length; index++) {
    const match = result[index]
    const number = numbers[index]

    if (match.matchedBy === 'excluded') {
      carriedTitle = null
      placedByNumber.clear()
      continue
    }

    if (match.targetTitle) {
      carriedTitle = match.targetTitle
      if (number) placedByNumber.set(number, match.targetTitle)
      continue
    }

    const ancestorTitle: string | null = number ? nearestPlacedAncestor(number) : null
    // Without numbering, only an immediate neighbour is treated as a
    // continuation; a gap means the document moved on to something else.
    const followerTitle: string | null =
      !number && carriedTitle && index > 0 && result[index - 1].targetTitle ? carriedTitle : null

    const inherited: string | null = ancestorTitle || followerTitle
    if (!inherited) continue

    result[index] = { ...match, targetTitle: inherited, matchedBy: 'continuation' }
    carriedTitle = inherited
    if (number) placedByNumber.set(number, inherited)
  }

  return result
}

/**
 * Build assignment targets from the workspace's existing sections plus the
 * template's own section labels (aliased into the bucket's workspace section),
 * so a proposal using the call's official headings still lands correctly.
 */
interface TemplateRuleLike {
  label: string
  wordLimit: number | null
  charLimit: number | null
}

/**
 * How strongly a template rule's label names a given workspace section.
 * Exact match wins, then whole-phrase containment, then shared long words.
 */
function labelAffinity(labelNorm: string, titleNorm: string): number {
  if (!labelNorm || !titleNorm) return 0
  if (labelNorm === titleNorm) return 1000
  if (containsPhrase(labelNorm, titleNorm) || containsPhrase(titleNorm, labelNorm)) {
    return 500 + Math.min(labelNorm.length, titleNorm.length)
  }
  const overlap = Math.max(
    tokenOverlapScore(labelNorm, titleNorm),
    tokenOverlapScore(titleNorm, labelNorm)
  )
  return overlap > 0 ? Math.round(overlap * 100) : 0
}

export function buildProposalTargets(
  workspaceSections: Array<{ section_title: string; reviewerBucketKey?: string | null }>,
  templateSections: Array<{ label?: string; bucketKey?: string; wordLimit?: number | null; charLimit?: number | null }>
): ProposalTarget[] {
  const byTitle = new Map<string, ProposalTarget>()

  for (const section of workspaceSections) {
    const title = String(section.section_title || '').trim()
    if (!title || byTitle.has(title)) continue
    byTitle.set(title, {
      title,
      bucketKey: section.reviewerBucketKey || bucketFromText(title),
      aliases: [],
      wordLimit: null,
      charLimit: null,
    })
  }

  const rulesByBucket = new Map<string, TemplateRuleLike[]>()
  for (const rule of templateSections || []) {
    const label = String(rule?.label || '').trim()
    if (!label) continue
    const bucket = String(rule?.bucketKey || bucketFromText(label))
    const entry: TemplateRuleLike = {
      label,
      wordLimit: rule?.wordLimit ?? null,
      charLimit: rule?.charLimit ?? null,
    }
    const list = rulesByBucket.get(bucket)
    if (list) list.push(entry)
    else rulesByBucket.set(bucket, [entry])
  }

  const applyRule = (target: ProposalTarget, rule: TemplateRuleLike) => {
    if (normalizeTitle(target.title) !== normalizeTitle(rule.label)) {
      target.aliases = Array.from(new Set([...(target.aliases || []), rule.label]))
    }
    if (rule.wordLimit) {
      target.wordLimit = target.wordLimit ? Math.min(target.wordLimit, rule.wordLimit) : rule.wordLimit
    }
    if (rule.charLimit) {
      target.charLimit = target.charLimit ? Math.min(target.charLimit, rule.charLimit) : rule.charLimit
    }
  }

  for (const [bucket, rules] of rulesByBucket.entries()) {
    const candidates = Array.from(byTitle.values()).filter((item) => item.bucketKey === bucket)

    // A template bucket the workspace has no section for still needs somewhere
    // to put the text, so the rule's own label becomes the target and the
    // commit creates the section.
    if (candidates.length === 0) {
      for (const rule of rules) {
        if (byTitle.has(rule.label)) continue
        const target: ProposalTarget = {
          title: rule.label,
          bucketKey: bucket,
          aliases: [],
          wordLimit: null,
          charLimit: null,
        }
        applyRule(target, rule)
        byTitle.set(rule.label, target)
      }
      continue
    }

    // Give each rule the section it actually names. Attaching every rule in a
    // bucket to whichever section came first merged two real sections into one
    // ("Review of Literature" landing in Introduction) and left the other
    // empty — and it carried the wrong section's word limit with it.
    const pairs: Array<{ rule: TemplateRuleLike; target: ProposalTarget; score: number }> = []
    for (const rule of rules) {
      const labelNorm = normalizeTitle(rule.label)
      for (const target of candidates) {
        pairs.push({ rule, target, score: labelAffinity(labelNorm, normalizeTitle(target.title)) })
      }
    }
    pairs.sort((left, right) => right.score - left.score)

    const claimedRules = new Set<TemplateRuleLike>()
    const claimedTargets = new Set<ProposalTarget>()
    for (const pair of pairs) {
      if (claimedRules.has(pair.rule) || claimedTargets.has(pair.target)) continue
      claimedRules.add(pair.rule)
      claimedTargets.add(pair.target)
      applyRule(pair.target, pair.rule)
    }

    // More rules than sections: whatever is left shares its closest section.
    for (const rule of rules) {
      if (claimedRules.has(rule)) continue
      const best = pairs.filter((pair) => pair.rule === rule)[0]
      if (best) applyRule(best.target, rule)
    }
  }

  return Array.from(byTitle.values())
}

export function countProposalWords(text: string): number {
  return (String(text || '').match(/\S+/g) || []).length
}

// ---------------------------------------------------------------------------
// Format-aware splitting: separating the agency's fixed format from the
// user's content.
//
// Every agency ships its own proposal format; applicants fill it in and submit
// the whole document, format text and all. Heading heuristics alone cannot
// tell "2. Field work" (a budget-table row) from "2. Objectives" (a section),
// so the splitter uses what the reviewer workspace already knows about THIS
// call: its section titles, the template's own labels, and the template's
// captured instruction text. Nothing here is specific to any one agency.
// ---------------------------------------------------------------------------

/**
 * The template's captured instruction sentences, normalized for line matching.
 * When the reviewer template was extracted from the agency's format document,
 * `guidanceText` holds the very sentences the applicant leaves in their filled
 * copy — subtracting them is what removes agency-specific boilerplate without
 * hardcoding any agency.
 */
export function buildFormatInstructionIndex(templateSections: unknown[]): string[] {
  const index = new Set<string>()
  for (const rule of Array.isArray(templateSections) ? templateSections : []) {
    const record = rule && typeof rule === 'object' ? (rule as Record<string, unknown>) : null
    if (!record) continue
    const guidance = Array.isArray(record.guidanceText) ? record.guidanceText : []
    for (const entry of guidance) {
      const norm = normalizeTitle(String(entry ?? ''))
      if (norm.length >= 20) index.add(norm)
    }
  }
  return Array.from(index)
}

/** Does this body line match one of the template's own instruction sentences? */
function matchesInstructionIndex(lineNorm: string, index: string[]): boolean {
  if (lineNorm.length < 15) return false
  for (const guidance of index) {
    if (lineNorm === guidance) return true
    if (guidance.length >= 25 && lineNorm.includes(guidance)) return true
    if (lineNorm.length >= 25 && guidance.includes(lineNorm)) return true
  }
  return false
}

/**
 * Drop the format's own lines from a block body, keeping the user's text.
 * Word-limit lines, instruction parentheticals, table skeletons, and lines
 * matching the template's captured guidance are format text; everything else
 * is user content and passes through untouched (inline instruction
 * parentheticals are trimmed out of kept lines).
 */
export function scrubFormatLines(
  body: string,
  instructionIndex: string[] = []
): { text: string; removed: number } {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  let removed = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      kept.push('')
      continue
    }

    if (NOISE_LINE.test(trimmed)) continue

    if (isTableSkeletonRow(trimmed)) {
      removed++
      continue
    }

    // A line that is nothing but instruction text disappears entirely.
    if (!stripInstructionText(trimmed)) {
      removed++
      continue
    }

    if (matchesInstructionIndex(normalizeTitle(trimmed), instructionIndex)) {
      removed++
      continue
    }

    // Inline instruction parentheticals are format text even mid-line.
    const cleaned = trimmed.replace(INSTRUCTION_PARENTHETICAL, ' ').replace(/\s{2,}/g, ' ').trim()
    if (cleaned !== trimmed) removed++
    kept.push(cleaned || trimmed)
  }

  return { text: kept.join('\n').trim(), removed }
}

type AnchorReason = Extract<ProposalMatchReason, 'title' | 'alias' | 'synonym' | 'tokens'>

interface FormatAnchor {
  lineIndex: number
  heading: string
  targetTitle: string | null
  reason: AnchorReason | 'excluded'
  /** Strong anchors matched the call's own section names; soft ones inferred. */
  strength: 'strong' | 'soft'
  /** Normalized heading core, for the duplicate-mention guard. */
  coreNorm?: string
}

/** Neighbouring lines that are table cells rather than prose. */
function isCellLikeLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  return proseWordCount(trimmed) <= 3
}

/**
 * Milestone rows restate section names with a duration bolted on
 * ("Identification of Research Gap    2–3 Months"). The duration is workplan
 * furniture; shedding it lets the duplicate-heading guard below recognise the
 * line as a mention of the section, not the section starting again.
 */
function stripTrailingDuration(value: string): string {
  return String(value || '')
    .replace(/[\t ]+\d{1,2}\s*(?:[-–—]|to)?\s*\d{0,2}\s*(?:months?|weeks?|years?|days?)\s*$/i, '')
    .trim()
}

/**
 * Find the lines where the proposal uses the call's own section structure.
 *
 * A line anchors when — after shedding numbering and inline instructions — it
 * names a workspace section or template label (strong), or overlaps one's
 * vocabulary well enough (soft). Soft anchors sitting inside a run of
 * table-cell lines are rejected: "4. Contingency" inside a budget table names
 * a risk section by synonym, but its surroundings say it is a table row.
 */
function findFormatAnchors(lines: string[], targets: ProposalTarget[]): FormatAnchor[] {
  if (targets.length === 0) return []

  const prepared = targets.map((target) => ({
    target,
    titleNorm: normalizeTitle(target.title),
    aliasNorms: (target.aliases || []).map(normalizeTitle).filter(Boolean),
  }))

  const byBucket = new Map<string, typeof prepared>()
  for (const entry of prepared) {
    const key = entry.target.bucketKey ? String(entry.target.bucketKey) : null
    if (!key) continue
    const list = byBucket.get(key)
    if (list) list.push(entry)
    else byBucket.set(key, [entry])
  }

  // A section name CONTAINED in a longer line only counts when the name is
  // most of the line. "Budget" inside "Budget & Justification" anchors; the
  // alias inside "Q1: From Review of Lit to Identification of Research Gap"
  // does not — that line merely mentions the section.
  const namesLine = (norm: string, candidate: string): boolean => {
    if (!candidate) return false
    if (norm === candidate) return true
    if (containsPhrase(candidate, norm)) return true
    return containsPhrase(norm, candidate) && candidate.length / norm.length >= 0.7
  }

  const anchors: FormatAnchor[] = []

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (!trimmed || NOISE_LINE.test(trimmed)) continue

    const core = stripTrailingDuration(stripInstructionText(stripHeadingDecoration(trimmed)))
    if (!core || core.length > MAX_HEADING_CHARS) continue
    if (core.split(/\s+/).length > 12) continue
    // Sentence punctuation means prose, not a heading.
    if (/[.;,]$/.test(core)) continue

    if (EXCLUDED_HEADING.test(core)) {
      anchors.push({ lineIndex: index, heading: trimmed, targetTitle: null, reason: 'excluded', strength: 'strong' })
      continue
    }

    const norm = normalizeTitle(core)
    if (!norm) continue

    let best: { title: string; score: number; reason: AnchorReason } | null = null
    const consider = (title: string, score: number, reason: AnchorReason) => {
      if (score <= 0) return
      if (!best || score > best.score) best = { title, score, reason }
    }

    for (const { target, titleNorm, aliasNorms } of prepared) {
      if (titleNorm && namesLine(norm, titleNorm)) {
        consider(target.title, 1000, 'title')
        continue
      }
      const alias = aliasNorms.find((item) => namesLine(norm, item))
      if (alias) consider(target.title, 800 + alias.length, 'alias')
    }

    if (!best) {
      // Bidirectional token overlap: "Relevance of the Research for Society"
      // anchors to "…Relevance of the Research for Policy/Society" even though
      // neither phrase contains the other verbatim.
      for (const { target, titleNorm, aliasNorms } of prepared) {
        const overlap = Math.max(
          ...[titleNorm, ...aliasNorms].map((item) =>
            Math.max(tokenOverlapScore(norm, item), tokenOverlapScore(item, norm))
          ),
          0
        )
        if (overlap >= 0.7) consider(target.title, 100 + overlap * 50, 'tokens')
      }
    }

    if (!best) {
      const synonym = matchSynonymBucket(norm)
      if (synonym && synonym.length / norm.length >= 0.7) {
        const candidates = byBucket.get(synonym.bucketKey)
        if (candidates && candidates.length > 0) {
          let bestTitle = candidates[0].target.title
          let bestAffinity = -1
          for (const entry of candidates) {
            const affinity = Math.max(
              labelAffinity(norm, entry.titleNorm),
              ...entry.aliasNorms.map((alias) => labelAffinity(norm, alias)),
              0
            )
            if (affinity > bestAffinity) {
              bestAffinity = affinity
              bestTitle = entry.target.title
            }
          }
          consider(bestTitle, 50, 'synonym')
        }
      }
    }

    const resolved = best as { title: string; score: number; reason: AnchorReason } | null
    if (!resolved) continue
    const strength: FormatAnchor['strength'] = resolved.score >= 800 ? 'strong' : 'soft'

    // Soft anchors need prose surroundings. Collect up to three non-blank
    // neighbours each way; a majority of table cells vetoes the anchor.
    if (strength === 'soft') {
      const neighbours: string[] = []
      for (let back = index - 1; back >= 0 && neighbours.length < 3; back--) {
        const candidate = lines[back].trim()
        if (candidate) neighbours.push(candidate)
      }
      let forwardCount = 0
      for (let ahead = index + 1; ahead < lines.length && forwardCount < 3; ahead++) {
        const candidate = lines[ahead].trim()
        if (candidate) {
          neighbours.push(candidate)
          forwardCount++
        }
      }
      const cellLike = neighbours.filter(isCellLikeLine).length
      if (neighbours.length >= 2 && cellLike / neighbours.length >= 0.6) continue
    }

    anchors.push({
      lineIndex: index,
      heading: trimmed,
      targetTitle: resolved.title,
      reason: resolved.reason,
      strength,
      coreNorm: norm,
    })
  }

  // Second pass, with the whole document in view. A format section occurs
  // once: a heading core that repeats is the document referring back to the
  // section ("Identification of Research Gap    2–3 Months" in a milestone
  // table), and a soft anchor whose target already has a strong anchor
  // somewhere is a mention inside another section ("Identification of
  // research gaps" as a bullet in a methodology phase list). Rejected lines
  // simply stay inside the block they sit in.
  const strongTargets = new Set(
    anchors
      .filter((anchor) => anchor.strength === 'strong' && anchor.reason !== 'excluded' && anchor.targetTitle)
      .map((anchor) => anchor.targetTitle as string)
  )
  const seenCores = new Set<string>()
  const kept: FormatAnchor[] = []
  for (const anchor of anchors) {
    if (anchor.reason === 'excluded') {
      kept.push(anchor)
      continue
    }
    if (anchor.coreNorm && seenCores.has(anchor.coreNorm)) continue
    if (anchor.strength === 'soft' && anchor.targetTitle && strongTargets.has(anchor.targetTitle)) continue
    if (anchor.coreNorm) seenCores.add(anchor.coreNorm)
    kept.push(anchor)
  }

  return kept
}

export interface FormatAwareSplitResult {
  matches: ProposalMatch[]
  /** 'format' = cut at the call's own section structure; 'heuristic' = fallback. */
  splitMode: 'format' | 'heuristic'
  /** Fixed-format lines removed from the imported bodies. */
  formatLinesRemoved: number
}

/**
 * Split a full proposal, preferring the call's own format structure.
 *
 * When the document visibly follows the call's format (three or more section
 * headings match the workspace's targets), the ONLY cut points are those
 * anchored headings plus excluded material — everything between two anchors
 * belongs to the first, however many numbered lists, sub-headings, or
 * flattened tables it contains. Format instruction lines are subtracted from
 * every body. Documents that do not follow the format fall back to the
 * heading heuristics, with the same instruction scrubbing.
 */
export function splitProposalWithFormat(
  text: string,
  targets: ProposalTarget[],
  options?: { templateSections?: unknown[] }
): FormatAwareSplitResult {
  const instructionIndex = buildFormatInstructionIndex(options?.templateSections || [])
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const anchors = findFormatAnchors(lines, targets)
  const sectionAnchors = anchors.filter((anchor) => anchor.reason !== 'excluded')

  if (sectionAnchors.length < 3) {
    // Free-form document: heuristic split, but still scrub format furniture.
    let removed = 0
    const segments = splitProposalIntoSegments(text)
      .map((segment) => {
        const scrubbed = scrubFormatLines(segment.body, instructionIndex)
        removed += scrubbed.removed
        return { ...segment, body: scrubbed.text }
      })
      .filter((segment) => segment.body.length > 0)
      .map((segment, index) => ({ ...segment, order: index }))
    return {
      matches: matchSegmentsToTargets(segments, targets),
      splitMode: 'heuristic',
      formatLinesRemoved: removed,
    }
  }

  // Cut the document only at anchors, in line order.
  const cuts = [...anchors].sort((left, right) => left.lineIndex - right.lineIndex)
  let removed = 0

  interface Block {
    anchor: FormatAnchor | null
    body: string
  }

  const blocks: Block[] = []
  const preambleEnd = cuts[0].lineIndex
  if (preambleEnd > 0) {
    blocks.push({ anchor: null, body: lines.slice(0, preambleEnd).join('\n') })
  }
  for (let index = 0; index < cuts.length; index++) {
    const start = cuts[index].lineIndex + 1
    const end = index + 1 < cuts.length ? cuts[index + 1].lineIndex : lines.length
    blocks.push({ anchor: cuts[index], body: lines.slice(start, end).join('\n') })
  }

  // Scrub each body, then fold soft anchors that turned out to own no prose
  // (a table row that happened to name a section) into the block above.
  const scrubbed = blocks.map((block) => {
    const result = scrubFormatLines(block.body, instructionIndex)
    removed += result.removed
    return { ...block, body: result.text }
  })

  const folded: Block[] = []
  for (const block of scrubbed) {
    const previous = folded[folded.length - 1]
    if (
      block.anchor &&
      block.anchor.strength === 'soft' &&
      block.anchor.reason !== 'excluded' &&
      proseWordCount(block.body) < 6 &&
      previous &&
      previous.anchor &&
      previous.anchor.reason !== 'excluded'
    ) {
      previous.body = [previous.body, block.anchor.heading, block.body].filter(Boolean).join('\n')
      continue
    }
    folded.push(block)
  }

  const matches: ProposalMatch[] = []
  let order = 0
  for (const block of folded) {
    const body = block.body.trim()
    if (!body) continue
    if (!block.anchor) {
      matches.push({ heading: '', body, order: order++, targetTitle: null, matchedBy: 'none' })
      continue
    }
    if (block.anchor.reason === 'excluded') {
      matches.push({
        heading: block.anchor.heading,
        body,
        order: order++,
        targetTitle: null,
        matchedBy: 'excluded',
      })
      continue
    }
    matches.push({
      heading: block.anchor.heading,
      body,
      order: order++,
      targetTitle: block.anchor.targetTitle,
      matchedBy: block.anchor.reason,
    })
  }

  return { matches, splitMode: 'format', formatLinesRemoved: removed }
}
