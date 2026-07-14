import crypto from 'crypto'

import type {
  GrantAiReviewFinding,
  GrantAiReviewReport,
  GrantAiReviewSeverity,
  GrantAiReviewVerdict,
} from '@/types/grant'

/**
 * Pure helpers around the LLM section-review report. Kept dependency-free so
 * the export-readiness validator, the workspace read path, and the review
 * service can all share them without import cycles.
 */

export const GRANT_AI_REVIEW_FIELD_KEY = 'aiReviewReport'

/** Stable content identity: the review is only valid for this exact text. */
export function computeGrantContentHash(content: string): string {
  return crypto.createHash('sha1').update(String(content || '').trim()).digest('hex')
}

function asSeverity(value: unknown): GrantAiReviewSeverity {
  return value === 'critical' || value === 'important' || value === 'polish' ? value : 'important'
}

function asVerdict(value: unknown): GrantAiReviewVerdict | null {
  return value === 'ready' || value === 'minor_revisions' || value === 'major_revisions' ? value : null
}

function cleanText(value: unknown, maxLength = 600): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function cleanStringList(value: unknown, limit: number, maxLength = 300): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, limit)
}

export function normalizeGrantAiReviewFindings(value: unknown, limit = 10): GrantAiReviewFinding[] {
  if (!Array.isArray(value)) return []
  const findings: GrantAiReviewFinding[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const issue = cleanText(record.issue)
    const fix = cleanText(record.fix, 800)
    if (!issue && !fix) continue
    findings.push({
      severity: asSeverity(record.severity),
      rule: cleanText(record.rule, 300) || null,
      issue: issue || fix,
      fix: fix || issue,
    })
    if (findings.length >= limit) break
  }
  return findings
}

/** Verdict is recomputed from findings so a generous LLM can't under-report. */
export function deriveGrantAiReviewVerdict(
  findings: GrantAiReviewFinding[],
  llmVerdict?: unknown
): GrantAiReviewVerdict {
  if (findings.some((finding) => finding.severity === 'critical')) return 'major_revisions'
  if (findings.some((finding) => finding.severity === 'important')) return 'minor_revisions'
  return asVerdict(llmVerdict) === 'major_revisions' ? 'minor_revisions' : 'ready'
}

export function normalizeGrantAiReviewReport(value: unknown): GrantAiReviewReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const findings = normalizeGrantAiReviewFindings(record.findings)
  const verdict = asVerdict(record.verdict) || deriveGrantAiReviewVerdict(findings)
  const rawScore = Number(record.score)
  const reviewedContentHash = cleanText(record.reviewedContentHash, 64)
  if (!reviewedContentHash) return null
  return {
    version: 1,
    verdict,
    score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0,
    summary: cleanText(record.summary, 600),
    strengths: cleanStringList(record.strengths, 6),
    findings,
    reviewedContentHash,
    generatedAt: cleanText(record.generatedAt, 40) || new Date().toISOString(),
  }
}

/** Read the persisted report off a section's structured responses. */
export function getGrantAiReviewReportFromResponses(
  structuredResponses: Array<{ fieldKey?: string | null; responseJson?: unknown }> | null | undefined
): GrantAiReviewReport | null {
  const match = (structuredResponses || []).find(
    (response) => response?.fieldKey === GRANT_AI_REVIEW_FIELD_KEY
  )
  return match ? normalizeGrantAiReviewReport(match.responseJson) : null
}

/** True when the section text changed after its last AI review. */
export function isGrantAiReviewStale(
  report: GrantAiReviewReport | null,
  content: string | null | undefined
): boolean {
  if (!report) return false
  return report.reviewedContentHash !== computeGrantContentHash(String(content || ''))
}

export function grantAiReviewHasBlockingFindings(report: GrantAiReviewReport): boolean {
  return report.verdict === 'major_revisions'
    || report.findings.some((finding) => finding.severity === 'critical')
}
