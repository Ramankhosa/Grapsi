import { randomBytes } from 'node:crypto'
import { fingerprint } from './hashing'

export const EVIDENCE_VERSION = 'evidence-1'
export interface EvidenceSegment {
  id: string; resourceId: string; versionId: string; url: string
  role: 'CALL_NOTICE' | 'GUIDELINES' | 'ANNEXURE' | 'CORRIGENDUM'
  page: number | null; text: string; complete: boolean
}
export interface FieldEvidence { segment: string; quote: string; coverage: 'COMPLETE' | 'PARTIAL' | 'MISSING_EVIDENCE' }
export function normalQuote(text: string) { return text.normalize('NFC').replace(/\s+/g, ' ').trim() }
export function verifyCitation(citation: unknown, segments: EvidenceSegment[]): citation is FieldEvidence {
  if (!citation || typeof citation !== 'object') return false
  const c = citation as FieldEvidence
  const segment = segments.find(s => s.id === c.segment)
  return Boolean(segment && typeof c.quote === 'string' && normalQuote(c.quote).length >= 3 &&
    normalQuote(segment.text).includes(normalQuote(c.quote)) &&
    (c.coverage === 'PARTIAL' || (c.coverage === 'COMPLETE' && segment.complete)))
}
export function evidenceFingerprint(segments: EvidenceSegment[], context: unknown) {
  return fingerprint({ version: EVIDENCE_VERSION, segments: segments.map(s => ({
    source: s.url, role: s.role, page: s.page, complete: s.complete, text: normalQuote(s.text),
  })), context })
}
export function renderEvidence(segments: EvidenceSegment[], maxChars = 60_000) {
  const nonce = randomBytes(18).toString('hex')
  let remaining = maxChars
  const selected: EvidenceSegment[] = []
  for (const s of segments) {
    if (remaining <= 0) break
    const text = s.text.slice(0, remaining)
    selected.push({ ...s, id: `E${selected.length + 1}`, text, complete: s.complete && text.length === s.text.length })
    remaining -= text.length
  }
  return {
    segments: selected,
    manifest: selected.map(({ text: _, ...s }) => s),
    prompt: selected.map(s => `BEGIN_${nonce} ${JSON.stringify({ id: s.id, url: s.url, page: s.page, role: s.role, complete: s.complete })}\n${s.text.replace(/BEGIN_|END_/g, '[escaped delimiter]')}\nEND_${nonce}`).join('\n'),
  }
}
export type Lifecycle = 'OPEN' | 'ROLLING' | 'FUTURE' | 'EXPIRED' | 'UNKNOWN' | 'WITHDRAWN' | 'CANCELLED' | 'POSTPONED' | 'REOPENED'
export function lifecycleAt(closeDate: string | null, opensOn: string | null, explicit: string | null, now = new Date()): Lifecycle {
  if (['WITHDRAWN', 'CANCELLED', 'POSTPONED'].includes(explicit ?? '')) return explicit as Lifecycle
  // Date-only deadlines expire at end of the stated day in IST, not UTC midnight.
  if (closeDate && /^\d{4}-\d{2}-\d{2}$/.test(closeDate) && now.getTime() > Date.parse(`${closeDate}T23:59:59+05:30`)) return 'EXPIRED'
  if (opensOn && Date.parse(`${opensOn}T00:00:00+05:30`) > now.getTime()) return 'FUTURE'
  if (['REOPENED', 'ROLLING'].includes(explicit ?? '')) return explicit as Lifecycle
  if (closeDate && /^\d{4}-\d{2}-\d{2}$/.test(closeDate)) return 'OPEN'
  return 'UNKNOWN'
}
