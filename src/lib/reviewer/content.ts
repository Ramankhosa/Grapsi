const EMPTY_EDITOR_TEXT = new Set(['', '{}', '[]', 'null', 'undefined'])

function decodeCommonEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

export function extractMeaningfulText(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''

  if (typeof value === 'string') {
    const stripped = decodeCommonEntities(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    return EMPTY_EDITOR_TEXT.has(stripped.toLowerCase()) ? '' : stripped
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map(extractMeaningfulText).filter(Boolean).join(' ').trim()
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(extractMeaningfulText)
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  return ''
}

export function hasMeaningfulSectionContent(value: unknown): boolean {
  const text = extractMeaningfulText(value)
  if (!text) return false

  const alphanumeric = text.replace(/[^a-z0-9]/gi, '')
  return alphanumeric.length > 0
}

export function parseReviewerScore(value: unknown): number {
  const raw = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN

  if (!Number.isFinite(raw)) {
    throw new Error('Reviewer score is missing or invalid')
  }

  return Math.max(0, Math.min(10, raw))
}

export function normalizeStringArray(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const seen = new Set<string>()
  const next: string[] = []

  for (const item of items) {
    const text = extractMeaningfulText(item).replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    next.push(text)
  }

  return next
}
