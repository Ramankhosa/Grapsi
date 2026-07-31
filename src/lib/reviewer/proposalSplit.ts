import { bucketFromText } from '@/lib/reviewer/buckets'

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

/**
 * Common real-world wordings for each reviewer section. This is what makes
 * "Aims & Objectives", "Objective of the Study", and "Specific Aims" all land
 * on the objectives section. Multi-word entries are preferred over single
 * words, so "budget justification" beats a bare "budget".
 */
const SECTION_SYNONYMS: Record<string, string[]> = {
  summary: [
    'executive summary', 'project summary', 'abstract', 'summary', 'synopsis',
    'overview', 'project brief', 'brief description', 'précis', 'precis',
  ],
  problem_need: [
    'statement of the problem', 'problem statement', 'statement of need',
    'needs assessment', 'need for the study', 'rationale', 'justification for the project',
    'background', 'context', 'motivation', 'significance', 'introduction',
    'problem', 'need', 'relevance', 'alignment with the call', 'innovation',
    'novelty', 'state of the art', 'literature review', 'review of literature',
  ],
  objectives: [
    'aims and objectives', 'goals and objectives', 'specific aims',
    'objective of the study', 'objectives of the project', 'research questions',
    'research question', 'hypothesis', 'hypotheses', 'objectives', 'objective',
    'aims', 'aim', 'goals', 'goal', 'targets',
  ],
  methodology: [
    'materials and methods', 'proposed methodology', 'research methodology',
    'technical approach', 'research design', 'study design', 'experimental design',
    'method of study', 'methodology', 'methods', 'method', 'approach',
    'technical plan', 'scientific approach', 'work methodology',
  ],
  workplan: [
    'work plan', 'workplan', 'plan of work', 'implementation plan',
    'project schedule', 'time schedule', 'timeline', 'time frame', 'timeframe',
    'milestones', 'milestone chart', 'gantt chart', 'activities', 'work packages',
    'work breakdown', 'phasing', 'schedule',
  ],
  budget: [
    'budget justification', 'budget breakdown', 'detailed budget',
    'budget estimate', 'estimated expenditure', 'financial plan', 'funds requested',
    'cost estimate', 'budget summary', 'budget', 'costs', 'cost', 'finance',
  ],
  evaluation: [
    'monitoring and evaluation', 'evaluation plan', 'monitoring plan',
    'success criteria', 'performance indicators', 'key indicators',
    'evaluation', 'monitoring', 'indicators', 'metrics', 'assessment',
  ],
  impact_outcomes: [
    'expected outcomes', 'expected outcome', 'expected results', 'anticipated impact',
    'societal impact', 'economic impact', 'outcomes and impact', 'benefits',
    'dissemination', 'utilisation', 'utilization', 'impact', 'outcomes', 'outcome',
    'deliverables', 'expected deliverables', 'outputs',
  ],
  team: [
    'team composition', 'project team', 'investigators', 'principal investigator',
    'key personnel', 'personnel', 'expertise', 'qualifications', 'team',
    'institutional capability', 'facilities available', 'infrastructure',
    'facilities', 'organisation profile', 'organization profile',
  ],
  sustainability_risk: [
    'risk and mitigation', 'risk mitigation', 'risk analysis', 'risk assessment',
    'risks', 'risk', 'mitigation', 'contingency plan', 'contingency',
    'sustainability', 'sustainability plan', 'limitations', 'challenges',
    'exit strategy',
  ],
}

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
function containsPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false
  if (haystack === needle) return true
  return new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(haystack)
}

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

/** Longest matching synonym across all buckets, or null. */
function matchSynonymBucket(headingNorm: string): { bucketKey: string; length: number } | null {
  let best: { bucketKey: string; length: number } | null = null
  for (const [bucketKey, phrases] of Object.entries(SECTION_SYNONYMS)) {
    for (const phrase of phrases) {
      if (!containsPhrase(headingNorm, phrase)) continue
      if (!best || phrase.length > best.length) best = { bucketKey, length: phrase.length }
    }
  }
  return best
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

  const byBucket = new Map<string, string>()
  for (const entry of prepared) {
    if (entry.bucketKey && !byBucket.has(entry.bucketKey)) {
      byBucket.set(entry.bucketKey, entry.target.title)
    }
  }

  const direct: ProposalMatch[] = segments.map((segment) => {
    const headingCore = stripHeadingDecoration(segment.heading)
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
      const title = byBucket.get(synonym.bucketKey)
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
      const title = bucket !== 'other' ? byBucket.get(bucket) : undefined
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

  for (const rule of templateSections || []) {
    const label = String(rule?.label || '').trim()
    if (!label) continue
    const bucket = rule?.bucketKey || bucketFromText(label)
    const target = Array.from(byTitle.values()).find((item) => item.bucketKey === bucket)
    if (!target) continue
    if (normalizeTitle(target.title) !== normalizeTitle(label)) {
      target.aliases = Array.from(new Set([...(target.aliases || []), label]))
    }
    // Surface the tightest limit on the bucket section so the preview can warn.
    if (rule?.wordLimit && (!target.wordLimit || rule.wordLimit < target.wordLimit)) target.wordLimit = rule.wordLimit
    if (rule?.charLimit && (!target.charLimit || rule.charLimit < target.charLimit)) target.charLimit = rule.charLimit
  }

  return Array.from(byTitle.values())
}

export function countProposalWords(text: string): number {
  return (String(text || '').match(/\S+/g) || []).length
}
