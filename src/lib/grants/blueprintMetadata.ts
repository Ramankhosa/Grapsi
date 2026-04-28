import {
  GRANT_BLUEPRINT_DIMENSION_TYPES,
  type GrantBlueprintDimensionTarget,
  type GrantBlueprintDimensionType,
  type GrantThematicBlueprint,
} from '@/types/grant'

const DIMENSION_TYPE_SET = new Set<string>(GRANT_BLUEPRINT_DIMENSION_TYPES)

type SectionWithDimensions = {
  sectionKey: string
  mustCover?: string[] | null
  dimensions?: string[] | null
  dimensionTyping?: Record<string, unknown> | null
  mustCoverTyping?: Record<string, unknown> | null
  suggestedCitationCount?: number | null
  thematicBlueprint?: unknown
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function isGrantBackedPaperTypeCode(value: unknown): boolean {
  return String(value || '').trim().toUpperCase().startsWith('GRANT_TEMPLATE::')
}

export function normalizeGrantDimensionType(
  value: unknown,
  fallback: GrantBlueprintDimensionType = 'empirical'
): GrantBlueprintDimensionType {
  const normalized = String(value || '').trim().toLowerCase()
  return DIMENSION_TYPE_SET.has(normalized)
    ? (normalized as GrantBlueprintDimensionType)
    : fallback
}

export function normalizeGrantMustCoverTyping(
  mustCover: string[],
  value: unknown
): Record<string, GrantBlueprintDimensionType> | undefined {
  return normalizeGrantDimensionTyping(mustCover, value)
}

export function normalizeGrantDimensionTyping(
  dimensions: string[],
  value: unknown
): Record<string, GrantBlueprintDimensionType> | undefined {
  const record = asObject(value)
  if (dimensions.length === 0) {
    return undefined
  }

  const normalizedEntries = dimensions
    .map((dimension) => {
      const typedValue = record[dimension]
      return typedValue
        ? ([dimension, normalizeGrantDimensionType(typedValue)] as const)
        : null
    })
    .filter(Boolean) as Array<readonly [string, GrantBlueprintDimensionType]>

  return normalizedEntries.length > 0
    ? Object.fromEntries(normalizedEntries)
    : undefined
}

export function normalizeGrantSuggestedCitationCount(value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const rounded = Math.round(parsed)
  if (rounded < 0) return undefined
  return Math.min(rounded, 50)
}

export function buildGrantThematicBlueprint(input: {
  mustCover: string[]
  mustAvoid: string[]
  dimensions?: string[] | null
  dimensionTyping?: Record<string, GrantBlueprintDimensionType> | null
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType> | null
  suggestedCitationCount?: number | null
}): GrantThematicBlueprint {
  const dimensions = normalizeStringList(input.dimensions || [])
  const thematicBlueprint: GrantThematicBlueprint = {
    mustCover: [...input.mustCover],
    mustAvoid: [...input.mustAvoid],
  }

  const dimensionTyping = input.dimensionTyping
    ? normalizeGrantDimensionTyping(dimensions, input.dimensionTyping)
    : undefined
  const mustCoverTyping = input.mustCoverTyping
    ? normalizeGrantMustCoverTyping(input.mustCover, input.mustCoverTyping)
    : undefined
  const suggestedCitationCount = normalizeGrantSuggestedCitationCount(input.suggestedCitationCount)

  if (dimensions.length > 0) {
    thematicBlueprint.dimensions = dimensions
  }

  if (dimensionTyping) {
    thematicBlueprint.dimensionTyping = dimensionTyping
  }

  if (mustCoverTyping) {
    thematicBlueprint.mustCoverTyping = mustCoverTyping
  }

  if (typeof suggestedCitationCount === 'number') {
    thematicBlueprint.suggestedCitationCount = suggestedCitationCount
  }

  return thematicBlueprint
}

function normalizeStringList(items: unknown[] | null | undefined): string[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of items) {
    const value = String(item || '').trim().replace(/\s+/g, ' ')
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    next.push(value)
  }
  return next
}

export function resolveGrantSectionDimensions(section: SectionWithDimensions): string[] {
  const thematicBlueprint = asObject(section.thematicBlueprint)
  const directDimensions = normalizeStringList(section.dimensions || [])
  if (directDimensions.length > 0) return directDimensions

  const thematicDimensions = normalizeStringList(
    Array.isArray(thematicBlueprint.dimensions) ? thematicBlueprint.dimensions : []
  )
  return thematicDimensions
}

export function extractGrantDimensionTargets(
  sections: SectionWithDimensions[]
): GrantBlueprintDimensionTarget[] {
  return sections.flatMap((section) => {
    const dimensions = resolveGrantSectionDimensions(section)
    if (dimensions.length === 0) {
      return []
    }

    const thematicBlueprint = asObject(section.thematicBlueprint)
    const dimensionTyping =
      normalizeGrantDimensionTyping(dimensions, section.dimensionTyping)
      || normalizeGrantDimensionTyping(dimensions, thematicBlueprint.dimensionTyping)

    return dimensions.map((dimension) => ({
      sectionKey: section.sectionKey,
      dimension,
      ...(dimensionTyping?.[dimension] ? { dimensionType: dimensionTyping[dimension] } : {}),
    }))
  })
}

export function filterGrantBackedLiteratureSections<T extends SectionWithDimensions>(
  sections: T[]
): T[] {
  return sections.filter((section) =>
    resolveGrantSectionDimensions(section).length > 0
  )
}
