'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import ProposalStatusChip from '@/components/proposals/ProposalStatusChip'
import { useAuth } from '@/lib/auth-context'

/**
 * Proposals from the Dean's or Head of Department's school.
 *
 * Read-only, and deliberately without the department's internal notes: this is
 * oversight of what their faculty are applying for, not access to the funding
 * office's private assessment of them. The server enforces the same split; this
 * page simply never asks for what it may not have.
 */

interface Row {
  id: string
  title: string
  status: string
  agencyName: string
  agencyDeadlineAt: string | null
  submittedAt: string | null
  sanctionedAmount: number | null
  currency: string
  currentVersionNo: number
  pi: { name: string | null; email: string | null }
  school: { id: string; name: string } | null
  lastSharedReview: { score: number | null; sharedAt: string } | null
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SchoolProposalsPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authFetch('/api/proposals?view=register&limit=200')
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not load proposals.')
      setRows(data.proposals || [])
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load proposals.')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  return (
    <main className="nk-ground nk-wash">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="nk-eyebrow">My school</p>
            <h1 className="nk-title">Proposals from my school</h1>
            <p className="nk-sub mt-1">
              What your faculty are applying for, and where each application stands.
            </p>
          </div>
          <Link href="/school-head" className="nk-btn-secondary nk-btn-sm">
            School overview
          </Link>
        </header>

        {error && (
          <div className="nk-panel border-rose-200 bg-rose-50 p-4">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="nk-panel p-6">
            <p className="nk-sub">Loading…</p>
          </div>
        ) : rows.length === 0 && !error ? (
          <div className="nk-panel p-8 text-center">
            <h2 className="nk-title text-lg">No proposals yet</h2>
            <p className="nk-sub mt-2">
              Applications appear here once your faculty open a record with the funding department.
            </p>
          </div>
        ) : (
          <div className="nk-panel cb-scroll-x overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="nk-label px-4 py-3 text-left">Proposal</th>
                  <th className="nk-label px-3 py-3 text-left">Researcher</th>
                  <th className="nk-label px-3 py-3 text-left">Status</th>
                  <th className="nk-label px-3 py-3 text-right">Drafts</th>
                  <th className="nk-label px-3 py-3 text-right">Last score</th>
                  <th className="nk-label px-3 py-3 text-right">Deadline</th>
                  <th className="nk-label px-4 py-3 text-right">Sanctioned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-hairline/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-nickel-900">{row.title}</p>
                      <p className="nk-hint text-xs">{row.agencyName}</p>
                    </td>
                    <td className="px-3 py-3 text-nickel-800">{row.pi?.name || row.pi?.email || '—'}</td>
                    <td className="px-3 py-3">
                      <ProposalStatusChip status={row.status} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="nk-mono">{row.currentVersionNo || '—'}</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="nk-mono">
                        {row.lastSharedReview?.score != null
                          ? row.lastSharedReview.score.toFixed(1)
                          : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="nk-mono">{formatDate(row.agencyDeadlineAt)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="nk-mono">
                        {row.sanctionedAmount != null
                          ? `${row.currency} ${Number(row.sanctionedAmount).toLocaleString()}`
                          : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
