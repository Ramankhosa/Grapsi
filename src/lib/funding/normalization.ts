import crypto from 'crypto'
import mammoth from 'mammoth'
import { isValid, parse, parseISO } from 'date-fns'

import type { NormalizedFundingFacts } from '@/types/funding'

const DATE_FORMATS = [
  'MMMM d, yyyy',
  'MMMM d yyyy',
  'MMM d, yyyy',
  'MMM d yyyy',
  'd MMMM yyyy',
  'd MMM yyyy',
  'yyyy-MM-dd',
  'dd/MM/yyyy',
  'd/M/yyyy',
  'MM/dd/yyyy',
  'M/d/yyyy',
] as const

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'into',
  'about',
  'grant',
  'funding',
  'call',
  'program',
  'proposal',
  'application',
  'applicants',
  'projects',
  'under',
  'will',
  'must',
  'have',
  'are',
  'you',
  'can',
  'not',
  'all',
  'our',
  'their',
  'has',
  'been',
  'who',
  'which',
  'where',
  'when',
  'how',
])

export interface ExtractedFundingSourceText {
  normalizedText: string
  rawTextSnapshot?: string | null
  extractedText?: string | null
  titleHint?: string | null
  mimeType: string
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

export function normalizeWhitespace(input: string) {
  return input
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function stripHtmlToText(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const noTags = withBreaks.replace(/<[^>]+>/g, ' ')
  return normalizeWhitespace(decodeHtmlEntities(noTags))
}

function getHtmlTitleHint(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch?.[1]) {
    const title = normalizeWhitespace(decodeHtmlEntities(titleMatch[1]))
    if (title) {
      return title
    }
  }

  const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (headingMatch?.[1]) {
    const heading = normalizeWhitespace(stripHtmlToText(headingMatch[1]))
    if (heading) {
      return heading
    }
  }

  return null
}

function inferMimeType(fileName: string, mimeType?: string | null) {
  const normalizedMimeType = mimeType?.split(';')[0]?.trim().toLowerCase() || null

  if (normalizedMimeType && normalizedMimeType !== 'application/octet-stream') {
    return normalizedMimeType
  }

  const lower = fileName.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.md')) return 'text/markdown'
  return 'text/plain'
}

async function parsePdfBuffer(buffer: Buffer) {
  const pdfParse = (await import('pdf-parse-fork')).default
  const parsed = await pdfParse(buffer)
  return normalizeWhitespace(parsed.text || '')
}

async function parseDocxBuffer(buffer: Buffer) {
  const parsed = await mammoth.extractRawText({ buffer })
  return normalizeWhitespace(parsed.value || '')
}

export async function extractFundingSourceText(options: {
  buffer: Buffer
  fileName: string
  mimeType?: string | null
}) {
  const mimeType = inferMimeType(options.fileName, options.mimeType)

  if (mimeType === 'application/pdf') {
    const text = await parsePdfBuffer(options.buffer)
    return {
      normalizedText: text,
      extractedText: text,
      mimeType,
    } satisfies ExtractedFundingSourceText
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const text = await parseDocxBuffer(options.buffer)
    return {
      normalizedText: text,
      extractedText: text,
      mimeType,
    } satisfies ExtractedFundingSourceText
  }

  const raw = options.buffer.toString('utf8')
  if (mimeType === 'text/html') {
    return {
      normalizedText: stripHtmlToText(raw),
      rawTextSnapshot: raw,
      titleHint: getHtmlTitleHint(raw),
      mimeType,
    } satisfies ExtractedFundingSourceText
  }

  const normalizedText = normalizeWhitespace(raw)
  return {
    normalizedText,
    rawTextSnapshot: raw,
    mimeType,
  } satisfies ExtractedFundingSourceText
}

function safeDateIso(value: Date | null) {
  return value ? value.toISOString() : null
}

function toUtcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
}

function parseDateCandidate(value: string) {
  const trimmed = value.trim().replace(/[.,;:]$/, '')
  if (!trimmed) {
    return null
  }

  const isoDate = parseISO(trimmed)
  if (isValid(isoDate)) {
    return toUtcDateOnly(isoDate)
  }

  const parsedNative = new Date(trimmed)
  if (isValid(parsedNative)) {
    return toUtcDateOnly(parsedNative)
  }

  for (const format of DATE_FORMATS) {
    const parsed = parse(trimmed, format, new Date())
    if (isValid(parsed)) {
      return toUtcDateOnly(parsed)
    }
  }

  return null
}

