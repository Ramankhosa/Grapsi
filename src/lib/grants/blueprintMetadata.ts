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
  const record = asObject(value)
  if (mustCover.length === 0) {
    return undefined
  }

  const normalizedEntries = mustCover
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
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType> | null
  suggestedCitationCount?: number | null
}): GrantThematicBlueprint {
  const thematicBlueprint: GrantThematicBlueprint = {
    mustCover: [...input.mustCover],
    mustAvoid: [...input.mustAvoid],
  }

  const mustCoverTyping = input.mustCoverTyping
    ? normalizeGrantMustCoverTyping(input.mustCover, input.mustCoverTyping)
    : undefined
  const suggestedCitationCount = normalizeGrantSuggestedCitationCount(input.suggestedCitationCount)

  if (mustCoverTyping) {
    thematicBlueprint.mustCoverTyping = mustCoverTyping
  }

  if (typeof suggestedCitationCount === 'number') {
    thematicBlueprint.suggestedCitationCount = suggestedCitationCount
  }

  return thematicBlueprint
}

export function extractGrantDimensionTargets(
  sections: SectionWithDimensions[]
): GrantBlueprintDimensionTarget[] {
  return sections.flatMap((section) => {
    const mustCover = Array.isArray(section.mustCover)
      ? section.mustCover.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    if (mustCover.length === 0) {
      return []
    }

    const thematicBlueprint = asObject(section.thematicBlueprint)
    const mustCoverTyping =
      normalizeGrantMustCoverTyping(mustCover, section.mustCoverTyping)
      || normalizeGrantMustCoverTyping(mustCover, thematicBlueprint.mustCoverTyping)

    return mustCover.map((dimension) => ({
      sectionKey: section.sectionKey,
      dimension,
      ...(mustCoverTyping?.[dimension] ? { dimensionType: mustCoverTyping[dimension] } : {}),
    }))
  })
}

export function filterGrantBackedLiteratureSections<T extends { mustCover?: string[] | null }>(
  sections: T[]
): T[] {
  return sections.filter((section) =>
    Array.isArray(section.mustCover) && section.mustCover.some((dimension) => String(dimension || '').trim())
  )
}
