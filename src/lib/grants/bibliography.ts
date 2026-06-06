import {
  buildCitationKeyLookup,
  normalizeCitationKey,
  resolveCitationKeyFromLookup,
  splitCitationKeyList,
} from '@/lib/utils/citation-key-normalization'
import { GRANT_BIBLIOGRAPHY_SECTION_KEY, isGrantBibliographySection } from '@/lib/grants/workflowMode'

const CITE_MARKER_REGEX = /\[CITE:([^\]]+)\]/gi
const LEGACY_CITATION_SPAN_REGEX = /<span\b[^>]*data-cite-key=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/span>/gi

export type GrantBibliographySourceSection = {
  sectionKey: string
  content?: string | null
  structuredResponses?: Array<{
    responseJson?: unknown
  }> | null
}

function normalizeCitationMarkupForExtraction(content: string): string {
  const raw = String(content || '')
  if (!raw) return ''

  const replaceLegacySpans = (value: string): string => value.replace(
    LEGACY_CITATION_SPAN_REGEX,
    (_full, keyA, keyB) => {
      const citationKey = String(keyA || keyB || '').trim()
      return citationKey ? `[CITE:${citationKey}]` : _full
    }
  )

  const decoded = raw
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')

  return replaceLegacySpans(replaceLegacySpans(decoded))
}

function stringifyStructuredResponse(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function extractCitationKeysFromText(content: string, lookup?: Map<string, string>): string[] {
  const text = normalizeCitationMarkupForExtraction(content)
  if (!text.trim()) return []

  const keys: string[] = []
  CITE_MARKER_REGEX.lastIndex = 0
  let match: RegExpExecArray | null = null
  while ((match = CITE_MARKER_REGEX.exec(text)) !== null) {
    for (const rawKey of splitCitationKeyList(String(match[1] || ''))) {
      const resolved = lookup
        ? resolveCitationKeyFromLookup(rawKey, lookup)
        : normalizeCitationKey(rawKey)
      if (resolved) keys.push(resolved)
    }
  }
  return keys
}

function extractGrantCitationKeyOccurrences(
  sections: GrantBibliographySourceSection[],
  availableCitationKeys: string[] = []
): string[] {
  const lookup = availableCitationKeys.length > 0
    ? buildCitationKeyLookup(availableCitationKeys)
    : undefined
  const used: string[] = []

  for (const section of sections) {
    if (!section || isGrantBibliographySection(section.sectionKey)) continue
    if (section.sectionKey === GRANT_BIBLIOGRAPHY_SECTION_KEY) continue

    used.push(...extractCitationKeysFromText(section.content || '', lookup))
    for (const response of section.structuredResponses || []) {
      used.push(...extractCitationKeysFromText(stringifyStructuredResponse(response?.responseJson), lookup))
    }
  }

  return used
}

export function collectUsedGrantCitationKeysForBibliography(
  sections: GrantBibliographySourceSection[],
  availableCitationKeys: string[] = []
): string[] {
  const seen = new Set<string>()
  const used: string[] = []

  for (const key of extractGrantCitationKeyOccurrences(sections, availableCitationKeys)) {
    const normalized = normalizeCitationKey(key)
    const identity = normalized.toLocaleLowerCase('en-US')
    if (!normalized || seen.has(identity)) continue
    seen.add(identity)
    used.push(normalized)
  }

  return used
}

export function countUsedGrantCitationKeysForBibliography(
  sections: GrantBibliographySourceSection[],
  availableCitationKeys: string[] = []
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of extractGrantCitationKeyOccurrences(sections, availableCitationKeys)) {
    const normalized = normalizeCitationKey(key)
    const identity = normalized.toLocaleLowerCase('en-US')
    if (!identity) continue
    counts[identity] = (counts[identity] || 0) + 1
  }
  return counts
}
