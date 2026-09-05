'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import ProposalStatusChip from '@/components/proposals/ProposalStatusChip'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * The researcher's own applications.
 *
 * Sorted so the ones waiting on *them* come first: a list of twelve proposals
 * where three need a revision this week is only useful if those three are at the
 * top.
 */

interface ProposalRow {
  id: string
  title: string
  status: string
  statusLabel: string
  agencyName: string
  schemeTitle: string | null
  agencyDeadlineAt: string | null
  reviewCutoffAt: string | null
  currentVersionNo: number
  submittedAt: string | null
  pi: { userId: string; name: string | null; email: string | null }
  school: { id: string; name: string } | null
  latestVersion: { versionNo: number; reviewStatus: string; uploadedAt: string } | null
  lastSharedReview: { score: number | null; recommendation: string | null; sharedAt: string } | null
  nextAction: { actor: string; text: string }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const ACTOR_STYLE: Record<string, string> = {
  faculty: 'bg-amber-50 text-amber-800 border-amber-200',
  officer: 'bg-cobalt-50 text-cobalt-700 border-cobalt-200',
  agency: 'bg-indigo-50 text-indigo-700 border-indigo-200',
}

export default function MyProposalsPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()

  const [rows, setRows] = useState<ProposalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authFetch('/api/proposals?view=mine&limit=200')
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not load your proposals.')
      setRows(data.proposals || [])
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load your proposals.')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  // Yours first, then the department's, then whatever is sitting with the
  // agency. Inside each group, the nearest deadline leads.
  const ordered = useMemo(() => {
    const weight: Record<string, number> = { faculty: 0, officer: 1, agency: 2, none: 3 }
    return [...rows].sort((a, b) => {
      const byActor = (weight[a.nextAction?.actor] ?? 3) - (weight[b.nextAction?.actor] ?? 3)
      if (byActor !== 0) return byActor
      const aDue = a.reviewCutoffAt || a.agencyDeadlineAt
      const bDue = b.reviewCutoffAt || b.agencyDeadlineAt
      if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime()
      if (aDue) return -1
      if (bDue) return 1
      return 0
    })
  }, [rows])

  const needsMe = ordered.filter((row) => row.nextAction?.actor === 'faculty').length

  if (authLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <div className="nk-panel p-6">
            <p className="nk-sub">Loading your proposals…</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="nk-ground nk-wash">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6">
          <p className="nk-eyebrow">Sponsored research</p>
          <h1 className="nk-title">My proposals</h1>
          <p className="nk-sub mt-1">
            Everything you have with the funding department, and what each one is waiting for.
          </p>
        </header>

        {error && (
          <div className="nk-panel border-rose-200 bg-rose-50 p-4 mb-6">
            <p className="text-sm text-rose-700">{error}</p>
            <button type="button" className="nk-btn-secondary nk-btn-sm mt-3" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {rows.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="nk-badge">{rows.length} proposal{rows.length === 1 ? '' : 's'}</span>
            {needsMe > 0 && (
              <span className="nk-badge-warn">{needsMe} waiting on you</span>
            )}
          </div>
        )}

        {rows.length === 0 && !error && (
          <div className="nk-panel p-8 text-center">
            <h2 className="nk-title text-lg">No proposals yet</h2>
            <p className="nk-sub mt-2 mx-auto max-w-md">
              A proposal record is where your draft, the department&rsquo;s review and your budget live
              together. Start one from a call you have been assigned, on{' '}
              <Link href="/assignments" className="text-cobalt-700 underline">
                your assignments
              </Link>
              .
            </p>
          </div>
        )}

        <div className="space-y-3">
          {ordered.map((row) => {
            const due = row.reviewCutoffAt || row.agencyDeadlineAt
            const dueLabel = row.reviewCutoffAt ? 'Department cut-off' : 'Agency deadline'
            return (
              <Link
                key={row.id}
                href={`/proposals/${row.id}`}
                className="nk-panel block p-5 transition hover:shadow-nk-lift"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="nk-title text-base leading-snug">{row.title}</h2>
                    <p className="nk-sub mt-1 text-sm">
                      {row.agencyName}
                      {row.schemeTitle ? ` · ${row.schemeTitle}` : ''}
                    </p>
                  </div>
                  <ProposalStatusChip status={row.status} />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="nk-label">
                    {row.currentVersionNo > 0
                      ? `Version ${row.currentVersionNo}`
                      : 'No draft uploaded'}
                  </span>
                  {due && (
                    <span className="nk-label">
                      {dueLabel}: <span className="nk-mono">{formatDate(due)}</span>
                    </span>
                  )}
                  {row.lastSharedReview?.score != null && (
                    <span className="nk-label">
                      Last review scored{' '}
                      <span className="nk-readout-sm">{row.lastSharedReview.score.toFixed(1)}</span>
                    </span>
                  )}
                </div>

                {row.nextAction?.text && (
                  <p
                    className={`mt-3 inline-flex rounded-md border px-2.5 py-1 text-xs font-medium ${
                      ACTOR_STYLE[row.nextAction.actor] || 'bg-nickel-100 text-nickel-700 border-nickel-200'
                    }`}
                  >
                    {row.nextAction.text}
                  </p>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </main>
  )
}
