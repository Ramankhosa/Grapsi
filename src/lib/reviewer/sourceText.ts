import crypto from 'crypto'

import mammoth from 'mammoth'

import {
  assertSafePublicHttpsUrl,
  fetchBinaryDocumentFromUrl,
  fetchReadableUrlContent,
  normalizeMultilineText,
  normalizeUrl,
} from '@/lib/fundingIntake/utils'

export const MAX_REVIEWER_SOURCE_CHARS = 45000
export const MAX_REVIEWER_SOURCE_URLS = 3

export type ReviewerSourceKind = 'html' | 'pdf' | 'docx'

export interface ReviewerSourceDocument {
  url: string
  finalUrl: string
  kind: ReviewerSourceKind
  text: string
  chars: number
  httpStatus?: number
  contentType?: string
}

const BINARY_URL_PATTERN = /\.(pdf|docx)(?:$|[?#])/i
const PDF_CONTENT_TYPE = /application\/(pdf|x-pdf)/i
const DOCX_CONTENT_TYPE = /wordprocessingml|application\/vnd\.openxmlformats/i

function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')
}

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/** Legacy binary Office format (.doc/.xls/.ppt), as opposed to the zip-based .docx. */
function looksLikeLegacyOfficeBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(OLE2_MAGIC)
}

async function parsePdf(bytes: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse-fork')).default
  const parsed = await pdfParse(bytes)
  return normalizeMultilineText(parsed.text || '')
}

async function parseDocx(bytes: Buffer): Promise<string> {
  const parsed = await mammoth.extractRawText({ buffer: bytes })
  return normalizeMultilineText(parsed.value || '')
}

/**
 * Read an uploaded proposal file into plain text. PDF and DOCX go through the
 * same parsers the URL fetchers use; anything else is treated as UTF-8 text.
 */
export async function extractTextFromDocumentBytes(
  bytes: Buffer,
  filename?: string | null
): Promise<{ text: string; kind: ReviewerSourceKind | 'text' }> {
  const name = String(filename || '').toLowerCase()

  if (looksLikePdf(bytes) || name.endsWith('.pdf')) {
    return { text: await parsePdf(bytes), kind: 'pdf' }
  }

  // Word 97-2003 (.doc) is an OLE2 compound file, which mammoth cannot read.
  // Without this it would fall through to the UTF-8 branch and import a page of
  // binary garbage as if it were the proposal.
  if (looksLikeLegacyOfficeBinary(bytes) || name.endsWith('.doc')) {
    throw new Error(
      'This looks like an old Word .doc file, which cannot be read. Open it in Word and use Save As to create a .docx (or export a PDF), then upload that.'
    )
  }

  // DOCX is a zip; the PK magic plus the extension is enough to route it.
  if (name.endsWith('.docx') || bytes.subarray(0, 2).toString('latin1') === 'PK') {
    return { text: await parseDocx(bytes), kind: 'docx' }
  }

  return { text: normalizeMultilineText(bytes.toString('utf8')), kind: 'text' }
}

async function fetchBinarySource(url: string): Promise<ReviewerSourceDocument> {
  const { bytes, contentType, finalUrl } = await fetchBinaryDocumentFromUrl(url)
  if (bytes.length === 0) {
    throw new Error('The document at this URL was empty')
  }

  const isPdf = looksLikePdf(bytes) || PDF_CONTENT_TYPE.test(contentType)
  const text = isPdf ? await parsePdf(bytes) : await parseDocx(bytes)

  return {
    url,
    finalUrl: finalUrl.toString(),
    kind: isPdf ? 'pdf' : 'docx',
    text,
    chars: text.length,
    contentType,
  }
}

/**
 * Fetch a single funding-call source (web page, PDF, or DOCX) and return its
 * readable text. Uses the funding-intake fetchers so SSRF protection, byte
 * caps, redirect limits, and TLS tolerance behave exactly as they do for
 * funding-call ingestion.
 */
export async function fetchReviewerSourceDocument(rawUrl: string): Promise<ReviewerSourceDocument> {
  const url = normalizeUrl(rawUrl)
  await assertSafePublicHttpsUrl(url)

  if (BINARY_URL_PATTERN.test(url)) {
    return fetchBinarySource(url)
  }

  const readable = await fetchReadableUrlContent(url)
  const contentType = String(readable.fetchMetadata.contentType || '')

  // Some portals serve a PDF from an extension-less URL; retry as a binary
  // download rather than handing PDF byte soup to the extractor.
  if (PDF_CONTENT_TYPE.test(contentType) || DOCX_CONTENT_TYPE.test(contentType)) {
    return fetchBinarySource(url)
  }

  return {
    url,
    finalUrl: String(readable.fetchMetadata.fetchedUrl || url),
    kind: 'html',
    text: readable.normalizedText,
    chars: readable.normalizedText.length,
    httpStatus: Number(readable.fetchMetadata.httpStatus) || undefined,
    contentType,
  }
}

