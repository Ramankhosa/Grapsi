'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import ProposalStatusChip from '@/components/proposals/ProposalStatusChip'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import {
  OPEN_PROPOSAL_STATUSES,
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
} from '@/lib/proposals/shared'

/**
 * The department's book of applications.
 *
 * Clamped to the schools the officer covers, the same way every other
 * department surface is. The default sort puts what is waiting on the
 * department first, because that is the list an officer opens this screen to
 * work through.
 */

interface RegisterRow {
  id: string
  title: string
  status: string
  agencyName: string
  schemeTitle: string | null
  agencyDeadlineAt: string | null
  reviewCutoffAt: string | null
  currentVersionNo: number
  submittedAt: string | null
  requestedAmount: number | null
  sanctionedAmount: number | null
  currency: string
  pi: { userId: string; name: string | null; email: string | null }
  school: { id: string; name: string } | null
  latestVersion: { versionNo: number; reviewStatus: string; uploadedAt: string } | null
  lastSharedReview: { score: number | null; sharedAt: string } | null
  nextAction: { actor: string; text: string }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function ProposalRegisterPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()

  const [rows, setRows] = useState<RegisterRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<string>('')
  const [query, setQuery] = useState('')
  const [windowKey, setWindowKey] = useState<'all' | 'reporting'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view: 'register', limit: '200' })
      if (status) params.set('status', status)
      if (query.trim()) params.set('q', query.trim())
      if (windowKey === 'reporting') params.set('window', 'reporting')

      const response = await authFetch(`/api/proposals?${params.toString()}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not load the register.')
      setRows(data.proposals || [])
      setTotal(data.total || 0)
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load the register.')
    } finally {
      setLoading(false)
    }
  }, [authFetch, status, query, windowKey])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  /**
   * The register as a spreadsheet — what the office is asked for at an audit.
   * Downloaded through authFetch because auth here is Bearer-only.
   */
  async function exportCsv() {
    try {
      const params = new URLSearchParams({ format: 'csv' })
      if (status) params.set('status', status)
      if (windowKey === 'reporting') params.set('window', 'reporting')

      const response = await authFetch(`/api/proposals/register?${params.toString()}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || 'Could not export the register.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `proposal-register-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (exportError: any) {
      showToast({ type: 'error', title: 'Export failed', description: exportError?.message })
    }
  }

  const ordered = useMemo(() => {
    const weight: Record<string, number> = { officer: 0, faculty: 1, agency: 2, none: 3 }
    return [...rows].sort((a, b) => {
      const byActor = (weight[a.nextAction?.actor] ?? 3) - (weight[b.nextAction?.actor] ?? 3)
      if (byActor !== 0) return byActor
      const aDue = a.reviewCutoffAt || a.agencyDeadlineAt
      const bDue = b.reviewCutoffAt || b.agencyDeadlineAt
      if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime()
      return aDue ? -1 : bDue ? 1 : 0
    })
  }, [rows])

  // Live work only. Post-award paperwork on a sanctioned grant is still the
  // department's, but counting it here would report a success as a backlog —
  // and a backlog number nobody trusts is a number nobody reads.
  const waiting = ordered.filter(
    (row) =>
      row.nextAction?.actor === 'officer' &&
      (OPEN_PROPOSAL_STATUSES as readonly string[]).includes(row.status)
  ).length
  const sanctioned = ordered.filter((row) => row.status === 'SANCTIONED').length

  return (
    <main className="nk-ground nk-wash">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="nk-eyebrow">Funding department</p>
            <h1 className="nk-title">Proposal desk</h1>
            <p className="nk-sub mt-1">
              Every application from the schools you cover, and what each is waiting for.
            </p>
          </div>
          <Link href="/funding-dept" className="nk-btn-secondary nk-btn-sm">
            Department home
          </Link>
        </header>

        <div className="nk-panel mb-5 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="nk-label" htmlFor="register-q">
                Search
              </label>
              <input
                id="register-q"
                className="nk-input mt-1 w-full"
                placeholder="Title, agency, reference or researcher"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div>
              <label className="nk-label" htmlFor="register-status">
                Status
              </label>
              <select
                id="register-status"
                className="nk-select mt-1"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">Any</option>
                {PROPOSAL_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {PROPOSAL_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="nk-label" htmlFor="register-window">
                Period
              </label>
              <select
                id="register-window"
                className="nk-select mt-1"
                value={windowKey}
                onChange={(event) => setWindowKey(event.target.value as 'all' | 'reporting')}
              >
                <option value="all">All time</option>
                <option value="reporting">Period of consideration</option>
              </select>
            </div>
            <button type="button" className="nk-btn-primary nk-btn-sm" onClick={() => void load()}>
              Apply
            </button>
            <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={() => void exportCsv()}>
              Export CSV
            </button>
          </div>
        </div>

        {error && (
          <div className="nk-panel border-rose-200 bg-rose-50 p-4 mb-5">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        )}

        {!error && (
          <div className="mb-4 flex flex-wrap gap-3">
            <span className="nk-badge">{total} proposal{total === 1 ? '' : 's'}</span>
            {waiting > 0 && <span className="nk-badge-warn">{waiting} waiting on the department</span>}
            {sanctioned > 0 && <span className="nk-badge-ok">{sanctioned} sanctioned</span>}
          </div>
        )}

        {loading ? (
          <div className="nk-panel p-6">
            <p className="nk-sub">Loading…</p>
          </div>
        ) : ordered.length === 0 ? (
          <div className="nk-panel p-8 text-center">
            <h2 className="nk-title text-lg">Nothing here yet</h2>
            <p className="nk-sub mt-2">
              Proposals appear once a researcher opens a record or you start one for them from an
              assignment.
            </p>
          </div>
        ) : (
          <div className="nk-panel cb-scroll-x overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="nk-label px-4 py-3 text-left">Proposal</th>
                  <th className="nk-label px-3 py-3 text-left">Researcher</th>
                  <th className="nk-label px-3 py-3 text-left">School</th>
                  <th className="nk-label px-3 py-3 text-left">Status</th>
                  <th className="nk-label px-3 py-3 text-right">Draft</th>
                  <th className="nk-label px-3 py-3 text-right">Score</th>
                  <th className="nk-label px-3 py-3 text-right">Cut-off</th>
                  <th className="nk-label px-4 py-3 text-left">Waiting on</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => (
                  <tr key={row.id} className="border-b border-hairline/60 hover:bg-inset">
                    <td className="px-4 py-3">
                      <Link
                        href={`/funding-dept/proposals/${row.id}`}
                        className="font-medium text-cobalt-700 hover:underline"
                      >
                        {row.title}
                      </Link>
                      <p className="nk-hint text-xs">{row.agencyName}</p>
                    </td>
                    <td className="px-3 py-3 text-nickel-800">{row.pi?.name || row.pi?.email || '—'}</td>
                    <td className="px-3 py-3 text-nickel-700">{row.school?.name || '—'}</td>
                    <td className="px-3 py-3">
                      <ProposalStatusChip status={row.status} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="nk-mono">
                        {row.currentVersionNo > 0 ? `v${row.currentVersionNo}` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="nk-mono">
                        {row.lastSharedReview?.score != null
                          ? row.lastSharedReview.score.toFixed(1)
                          : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="nk-mono">{formatDate(row.reviewCutoffAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.nextAction?.actor === 'officer'
                            ? 'nk-badge-warn'
                            : row.nextAction?.actor === 'faculty'
                              ? 'nk-badge'
                              : 'nk-badge'
                        }
                      >
                        {row.nextAction?.actor === 'officer'
                          ? 'Department'
                          : row.nextAction?.actor === 'faculty'
                            ? 'Researcher'
                            : row.nextAction?.actor === 'agency'
                              ? 'Agency'
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
