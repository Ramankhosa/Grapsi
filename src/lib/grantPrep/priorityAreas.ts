type PriorityAreaSource = {
  disciplines?: unknown
  focusAreas?: unknown
}

function coerceStringArray(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : []

  return source
    .map((item) => (typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : ''))
    .filter(Boolean)
}

export function dedupeGrantPrepPriorityAreaLabels(values: unknown): string[] {
  const seen = new Set<string>()
  const labels: string[] = []

  for (const value of coerceStringArray(values)) {
    const key = value.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    labels.push(value)
  }

  return labels
}

export function deriveGrantPrepPriorityAreaOptions(source: PriorityAreaSource | null | undefined): string[] {
  const disciplines = dedupeGrantPrepPriorityAreaLabels(source?.disciplines)
  if (disciplines.length > 0) {
    return disciplines
  }

  return dedupeGrantPrepPriorityAreaLabels(source?.focusAreas)
}

export function normalizeGrantPrepPriorityAreaSelection(input: {
  selectedPriorityAreas?: unknown
  availablePriorityAreas?: unknown
  autoSelectSingle?: boolean
}) {
  const availablePriorityAreas = dedupeGrantPrepPriorityAreaLabels(input.availablePriorityAreas)
  const selectedPriorityAreas = dedupeGrantPrepPriorityAreaLabels(input.selectedPriorityAreas)

  if (input.autoSelectSingle && availablePriorityAreas.length === 1 && selectedPriorityAreas.length === 0) {
    return {
      selectedPriorityAreas: availablePriorityAreas,
      invalidPriorityAreas: [],
    }
  }

  if (availablePriorityAreas.length === 0) {
    return {
      selectedPriorityAreas: [],
      invalidPriorityAreas: selectedPriorityAreas,
    }
  }

  const availableByKey = new Map(
    availablePriorityAreas.map((area) => [area.toLowerCase(), area])
  )
  const normalized: string[] = []
  const invalid: string[] = []

  for (const selected of selectedPriorityAreas) {
    const match = availableByKey.get(selected.toLowerCase())
    if (!match) {
      invalid.push(selected)
      continue
    }
    if (!normalized.some((area) => area.toLowerCase() === match.toLowerCase())) {
      normalized.push(match)
    }
  }

  return {
    selectedPriorityAreas: normalized,
    invalidPriorityAreas: invalid,
  }
}