function extractDate(text: string) {
  const labelledPatterns = [
    /(?:deadline|due date|closing date|close date|submission date|applications? due|last date to apply)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /(?:deadline|due date|closing date|close date|submission date|applications? due|last date to apply)\s+is\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  ]

  for (const pattern of labelledPatterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const parsed = parseDateCandidate(match[1])
      if (parsed) {
        return parsed
      }
    }
  }

  return null
}

function extractProgramIdentifier(text: string) {
  const patterns = [
    /(?:funding opportunity number|foa|call(?:\s+for\s+proposals?)?\s*(?:number|id)\b|program(?:me)?\s+(?:identifier|number|id)\b|solicitation(?:\s+number)?\b|reference\s*number\b)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return null
}

function extractAgency(text: string) {
  const labelledPatterns = [
    /(?:agency|sponsor|funding agency|organization|organisation)\s*[:\-]?\s*([^\n]{3,160})/i,
    /(?:issued by|published by)\s*[:\-]?\s*([^\n]{3,160})/i,
  ]

  for (const pattern of labelledPatterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return normalizeWhitespace(match[1]).replace(/[.;:]$/, '')
    }
  }

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const candidate = lines.find((line) =>
    /(foundation|council|ministry|department|agency|commission|institute|trust|university|government|research)/i.test(line)
  )

  return candidate ? candidate.replace(/[.;:]$/, '') : null
}

function selectTitle(text: string, titleHint?: string | null) {
  if (titleHint) {
    return titleHint
  }

  const lines = text
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)

  for (const line of lines) {
    if (line.length < 8 || line.length > 180) {
      continue
    }

    if (/^(deadline|agency|sponsor|program|funding opportunity number|eligibility)\b/i.test(line)) {
      continue
    }

    return line.replace(/[.:]$/, '')
  }

  return 'Untitled funding opportunity'
}

function extractSummary(text: string, title: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean)

  const summary = paragraphs.find((paragraph) => paragraph !== title && paragraph.length > 40) || paragraphs[1] || paragraphs[0]
  if (!summary) {
    return null
  }

  return summary.length > 320 ? `${summary.slice(0, 317).trimEnd()}...` : summary
}

function extractKeywords(text: string, agencyName?: string | null, programIdentifier?: string | null) {
  const frequency = new Map<string, number>()
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []

  for (const word of words) {
    if (STOP_WORDS.has(word)) {
      continue
    }
    frequency.set(word, (frequency.get(word) || 0) + 1)
  }

  const ranked = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([word]) => word)

  const seed = [agencyName, programIdentifier]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\s,/]+/))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 3 && !STOP_WORDS.has(value))

  return [...new Set([...seed, ...ranked])].slice(0, 10)
}

export function canonicalizeSourceUrl(sourceUrl?: string | null) {
  if (!sourceUrl) {
    return null
  }

  try {
    const url = new URL(sourceUrl.trim())
    url.hash = ''
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = ''
    }
    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'
    url.pathname = normalizedPath
    return url.toString()
  } catch {
    return sourceUrl.trim()
  }
}

export function getSourceDomain(sourceUrl?: string | null) {
  if (!sourceUrl) {
    return null
  }

  try {
    return new URL(sourceUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function buildFundingFingerprint(facts: Pick<NormalizedFundingFacts, 'title' | 'agencyName' | 'programIdentifier' | 'deadlineAt' | 'sourceUrl'>) {
  const normalized = [
    facts.sourceUrl ? `url:${canonicalizeSourceUrl(facts.sourceUrl)}` : null,
    facts.title?.trim().toLowerCase() || '',
    facts.agencyName?.trim().toLowerCase() || '',
    facts.programIdentifier?.trim().toLowerCase() || '',
    facts.deadlineAt?.trim() || '',
  ]
    .filter(Boolean)
    .join('|')

  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export function extractFundingFacts(options: {
  text: string
  sourceUrl?: string | null
  titleHint?: string | null
}): NormalizedFundingFacts {
  const normalizedText = normalizeWhitespace(options.text)
  const title = selectTitle(normalizedText, options.titleHint)
  const agencyName = extractAgency(normalizedText)
  const programIdentifier = extractProgramIdentifier(normalizedText)
  const deadlineAt = safeDateIso(extractDate(normalizedText))
  const sourceUrl = canonicalizeSourceUrl(options.sourceUrl)
  const sourceDomain = getSourceDomain(sourceUrl)
  const summary = extractSummary(normalizedText, title)
  const keywords = extractKeywords(normalizedText, agencyName, programIdentifier)

  return {
    title,
    agencyName,
    programIdentifier,
    deadlineAt,
    summary,
    keywords,
    sourceUrl,
    sourceDomain,
  }
}
