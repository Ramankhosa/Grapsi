/**
 * Grant Diagram Studio — grant-native context adapter.
 *
 * Builds the LLM context directly from GrantSectionDraft rows (content,
 * purpose, must-cover) and FundingCall metadata — no shadow paper session.
 */

import crypto from 'crypto'

export interface DiagramSectionContext {
  sectionKey: string
  label: string
  purpose?: string
  mustCover: string[]
  content: string
}

export interface DiagramGenerationContext {
  callTitle?: string
  durationMonthsHint?: number
  sections: DiagramSectionContext[]
}

const MAX_SECTION_CHARS = 9000

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12)
}

export interface SectionDraftLike {
  sectionKey: string
  label: string
  purpose?: string | null
  mustCoverJson?: unknown
  content?: string | null
}

export function buildDiagramSectionContext(draft: SectionDraftLike): DiagramSectionContext {
  const content = (draft.content || '').trim()
  return {
    sectionKey: draft.sectionKey,
    label: draft.label,
    purpose: draft.purpose?.trim() || undefined,
    mustCover: toStringArray(draft.mustCoverJson),
    content: content.length > MAX_SECTION_CHARS ? `${content.slice(0, MAX_SECTION_CHARS)}\n[...truncated]` : content,
  }
}

/**
 * Best-effort project duration (in months) from funding-call metadata; used
 * to anchor Gantt total length when the workplan text does not state one.
 */
export function extractDurationMonthsHint(fundingCall?: {
  extractedFacts?: unknown
  normalizedMetadata?: unknown
  project_duration_max_months?: number | null
  project_duration_min_months?: number | null
} | null): number | undefined {
  const explicit = fundingCall?.project_duration_max_months || fundingCall?.project_duration_min_months
  if (explicit && explicit >= 3 && explicit <= 120) return explicit

  const candidates: unknown[] = []
  if (fundingCall?.normalizedMetadata) candidates.push(fundingCall.normalizedMetadata)
  if (fundingCall?.extractedFacts) candidates.push(fundingCall.extractedFacts)

  for (const candidate of candidates) {
    const found = findDurationMonths(candidate, 0)
    if (found) return found
  }
  return undefined
}

function findDurationMonths(value: unknown, depth: number): number | undefined {
  if (depth > 4 || value == null) return undefined
  if (typeof value === 'string') {
    const match = value.match(/(\d{1,3})\s*(?:months?|mos?\b)/i)
    if (match) {
      const months = Number(match[1])
      if (months >= 3 && months <= 120) return months
    }
    const years = value.match(/(\d{1,2})\s*(?:years?|yrs?\b)/i)
    if (years) {
      const months = Number(years[1]) * 12
      if (months >= 6 && months <= 120) return months
    }
    return undefined
  }
  if (typeof value === 'number') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDurationMonths(item, depth + 1)
      if (found) return found
    }
    return undefined
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (/duration/i.test(key)) {
        if (typeof val === 'number' && val >= 3 && val <= 120) return Math.round(val)
        const found = findDurationMonths(val, depth + 1)
        if (found) return found
      }
    }
    for (const val of Object.values(value as Record<string, unknown>)) {
      const found = findDurationMonths(val, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

/** Fingerprint of the source content a diagram was generated from. */
export function computeSourceFingerprint(sections: DiagramSectionContext[]): string {
  const payload = sections
    .map(section => `${section.sectionKey}\n${section.content}`)
    .join('\n---\n')
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32)
}
