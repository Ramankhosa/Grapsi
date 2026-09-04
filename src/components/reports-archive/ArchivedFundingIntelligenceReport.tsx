'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, CheckCircle2, Printer, ShieldCheck } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import CoverageMap from '@/components/funding-intelligence/CoverageMap'
import GapList, { type GapDirection } from '@/components/funding-intelligence/GapList'
import PriorWorkList from '@/components/funding-intelligence/PriorWorkList'
import { fallbackPriorWork } from '@/components/funding-intelligence/priorWorkFallback'
import type { PriorWork } from '@/lib/ideaIntelligence/priorWork'

interface ArchivedRun {
  id: string
  title: string
  ideaText: string
  status: string
  currentStage: number
  structuredIdea: Record<string, any> | null
  retrievalResults: Record<string, any> | null
  analysis: Record<string, any> | null
  scores: Record<string, any> | null
  report: Record<string, any> | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  runBy: {
    userId: string
    name: string | null
    email: string | null
    employeeId: string | null
    designation: string | null
    department: string | null
    school: string | null
    tenantName: string | null
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asStrings(value: unknown) {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : []
}

/**
 * A completed funding-intelligence analysis, rendered read-only for oversight.
 *
 * It shows what the run actually recorded — the retrieved prior work, the
 * coverage map, the evidenced openings and the report's own conclusions — using
 * the same components the researcher's workspace uses. Every onward action from
 * that workspace is absent: "who funds this", refinement, Grant Prep handoff and
 * Idea Bank export all write or spend quota against the owner's account.
 */
export default function ArchivedFundingIntelligenceReport({
  runId,
  basePath,
}: {
  runId: string
  basePath: string
}) {
  const { authFetch } = useAuth()

  const [run, setRun] = useState<ArchivedRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await authFetch(`/api/reports-archive/funding-intelligence/${runId}`)
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${response.status})`)
        }
        const data = await response.json()
        if (!cancelled) setRun(data.run)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this report.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [authFetch, runId])

  /**
   * Same resolution the researcher's own workspace uses, so the two views agree:
   * runs from before the prior-work pass have no merged list stored and fall
   * back to the awards they retrieved.
   */
  const priorWork = useMemo<PriorWork | null>(() => {
    if (!run) return null
    const stored = (run.scores?.priorWork || null) as PriorWork | null
    if (stored) return stored
    const projects = run.retrievalResults?.projects
    return Array.isArray(projects) && projects.length ? fallbackPriorWork(projects as any) : null
  }, [run])
  const directions = useMemo<GapDirection[]>(
    () => (Array.isArray(run?.report?.whitespaceDirections) ? run!.report!.whitespaceDirections : []),
    [run]
  )
  const patentsSearched = Boolean(
    run?.retrievalResults?.sourcesUsed?.patents ?? run?.retrievalResults?.patents?.length
  )

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-teal-700" />
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Report unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{error || 'This analysis could not be loaded.'}</p>
          <Link
            href={basePath}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the archive
          </Link>
        </div>
      </div>
    )
  }

  const ownerLine = [
    run.runBy?.name || run.runBy?.email || 'Run by an unnamed account',
    run.runBy?.school,
    run.runBy?.department,
    run.runBy?.tenantName,
    `Run ${new Date(run.createdAt).toLocaleDateString()}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div>
            <Link
              href={basePath}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Report archive
            </Link>
            <p className="mt-2 text-xs text-slate-500">{ownerLine}</p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print
          </button>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Funding intelligence</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{run.title}</h1>
          {asString(run.report?.headline) ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">{asString(run.report?.headline)}</p>
          ) : null}
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">The idea as submitted</p>
            {run.ideaText}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Read-only oversight view. Nothing here re-runs the analysis or spends the owner&apos;s quota.
          </p>
        </section>

        {run.status !== 'COMPLETED' ? (
          <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> This run did not finish
            </div>
            <p className="mt-1">
              Status {run.status}
              {run.errorMessage ? ` — ${run.errorMessage}` : ''}. Only what the run stored before it stopped is shown
              below.
            </p>
          </section>
        ) : null}

        {asString(run.report?.alreadyDoneSummary) ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">What has already been done</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{asString(run.report?.alreadyDoneSummary)}</p>
          </section>
        ) : null}

        {priorWork ? (
          <>
            <div className="mt-6">
              <PriorWorkList rows={priorWork.rows} summary={priorWork.summary} />
            </div>
            <CoverageMap coverage={priorWork.coverage} rows={priorWork.rows} patentsSearched={patentsSearched} />
            <GapList directions={directions} rows={priorWork.rows} />
          </>
        ) : (
          <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            This run stored no prior-work list, so there is nothing to show for the evidence pass.
          </section>
        )}

        {asStrings(run.report?.nextSteps).length ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-sky-700" aria-hidden="true" />
              <h2 className="font-semibold text-slate-900">What the analysis recommended next</h2>
            </div>
            <ul className="mt-4 space-y-3">
              {asStrings(run.report?.nextSteps).map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-600">
                  <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                    {index + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">How this was worked out</h2>
          <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
            <p>
              <span className="font-semibold text-slate-800">Corpora searched:</span> sanctioned awards
              {patentsSearched ? ', patents (Google Patents and PatentNest)' : ' only — no patent check ran for this run'}.
            </p>
            {asString(run.scores?.methodology) ? (
              <p>
                <span className="font-semibold text-slate-800">Coverage:</span> {asString(run.scores?.methodology)}
              </p>
            ) : null}
            <div className="flex gap-3 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
              <ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <p>
                {asString(run.report?.evidenceDisclaimer) ||
                  'This describes what the retrieved records show and do not show. It is not a prediction of funding success.'}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
