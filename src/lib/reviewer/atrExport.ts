/**
 * Assembling the Action Taken Report for one reviewer call.
 *
 * Extracted so both the researcher's own export and the read-only admin
 * archive produce byte-identical documents. The one difference between them is
 * `refresh`: the researcher's export regenerates a stale report first (the
 * deliverable must describe the current drafts), while the archive never does —
 * an administrator opening someone else's report must not spend that tenant's
 * LLM quota.
 */

import prisma from '@/lib/prisma'
import { buildAtrDocument } from '@/lib/reviewer/atrDocument'
import { resolveSectionVersions } from '@/lib/reviewer/finalReport'
import { ensureCurrentReport } from '@/lib/reviewer/reportGeneration'

export function asStringList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item ?? '').trim()))
    .filter(Boolean)
}

/**
 * Coerce a stored section review into the shape the document builder reads.
 * Everything the builder can render is carried through — score deltas,
 * addressed previous points, compliance flags — so a revised section's story
 * survives into the deliverable.
 */
export function normalizeSectionReview(raw: unknown): Record<string, any> {
  const review = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  return {
    ...review,
    score: typeof review.score === 'number' ? review.score : Number.parseFloat(review.score) || 0,
    summary: typeof review.summary === 'string' ? review.summary : '',
    strengths: asStringList(review.strengths),
    weaknesses: asStringList(review.weaknesses),
    suggestions: asStringList(review.suggestions),
    recommendations: asStringList(review.recommendations),
    addressed_previous_points: Array.isArray(review.addressed_previous_points)
      ? review.addressed_previous_points
      : [],
    compliance_flags: Array.isArray(review.compliance_flags) ? review.compliance_flags : [],
  }
}

export type AtrExportResult =
  | {
      ok: true
      buffer: Buffer
      filename: string
      /** 'current' | 'stale' | whatever ensureCurrentReport reports. */
      freshness: string
      regenerated: boolean
    }
  | { ok: false; status: number; error: string; code?: string }

/**
 * Build the ATR for `callId`. Access is the caller's responsibility — this
 * function assumes the caller has already established that the reader may see
 * the call.
 */
export async function buildAtrForCall(
  callId: string,
  options: { refresh?: boolean } = {}
): Promise<AtrExportResult> {
  const refresh = options.refresh
    ? await ensureCurrentReport(callId)
    : { regenerated: false, freshness: 'unknown' as string, error: null as string | null }

  const call = await prisma.reviewerCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      user_id: true,
      project_title: true,
      agency_name: true,
      overall_review_json: true,
      parsed_json: true,
    },
  })

  if (!call) {
    return { ok: false, status: 404, error: 'Call not found' }
  }

  if (!call.overall_review_json || Object.keys(call.overall_review_json as object).length === 0) {
    return {
      ok: false,
      status: 400,
      error:
        (refresh as any).error ||
        'There is no panel report to export yet. Review at least one section, then generate the report.',
      code: 'REPORT_NOT_GENERATED',
    }
  }

  // Every draft ever submitted lives in this table, so filtering on
  // `status: 'reviewed'` alone printed a revised section once per version — two
  // "Objectives" headings, two different scores, no version labels. The report
  // and the workspace both resolve to one version per title; the export has to
  // agree with them.
  const allSections = await prisma.reviewerSection.findMany({
    where: { call_id: callId },
    select: { id: true, section_title: true, version: true, status: true, ai_review_json: true },
  })

  const reviewJson = call.overall_review_json as Record<string, any>
  const scoredVersions = reviewJson?.score_basis?.scoredVersions || null
  const sections = resolveSectionVersions(allSections as any, scoredVersions)
    .effective.filter((section: any) => section.status === 'reviewed')
    .map((section: any) => ({
      id: section.id,
      section_title: section.section_title,
      version: Number(section.version || 1),
      review: normalizeSectionReview(section.ai_review_json),
    }))

  // A stale report still ships, because a stale report beats no report, but it
  // has to say so on its own face: this file gets forwarded to people who will
  // never see the warning that was on the screen.
  const staleNotice =
    refresh.freshness === 'stale'
      ? 'This report was written before the latest revisions and does not describe the current drafts. Regenerate the panel report, then export again.'
      : null

  const parsed =
    call.parsed_json && typeof call.parsed_json === 'object'
      ? (call.parsed_json as Record<string, any>)
      : {}
  const projectTitle = call.project_title || 'Untitled Project'

  // The whole stored report goes to the builder. Whitelisting keys here is what
  // silently dropped the scorecards and consistency flags from the document for
  // months; the builder reads defensively instead.
  const buffer = await buildAtrDocument({
    projectTitle,
    agencyName: call.agency_name || parsed.agency_name || null,
    callTitle: typeof parsed.title === 'string' ? parsed.title : null,
    generatedAt: typeof reviewJson.generated_at === 'string' ? reviewJson.generated_at : null,
    staleNotice,
    overall: {
      ...reviewJson,
      overall_score:
        typeof reviewJson.overall_score === 'number'
          ? reviewJson.overall_score
          : Number.parseFloat(reviewJson.overall_score) || 0,
      major_strengths: asStringList(reviewJson.major_strengths),
      major_weaknesses: asStringList(reviewJson.major_weaknesses),
      cross_sectional_recommendations: asStringList(reviewJson.cross_sectional_recommendations),
      supplementary_materials: asStringList(reviewJson.supplementary_materials),
    },
    sections,
  })

  return {
    ok: true,
    buffer,
    filename: `ATR-${projectTitle.replace(/[^a-zA-Z0-9]/g, '_')}.docx`,
    freshness: refresh.freshness,
    regenerated: Boolean(refresh.regenerated),
  }
}
