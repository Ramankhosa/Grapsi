export function isNumberedHeading(label: string): boolean {
  // Matches: "1. Title", "01. Title", "1) Title"
  return /^\s*\d+\s*[\.\)]\s+/.test(label || '')
}

export function ensureDisplayOrder(value: unknown, context: string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid displayOrder (${String(value)}) for ${context}. Configure it in /super-admin/jurisdiction-config.`)
  }
  return n
}

export function resolveDisplayOrder(
  args: {
    countryDisplayOrder: unknown
    supersetDisplayOrder?: unknown
    supersetCode?: unknown
    context: string
  }
): number {
  // Country override takes precedence when present
  if (args.countryDisplayOrder !== null && args.countryDisplayOrder !== undefined) {
    return ensureDisplayOrder(args.countryDisplayOrder, args.context)
  }

  // Otherwise inherit superset default order (still DB-driven)
  if (args.supersetDisplayOrder !== null && args.supersetDisplayOrder !== undefined) {
    return ensureDisplayOrder(args.supersetDisplayOrder, args.context)
  }

  // Final fallback: try to parse from supersetCode like "07. Summary"
  const m = String(args.supersetCode || '').match(/^\s*(\d+)\s*[\.\)]\s+/)
  if (m) {
    return ensureDisplayOrder(Number(m[1]), args.context)
  }

  throw new Error(`Invalid displayOrder (null) for ${args.context}. Configure it in /super-admin/jurisdiction-config.`)
}

export function formatNumberedHeading(displayOrder: number, heading: string, padTo = 2): string {
  const raw = String(heading || '').trim()
  if (!raw) return raw
  if (isNumberedHeading(raw)) return raw
  const prefix = String(displayOrder).padStart(padTo, '0')
  return `${prefix}. ${raw}`
}


