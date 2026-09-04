/**
 * One funding-intelligence (idea analysis) run, read-only, for the archive.
 *
 * The researcher's own route resolves the run by `(id, userId)`, so it can
 * never serve an oversight view. This one resolves by id and checks tenant
 * scope instead, and returns the stored payloads only — nothing here can
 * re-execute a stage.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireArchiveViewer, scopeAllows } from '@/lib/reportsArchive/access'
import { emptyRunner, loadRunners } from '@/lib/reportsArchive/people'
import { loadFundingIntelligenceReport } from '@/lib/reportsArchive/query'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { runId: string } }) {
  const viewer = await requireArchiveViewer(request)
  if ('response' in viewer) return viewer.response

  try {
    const report = await loadFundingIntelligenceReport(params.runId)
    if (!report || !scopeAllows(viewer.scope, report.tenantId)) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    }

    const { run, owner } = report
    const runners = await loadRunners([run.userId])
    return NextResponse.json({
      scope: viewer.scope,
      run: {
        id: run.id,
        sessionId: run.sessionId,
        title: run.title,
        ideaText: run.ideaText,
        status: run.status,
        currentStage: run.currentStage,
        structuredIdea: run.structuredIdeaJson,
        retrievalResults: run.retrievalResultsJson,
        analysis: run.analysisJson,
        scores: run.scoresJson,
        report: run.reportJson,
        errorMessage: run.errorMessage,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        runBy: {
          ...(runners.get(run.userId) ?? emptyRunner(run.userId)),
          tenantName: owner?.tenant?.name ?? null,
        },
      },
    })
  } catch (error) {
    console.error('Report archive funding-intelligence detail failed:', error)
    return NextResponse.json({ error: 'Could not load this report.' }, { status: 500 })
  }
}
