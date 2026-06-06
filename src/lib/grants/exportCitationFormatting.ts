import type { PaperDocxSection } from '@/lib/export/paper-docx-export'
import {
  extractOrderedCitationKeysFromGrantDocxSections,
  mapGrantProposalDocxSectionText,
} from '@/lib/grants/export'
import {
  citationStyleService,
  type CitationData,
} from '@/lib/services/citation-style-service'
import {
  buildCitationKeyLookup,
  citationKeyIdentity,
  normalizeCitationKey,
  resolveCitationKeyFromLookup,
  splitCitationKeyList,
} from '@/lib/utils/citation-key-normalization'

const CITE_MARKER_PATTERN = '\\[CITE:([^\\]]+)\\]'
const NUMERIC_ORDER_STYLES = new Set(['IEEE', 'VANCOUVER'])

export type GrantExportCitation = {
  id: string
  title: string
  authors?: string[] | null
  year?: number | null
  venue?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  doi?: string | null
  url?: string | null
  isbn?: string | null
  publisher?: string | null
  edition?: string | null
  sourceType?: string | null
  editors?: string[] | null
  publicationPlace?: string | null
  publicationDate?: string | null
  accessedDate?: string | null
  articleNumber?: string | null
  issn?: string | null
  journalAbbreviation?: string | null
  pmid?: string | null
  pmcid?: string | null
  arxivId?: string | null
  citationKey: string
}

function toCitationData(citation: GrantExportCitation): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: Array.isArray(citation.authors) ? citation.authors : [],
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey,
  }
}

async function resolveStyleCode(preferredStyleCode?: string | null): Promise<string> {
  const preferred = String(preferredStyleCode || process.env.DEFAULT_CITATION_STYLE || 'APA7').trim() || 'APA7'
  const preferredStyle = await citationStyleService.getCitationStyle(preferred)
  if (preferredStyle?.code) return preferredStyle.code

  if (preferred.toUpperCase() !== 'APA7') {
    const fallbackStyle = await citationStyleService.getCitationStyle('APA7')
    if (fallbackStyle?.code) return fallbackStyle.code
  }

  return 'APA7'
}

function mergeCitationOrder(primaryOrder: string[], fallbackOrder: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []

  const append = (key: string) => {
    const canonical = normalizeCitationKey(key)
    const identity = citationKeyIdentity(canonical)
    if (!canonical || !identity || seen.has(identity)) return
    seen.add(identity)
    merged.push(canonical)
  }

  primaryOrder.forEach(append)
  fallbackOrder.forEach(append)
  return merged
}

function buildCitationNumberingMap(orderedCitationKeys: string[]): Record<string, number> {
  return Object.fromEntries(orderedCitationKeys.map((citationKey, index) => [citationKey, index + 1]))
}

function buildCitationMap(citations: GrantExportCitation[]): Map<string, GrantExportCitation> {
  const map = new Map<string, GrantExportCitation>()
  for (const citation of citations) {
    const key = normalizeCitationKey(citation.citationKey)
    if (key) map.set(key, citation)
  }
  return map
}

function plainUnknownCitationLabel(key: string): string {
  const normalized = normalizeCitationKey(key)
  return normalized ? `[${normalized}]` : ''
}

export async function formatGrantProposalDocxCitations(input: {
  sections: PaperDocxSection[]
  citations: GrantExportCitation[]
  styleCode?: string | null
}): Promise<PaperDocxSection[]> {
  if (input.sections.length === 0 || input.citations.length === 0) {
    return input.sections
  }

  const styleCode = await resolveStyleCode(input.styleCode)
  const normalizedStyleCode = styleCode.toUpperCase()
  const isNumericStyle = NUMERIC_ORDER_STYLES.has(normalizedStyleCode)
  const citationLookup = buildCitationKeyLookup(input.citations.map((citation) => citation.citationKey))
  const citationMap = buildCitationMap(input.citations)
  const orderedFromDocument = extractOrderedCitationKeysFromGrantDocxSections(input.sections, citationLookup)
  const citationOrder = mergeCitationOrder(
    orderedFromDocument,
    input.citations.map((citation) => citation.citationKey)
  )
  const citationNumbering = isNumericStyle
    ? buildCitationNumberingMap(citationOrder)
    : undefined
  const formattedCache = new Map<string, string>()

  const formatCitation = async (rawKey: string): Promise<string> => {
    const canonicalKey = resolveCitationKeyFromLookup(rawKey, citationLookup) || normalizeCitationKey(rawKey)
    const citation = citationMap.get(canonicalKey)
    if (!citation) {
      return plainUnknownCitationLabel(canonicalKey)
    }

    const cacheKey = `${normalizedStyleCode}:${citation.citationKey}`
    const cached = formattedCache.get(cacheKey)
    if (cached) return cached

    try {
      const formatted = await citationStyleService.formatInTextCitation(
        toCitationData(citation),
        styleCode,
        {
          citationNumber: citationNumbering?.[citation.citationKey],
          citationNumbering,
        }
      )
      formattedCache.set(cacheKey, formatted)
      return formatted
    } catch (error) {
      console.warn('[Grant Export] citation formatting failed:', error)
      return plainUnknownCitationLabel(citation.citationKey)
    }
  }

  const formatText = async (text: string): Promise<string> => {
    const rawText = String(text || '')
    if (!/\[CITE:/i.test(rawText)) {
      return rawText
    }

    let next = ''
    let cursor = 0
    const markerRegex = new RegExp(CITE_MARKER_PATTERN, 'gi')
    let match: RegExpExecArray | null = null

    while ((match = markerRegex.exec(rawText)) !== null) {
      next += rawText.slice(cursor, match.index)
      cursor = match.index + match[0].length

      const keys = splitCitationKeyList(match[1] || '')
      const formattedParts = (await Promise.all(keys.map((key) => formatCitation(key))))
        .map((part) => part.trim())
        .filter(Boolean)
      next += formattedParts.length > 0 ? formattedParts.join(' ') : match[0]
    }

    next += rawText.slice(cursor)
    return next
  }

  return mapGrantProposalDocxSectionText(input.sections, formatText)
}
