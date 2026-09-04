/**
 * One grant-reviewer report, read-only, for the archive.
 *
 * Deliberately separate from `/api/reviewer/calls/[id]`: that route answers to
 * the owner and their project collaborators, while this one answers to platform
 * and tenant oversight and never writes, regenerates or shares anything.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireArchiveViewer, scopeAllows } from '@/lib/reportsArchive/access'
import { emptyRunner, loadRunners } from '@/lib/reportsArchive/people'
import { loadReviewerReport } from '@/lib/reportsArchive/query'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const viewer = await requireArchiveViewer(request)
  if ('response' in viewer) return viewer.response

  try {
    const report = await loadReviewerReport(params.callId)
    // A report outside the viewer's tenant is reported as missing rather than
    // forbidden: "403" on a specific id confirms that id exists.
    if (!report || !scopeAllows(viewer.scope, report.tenantId)) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    }

    const { call, sections } = report
    const runners = await loadRunners([call.user_id])
    return NextResponse.json({
      scope: viewer.scope,
      call: {
        id: call.id,
        projectTitle: call.project_title,
        agencyName: call.agency_name,
        reviewStatus: call.review_status,
        finalReviewStatus: call.final_review_status,
        parsedJson: call.parsed_json,
        overallReviewJson: call.overall_review_json,
        modelUsed: call.LLM_model_used,
        createdAt: call.created_at,
        updatedAt: call.updated_at,
        // Who ran the review, with their org placement. Blank fields mean the
        // platform does not know, not that the person has no school.
        runBy: {
          ...(runners.get(call.user_id) ?? emptyRunner(call.user_id)),
          tenantName: call.user?.tenant?.name ?? null,
        },
      },
      sections: sections.map((section) => ({
        id: section.id,
        section_title: section.section_title,
        user_input: section.user_input,
        ai_review_json: section.ai_review_json,
        status: section.status,
        version: section.version,
        is_revision: section.is_revision,
        mappingJson: section.mappingJson,
        last_reviewed_at: section.last_reviewed_at,
      })),
    })
  } catch (error) {
    console.error('Report archive reviewer detail failed:', error)
    return NextResponse.json({ error: 'Could not load this report.' }, { status: 500 })
  }
}
