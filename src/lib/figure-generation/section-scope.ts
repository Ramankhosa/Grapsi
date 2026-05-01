export type FigureSuggestionScopeMode = 'selected_sections' | 'full_draft' | 'focused_text'

export type FigureSuggestionSectionScopeMode = Exclude<FigureSuggestionScopeMode, 'focused_text'>

export interface FigureSuggestionSourceSection {
  sectionKey: string
  label?: string
}

export interface FigureSuggestionSectionScopeInput {
  mode?: FigureSuggestionSectionScopeMode
  sectionKeys?: string[]
}

export interface FigureSuggestionSectionScopeResolution {
  mode: FigureSuggestionSectionScopeMode
  sections: Record<string, string>
  sourceSections: FigureSuggestionSourceSection[]
  requestedSectionKeys: string[]
  missingSectionKeys: string[]
  emptySectionKeys: string[]
}

export function normalizeScopeSectionKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]+/g, '')
}

function cleanSectionContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupeValues(values: string[] = []): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    const cleaned = String(value || '').trim()
    const normalized = normalizeScopeSectionKey(cleaned)
    if (!cleaned || !normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(cleaned)
  }

  return out
}

export function resolveFigureSuggestionSectionScope(
  allSections: Record<string, string> | undefined | null,
  scope?: FigureSuggestionSectionScopeInput | null,
  sectionLabels: Record<string, string> = {}
): FigureSuggestionSectionScopeResolution {
  const entries = Object.entries(allSections || {})
    .filter(([sectionKey]) => !!String(sectionKey || '').trim())
    .map(([sectionKey, content], index) => ({
      sectionKey,
      content: cleanSectionContent(content),
      label: sectionLabels[sectionKey],
      index
    }))

  const mode: FigureSuggestionSectionScopeMode = scope?.mode === 'selected_sections'
    ? 'selected_sections'
    : 'full_draft'

  const requestedSectionKeys = dedupeValues(scope?.sectionKeys || [])

  if (mode === 'full_draft') {
    const nonEmptyEntries = entries.filter((entry) => entry.content)
    return {
      mode,
      sections: nonEmptyEntries.reduce<Record<string, string>>((acc, entry) => {
        acc[entry.sectionKey] = entry.content
        return acc
      }, {}),
      sourceSections: nonEmptyEntries.map((entry) => ({
        sectionKey: entry.sectionKey,
        label: entry.label
      })),
      requestedSectionKeys: [],
      missingSectionKeys: [],
      emptySectionKeys: []
    }
  }

  const entriesByNormalizedKey = new Map<string, typeof entries[number]>()
  const entriesByNormalizedLabel = new Map<string, typeof entries[number]>()
  entries.forEach((entry) => {
    const key = normalizeScopeSectionKey(entry.sectionKey)
    if (key && !entriesByNormalizedKey.has(key)) {
      entriesByNormalizedKey.set(key, entry)
    }
    const label = normalizeScopeSectionKey(entry.label)
    if (label && !entriesByNormalizedLabel.has(label)) {
      entriesByNormalizedLabel.set(label, entry)
    }
  })

  const selectedEntries: typeof entries = []
  const selectedKeys = new Set<string>()
  const missingSectionKeys: string[] = []
  const emptySectionKeys: string[] = []

  for (const requestedKey of requestedSectionKeys) {
    const normalized = normalizeScopeSectionKey(requestedKey)
    const entry = entriesByNormalizedKey.get(normalized) || entriesByNormalizedLabel.get(normalized)
    if (!entry) {
      missingSectionKeys.push(requestedKey)
      continue
    }
    if (!entry.content) {
      emptySectionKeys.push(entry.sectionKey)
      continue
    }
    if (selectedKeys.has(entry.sectionKey)) continue
    selectedKeys.add(entry.sectionKey)
    selectedEntries.push(entry)
  }

  selectedEntries.sort((left, right) => left.index - right.index)

  return {
    mode,
    sections: selectedEntries.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.sectionKey] = entry.content
      return acc
    }, {}),
    sourceSections: selectedEntries.map((entry) => ({
      sectionKey: entry.sectionKey,
      label: entry.label
    })),
    requestedSectionKeys,
    missingSectionKeys,
    emptySectionKeys
  }
}

export function buildFigureSuggestionSectionScopeError(
  resolution: FigureSuggestionSectionScopeResolution
): string | undefined {
  if (resolution.mode !== 'selected_sections') {
    return undefined
  }

  if (resolution.requestedSectionKeys.length === 0) {
    return 'Select at least one source section before requesting figure suggestions.'
  }

  if (resolution.sourceSections.length > 0) {
    return undefined
  }

  if (resolution.emptySectionKeys.length > 0 && resolution.missingSectionKeys.length === 0) {
    return 'Selected source sections do not contain draft text yet.'
  }

  if (resolution.missingSectionKeys.length > 0 && resolution.emptySectionKeys.length === 0) {
    return 'Selected source sections were not found in this draft.'
  }

  return 'Selected source sections could not be used for figure suggestions.'
}
