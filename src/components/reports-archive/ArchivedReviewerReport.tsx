'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Printer } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import ReadOnlyReviewerReport from '@/components/reviewer/report/ReadOnlyReviewerReport'
import { patentSearchHref } from '@/components/reviewer/report/ReportPriorWork'
import { resolveReportSections } from '@/lib/reviewer/finalReport'
import { reportFreshness } from '@/lib/reviewer/sectionGrouping'

interface ArchivedSection {
  id: string
  section_title: string
  user_input: string
  ai_review_json: Record<string, any>
  status: string
  version: number
  is_revision: boolean
  mappingJson: any
  last_reviewed_at: string
}

interface ArchivedCall {
  id: string
  projectTitle: string | null
  agencyName: string | null
  reviewStatus: string
  finalReviewStatus: string
  parsedJson: Record<string, any> | null
  overallReviewJson: Record<string, any> | null
  modelUsed: string | null
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

/**
 * The same panel report the researcher sees, rendered read-only for an
 * administrator.
 *
 * It reuses the researcher report's own blocks rather than reformatting the
 * data: an oversight view that renders a different-looking report invites
 * arguments about which one is real. What it drops is every action that writes
 * — regenerate, share, version pinning — because oversight must not alter, or
 * bill for, the report it is reading.
 */
export default function ArchivedReviewerReport({
  callId,
  basePath,
}: {
  callId: string
  basePath: string
}) {
  const { authFetch } = useAuth()

  const [call, setCall] = useState<ArchivedCall | null>(null)
  const [sections, setSections] = useState<ArchivedSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await authFetch(`/api/reports-archive/reviewer/${callId}`)
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${response.status})`)
        }
        const data = await response.json()
        if (cancelled) return
        setCall(data.call)
        setSections(data.sections || [])
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
  }, [authFetch, callId])

  const overall = call?.overallReviewJson || null

  /**
   * One row per section title, at the version the stored report scored, minus
   * the titles it left out. Showing every version would print a revised
   * section twice with two different scores.
   */
  const effectiveSections = useMemo(
    () => resolveReportSections(sections as any[], overall) as unknown as ArchivedSection[],
    [sections, overall]
  )

  const freshness = useMemo(() => reportFreshness(overall as any, sections as any), [overall, sections])

  // Auth is Bearer-only, so a plain anchor would download an HTML 401 page.
  const downloadAtr = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    try {
      const response = await authFetch(`/api/reports-archive/reviewer/${callId}/export`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Export failed (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `ATR-${callId}.docx`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (downloadError) {
      setExportError(downloadError instanceof Error ? downloadError.message : 'Could not build the Word export.')
    } finally {
      setExporting(false)
    }
  }, [authFetch, callId])

  if (loading) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-cobalt-600" />
      </div>
    )
  }

  if (error || !call) {
    return (
      <div className="nk-ground min-h-screen px-4 py-12">
        <div className="mx-auto max-w-lg nk-panel p-6 text-center">
          <h1 className="nk-title text-xl">Report unavailable</h1>
          <p className="nk-sub mt-2">{error || 'This report could not be loaded.'}</p>
          <Link href={basePath} className="nk-btn-secondary nk-btn-sm mt-4 inline-flex">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to the archive
          </Link>
        </div>
      </div>
    )
  }

  if (!overall || Object.keys(overall).length === 0) {
    return (
      <div className="nk-ground min-h-screen px-4 py-12">
        <div className="mx-auto max-w-lg nk-panel p-6 text-center">
          <h1 className="nk-title text-xl">No panel report yet</h1>
          <p className="nk-sub mt-2">
            {call.projectTitle || 'This proposal'} has been set up for review, but no final report has been generated.
            The archive does not generate one — that stays with the owner.
          </p>
          <Link href={basePath} className="nk-btn-secondary nk-btn-sm mt-4 inline-flex">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to the archive
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="nk-ground min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div>
            <Link href={basePath} className="nk-btn-ghost nk-btn-sm inline-flex">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Report archive
            </Link>
            <p className="nk-sub mt-2 text-xs">
              {/* Attribution first: who ran this review, and where they sit. */}
              {[
                call.runBy?.name || call.runBy?.email || 'Run by an unnamed account',
                call.runBy?.school,
                call.runBy?.department,
                call.runBy?.tenantName,
                `Started ${new Date(call.createdAt).toLocaleDateString()}`,
                call.modelUsed ? `Model ${call.modelUsed}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="nk-btn-ghost nk-btn-sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
            </button>
            <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={() => void downloadAtr()} disabled={exporting}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> {exporting ? 'Building…' : 'Word (ATR)'}
            </button>
          </div>
        </div>

        {exportError ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
            {exportError}
          </div>
        ) : null}

        <div className="mb-4 rounded-md border border-nickel-200 bg-white px-4 py-3 text-xs text-nickel-600 print:hidden">
          Read-only oversight view. Nothing here regenerates the report or spends the owner&apos;s quota.
        </div>

        {freshness === 'stale' ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            <strong>Out of date.</strong> A section was reviewed after this report was written, so it does not describe the
            current drafts. Only the owner can regenerate it.
          </div>
        ) : null}

        <ReadOnlyReviewerReport
          overall={overall}
          projectTitle={call.projectTitle || 'Untitled proposal'}
          agencyName={call.agencyName || call.parsedJson?.agency_name || null}
          generatedAt={overall.generated_at}
          sections={effectiveSections}
          patentHref={patentSearchHref}
        />
      </div>
    </div>
  )
}
