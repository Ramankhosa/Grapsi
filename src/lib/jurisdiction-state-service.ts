/**
 * Jurisdiction State Service
 *
 * Utilities for managing jurisdiction state transitions and computations
 */

export type DeleteJurisdictionComputationInput = {
  session: any
  statusMap: Record<string, any>
  jurisdictions: string[]
  normalized: string
  shouldRemove: boolean
}

export type DeleteJurisdictionComputationOutput = {
  jurisdictions: string[]
  statusMap: Record<string, any>
  nextActive: string | null
}

export function resolveSourceOfTruth(session: any, fallback?: string): string {
  try {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const preferred = typeof status.__sourceOfTruth === 'string' ? String(status.__sourceOfTruth).toUpperCase() : undefined
    const list: string[] = Array.isArray(session?.draftingJurisdictions)
      ? session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())
      : []
    if (preferred && list.includes(preferred)) return preferred
    const normalizedFallback = fallback ? fallback.toUpperCase() : undefined
    if (normalizedFallback && list.includes(normalizedFallback)) return normalizedFallback
    if (list.length > 0) return list[0]
  } catch {}
  return (fallback || 'US').toUpperCase()
}

export function computeJurisdictionStateOnDelete(
  input: DeleteJurisdictionComputationInput
): DeleteJurisdictionComputationOutput {
  let { session, statusMap, jurisdictions, normalized, shouldRemove } = input

  // Normalize list once up-front
  jurisdictions = Array.from(
    new Set(
      (jurisdictions || []).map((c: string) => (c || '').toUpperCase()).filter(Boolean)
    )
  )

  if (shouldRemove) {
    // Remove the jurisdiction from the list
    jurisdictions = jurisdictions.filter(c => c !== normalized)
  } else {
    // If not removing, ensure the jurisdiction is in the list
    if (normalized && !jurisdictions.includes(normalized)) {
      jurisdictions.push(normalized)
    }
    // For non-removal paths, we preserve the legacy guarantee of at least one jurisdiction
    if (jurisdictions.length === 0) {
      jurisdictions = ['US']
    }
  }

  // If nothing is left, clear active and source-of-truth and return early
  if (jurisdictions.length === 0) {
    if (Object.prototype.hasOwnProperty.call(statusMap, '__sourceOfTruth')) {
      delete (statusMap as any).__sourceOfTruth
    }
    return {
      jurisdictions,
      statusMap,
      nextActive: null
    }
  }

  // Re-resolve source-of-truth within the remaining set
  const priorSource = typeof (statusMap as any).__sourceOfTruth === 'string'
    ? String((statusMap as any).__sourceOfTruth).toUpperCase()
    : resolveSourceOfTruth({ ...session, draftingJurisdictions: jurisdictions })

  let nextSource = priorSource
  if (nextSource === normalized || !jurisdictions.includes(nextSource)) {
    nextSource = jurisdictions.find(c => c !== normalized) || jurisdictions[0]
  }

  if (nextSource) {
    ;(statusMap as any).__sourceOfTruth = nextSource
    jurisdictions = [nextSource, ...jurisdictions.filter(c => c !== nextSource)]
  } else if (Object.prototype.hasOwnProperty.call(statusMap, '__sourceOfTruth')) {
    delete (statusMap as any).__sourceOfTruth
  }

  const currentActive = (session?.activeJurisdiction || '').toString().toUpperCase()
  const nextActive = jurisdictions.includes(currentActive)
    ? currentActive
    : ((statusMap as any).__sourceOfTruth || jurisdictions[0] || null)

  return {
    jurisdictions,
    statusMap,
    nextActive: nextActive || null
  }
}
