import type { NextApiRequest, NextApiResponse } from 'next'

import prisma from '@/lib/prisma'
import { resolveSectionVersions } from '@/lib/reviewer/finalReport'

/**
 * Public, token-gated read of a shared panel report.
 *
 * `share-report.ts` has always minted a token and handed the user a
 * `/shared-report/<token>` link, but the route that link resolves against did
 * not exist — every shared report 404'd at the fetch. This is that route.
 *
 * It is deliberately the only unauthenticated reviewer endpoint, so it is
 * narrow by construction:
 *   - the token must match *and* the call must still be flagged public, so
 *     un-sharing is immediate rather than cosmetic;
 *   - only report-facing columns are selected — never `user_id`, `tenantId`,
 *     `call_input_data`, or `raw_text_backup`;
 *   - a call with no generated report is a 404 rather than an empty shell.
 */

interface SharedReportPreferences {
  displayMode?: 'single' | 'parallel'
  versionSelections?: Record<string, number>
}

function asRecord(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

/**
 * Only the call context a reader needs to make sense of the verdict. The rest
 * of `parsed_json` is the reviewer's internal rule set, which carries the
 * agency's extracted source text and is not the sharer's to publish.
 */
function publicCallContext(parsedJson: Record<string, any>, preferences: SharedReportPreferences) {
  return {
    report_preferences: preferences,
    title: parsedJson.title || null,
    agency_name: parsedJson.agency_name || null,
    call_summary: parsedJson.call_summary || null,
    submission_deadline: parsedJson.submission_deadline || null,
    rules_source: parsedJson.rules_source || null,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` })
  }

  const token = String(req.query.token || '').trim()
  if (!token) {
    return res.status(400).json({ error: 'A share token is required' })
  }

  try {
    const call = await prisma.reviewerCall.findFirst({
      where: { share_token: token, is_public: true },
      select: {
        id: true,
        project_title: true,
        agency_name: true,
        overall_review_json: true,
        parsed_json: true,
        created_at: true,
        updated_at: true,
      },
    })

    // One response for "no such token", "revoked", and "never generated": a
    // public endpoint should not let a caller distinguish them.
    if (!call || !call.overall_review_json || Object.keys(call.overall_review_json as object).length === 0) {
      return res.status(404).json({ error: 'Report not found or no longer available' })
    }

    const parsedJson = asRecord(call.parsed_json)
    const preferences: SharedReportPreferences = asRecord(parsedJson.report_preferences)
    const overall = asRecord(call.overall_review_json)

    const allSections = await prisma.reviewerSection.findMany({
      where: { call_id: call.id },
      select: {
        id: true,
        section_title: true,
        user_input: true,
        version: true,
        status: true,
        ai_review_json: true,
        last_reviewed_at: true,
        context_summary: true,
      },
    })

    const reviewed = allSections.filter(
      (section) =>
        section.status === 'reviewed'
        && section.ai_review_json
        && Object.keys(section.ai_review_json as object).length > 0
    )

    // The versions the stored report was actually built from. Falling back to
    // the sharer's picker choice, then to the newest draft, keeps reports
    // written before `score_basis` existed rendering correctly.
    const scoredVersions = asRecord(overall.score_basis).scoredVersions
    const versionSelections =
      (scoredVersions && typeof scoredVersions === 'object' ? scoredVersions : null)
      || preferences.versionSelections
      || null

    // Parallel view is a version comparison, so it needs every draft. Single
    // view renders the list verbatim and would otherwise print a revised
    // section once per version.
    const sections =
      preferences.displayMode === 'parallel'
        ? reviewed
        : resolveSectionVersions(reviewed as any, versionSelections).effective

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      call: {
        id: call.id,
        project_title: call.project_title,
        agency_name: call.agency_name,
        overall_review_json: call.overall_review_json,
        parsed_json: publicCallContext(parsedJson, preferences),
        created_at: call.created_at,
        updated_at: call.updated_at,
      },
      sections,
    })
  } catch (error) {
    console.error('Error loading shared report:', error)
    return res.status(500).json({ error: 'Failed to load the shared report' })
  }
}
