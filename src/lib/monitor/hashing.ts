import { createHash } from 'node:crypto'

import { applyIgnoreRules } from './normalize'

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

/** JSON with object keys sorted at every level, so equal manifests hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

/** Fingerprint of a stage's complete effective input (see C5 in the plan). */
export function fingerprint(manifest: unknown): string {
  return sha256(canonicalJson(manifest))
}

/**
 * Lines that change on every visit without changing what a page says. Kept
 * deliberately narrow — dates near a call are evidence and must survive.
 */
const VOLATILE_LINE_PATTERNS: RegExp[] = [
  /\b(visitors?|visitor\s+count|page\s+views?|hits|total\s+visits?)\s*[:#-]?\s*[\d,]+\s*$/i,
  /^\s*(last\s+(updated|modified|reviewed)|page\s+last\s+updated)\b.{0,60}$/i,
  /^\s*(©|\(c\)|copyright)\s.*$/i,
  /^\s*(skip\s+to\s+(main\s+)?content|screen\s+reader\s+access)\s*$/i,
  // The page's own clock: "Messages at time of print 29 October 2026, 03:24
  // CET", "Page generated on …", "Server time: …". A short line naming the
  // moment of rendering, never a deadline line (those name no such moment).
  /^.{0,60}\b(at\s+(the\s+)?time\s+of\s+print(ing)?|printed\s+(on|at)|(page\s+)?generated\s+(on|at)|rendered\s+(on|at)|retrieved\s+(on|at)|accessed\s+(on|at)|current\s+(date|time)|server\s+time|local\s+time|today\s+is)\b.{0,80}$/i,
]

/**
 * Normalised text for meaning comparisons: Unicode NFC, ignore rules applied,
 * volatile lines dropped, whitespace collapsed. The raw bytes are hashed
 * separately and kept for audit.
 */
export function meaningfulText(text: string, ignorePatterns: string[] = []): string {
  const ruled = applyIgnoreRules(text.normalize('NFC'), ignorePatterns)
  return ruled
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !VOLATILE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join('\n')
}

export function meaningfulHash(text: string, ignorePatterns: string[] = []): string {
  return sha256(meaningfulText(text, ignorePatterns))
}

/**
 * A listing's meaning is the set of what it links to and says around each
 * link — not their order — so a reshuffled list is not a change.
 */
export function listingMeaningfulHash(itemFingerprints: string[]): string {
  return sha256([...new Set(itemFingerprints)].sort().join('\n'))
}