const HIGH_SIGNAL_PATTERN =
  /\b(must|shall|should|required|mandatory|eligible|eligibility|ineligible|priority|criteri(?:a|on)|evaluat|review|assess|score|scoring|weightage|marks|budget|cost|grant|funding|amount|duration|timeline|deadline|submit|submission|portal|upload|attach|annex|enclosure|page|word|character|font|format|template|proforma|deliverable|milestone|outcome|report|prohibited|not\s+allowed|cannot|may\s+not|disqualif)\b|[$€£₹]|\d+\s*(?:%|pages?|words?|characters?|months?|years?|lakhs?|crores?)/gi

const CHUNK_SIZE = 1600
const SEPARATOR = '\n\n[...]\n\n'
/**
 * Share of the budget the head/tail of the document may claim. A call's rules
 * usually sit in the middle (eligibility tables, criteria, annexure formats),
 * so edges get a reservation rather than first claim on the whole budget.
 */
const EDGE_BUDGET_RATIO = 0.4

/**
 * Compress long source text down to `maxChars` while keeping the parts a
 * reviewer-rules extractor actually needs: the head and tail of the document
 * (title block, deadline and signature blocks, annexures) plus the rule-densest
 * passages from the body.
 */
export function selectReviewerSourceText(source: string, maxChars = MAX_REVIEWER_SOURCE_CHARS): string {
  const normalized = normalizeMultilineText(source)
  if (normalized.length <= maxChars) return normalized

  const chunks = normalized.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) || [normalized]
  const selected = new Set<number>()
  let selectedLength = 0

  const tryAdd = (index: number, budget: number): boolean => {
    if (selected.has(index)) return false
    const cost = chunks[index].length + SEPARATOR.length
    if (selectedLength + cost > budget) return false
    selected.add(index)
    selectedLength += cost
    return true
  }

  // Edges, alternating head/tail, bounded so they cannot crowd out the body.
  const edgeBudget = Math.max(CHUNK_SIZE, Math.floor(maxChars * EDGE_BUDGET_RATIO))
  for (let offset = 0; offset < Math.min(4, chunks.length); offset += 1) {
    tryAdd(offset, edgeBudget)
    tryAdd(chunks.length - 1 - offset, edgeBudget)
  }

  const ranked = chunks
    .map((chunk, index) => ({ index, score: chunk.match(HIGH_SIGNAL_PATTERN)?.length || 0 }))
    .sort((left, right) => right.score - left.score || left.index - right.index)

  for (const candidate of ranked) {
    tryAdd(candidate.index, maxChars)
  }

  return Array.from(selected)
    .sort((left, right) => left - right)
    .map((index) => chunks[index].trim())
    .join(SEPARATOR)
    .slice(0, maxChars)
}

export interface ReviewerSourceBundle {
  urls: string[]
  documents: ReviewerSourceDocument[]
  skipped: Array<{ url: string; reason: string }>
  combinedText: string
  promptText: string
  sourceHash: string
  totalChars: number
  promptChars: number
  truncated: boolean
}

/**
 * Below this a page carries no extractable rules — it is a redirect stub, a
 * cookie wall, or a JS-only shell. Deliberately low: a one-paragraph annexure
 * page is short but still worth reading.
 */
const MIN_USABLE_SOURCE_CHARS = 120

/**
 * Fetch every supplied URL and assemble one compacted prompt payload plus a
 * content fingerprint. The fingerprint is what lets a repeat analysis of the
 * same call reuse a previous extraction instead of paying for it again.
 */
export async function buildReviewerSourceBundle(rawUrls: string[]): Promise<ReviewerSourceBundle> {
  const urls = Array.from(
    new Set(
      rawUrls
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    )
  ).slice(0, MAX_REVIEWER_SOURCE_URLS)

  if (urls.length === 0) {
    throw new Error('At least one funding call URL is required')
  }

  const documents: ReviewerSourceDocument[] = []
  const skipped: Array<{ url: string; reason: string }> = []

  for (const url of urls) {
    try {
      const document = await fetchReviewerSourceDocument(url)
      if (document.text.trim().length < MIN_USABLE_SOURCE_CHARS) {
        skipped.push({ url, reason: 'the page returned almost no readable text' })
        continue
      }
      documents.push(document)
    } catch (error) {
      skipped.push({ url, reason: error instanceof Error ? error.message : 'could not be fetched' })
    }
  }

  if (documents.length === 0) {
    throw new Error(
      `Could not read any of the supplied URLs. ${skipped
        .map((entry) => `${entry.url}: ${entry.reason}`)
        .join(' | ')}`
    )
  }

  const combinedText = documents
    .map((document) => `### SOURCE: ${document.finalUrl} (${document.kind})\n${document.text}`)
    .join('\n\n')

  const promptText = selectReviewerSourceText(combinedText)

  return {
    urls: documents.map((document) => document.url),
    documents,
    // Reported rather than swallowed: a link the user supplied and we ignored
    // has to show up in the analysis result.
    skipped,
    combinedText,
    promptText,
    sourceHash: crypto.createHash('sha256').update(combinedText).digest('hex'),
    totalChars: combinedText.length,
    promptChars: promptText.length,
    truncated: promptText.length < combinedText.length,
  }
}
