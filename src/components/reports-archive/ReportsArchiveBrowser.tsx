'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileSearch, Filter, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

export type ArchiveScopeKind = 'platform' | 'tenant'

/** Who ran a report. Every field is blank where the platform does not know. */
export interface ReportRunner {
  userId: string
  name: string | null
  email: string | null
  employeeId: string | null
  designation: string | null
  department: string | null
  school: string | null
  orgUnitId: string | null
  orgUnitName: string | null
  tenantId: string | null
}

export interface ArchiveRow {
  id: string
  type: 'reviewer' | 'funding_intelligence'
  title: string
  subtitle: string | null
  tenantId: string | null
  tenantName: string | null
  runBy: ReportRunner
  state: 'completed' | 'in_progress' | 'failed'
  statusLabel: string
  hasReport: boolean
  score: number | null
  sectionsReviewed: number | null
  sectionCount: number | null
  createdAt: string
  updatedAt: string
}

interface ArchiveResponse {
  items: ArchiveRow[]
  total: number
  totals: { reviewer: number; fundingIntelligence: number }
  page: number
  limit: number
  truncated: boolean
  facets: {
    tenants: Array<{ id: string; name: string }>
    users: ReportRunner[]
    schools: Array<{ id: string; name: string }>
  }
}

const TYPE_LABELS: Record<ArchiveRow['type'], string> = {
  reviewer: 'Grant reviewer',
  funding_intelligence: 'Funding intelligence',
}

const STATE_LABELS: Record<ArchiveRow['state'], string> = {
  completed: 'Report ready',
  in_progress: 'In progress',
  failed: 'Failed',
}

const STATE_BADGES: Record<ArchiveRow['state'], string> = {
  completed: 'nk-badge-ok',
  in_progress: 'nk-badge-warn',
  failed: 'nk-badge-danger',
}

const PAGE_SIZE = 25

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Cross-tenant (or tenant-wide) archive of the two AI report products.
 *
 * The same component serves both surfaces. `scope` only changes what is
 * offered — a tenant column and tenant filter appear for platform viewers —
 * never what the API returns: the server pins a tenant admin to their own
 * tenant regardless of what this page asks for.
 */
export default function ReportsArchiveBrowser({
  scope,
  basePath,
}: {
  scope: ArchiveScopeKind
  basePath: string
}) {
  const { authFetch } = useAuth()

  const [data, setData] = useState<ArchiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [type, setType] = useState<'all' | ArchiveRow['type']>('all')
  const [tenantId, setTenantId] = useState('all')
  const [userId, setUserId] = useState('all')
  const [orgUnitId, setOrgUnitId] = useState('all')
  const [state, setState] = useState<'all' | ArchiveRow['state']>('all')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (type !== 'all') params.set('type', type)
      if (scope === 'platform' && tenantId !== 'all') params.set('tenantId', tenantId)
      if (userId !== 'all') params.set('userId', userId)
      if (orgUnitId !== 'all') params.set('orgUnitId', orgUnitId)
      if (state !== 'all') params.set('state', state)
      if (appliedSearch) params.set('q', appliedSearch)
      if (dateFrom) params.set('dateFrom', new Date(`${dateFrom}T00:00:00`).toISOString())
      if (dateTo) params.set('dateTo', new Date(`${dateTo}T23:59:59`).toISOString())

      const response = await authFetch(`/api/reports-archive?${params.toString()}`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Request failed (${response.status})`)
      }
      setData(await response.json())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the report archive.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [authFetch, page, type, tenantId, userId, orgUnitId, state, appliedSearch, dateFrom, dateTo, scope])

  useEffect(() => {
    void load()
  }, [load])

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(1)
  }, [type, tenantId, userId, orgUnitId, state, appliedSearch, dateFrom, dateTo])

  // Facets already follow the tenant filter, so the picker needs no second pass.
  const userOptions = data?.facets.users ?? []
  const schoolOptions = data?.facets.schools ?? []

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.limit || PAGE_SIZE))) : 1

  const detailHref = (row: ArchiveRow) =>
    row.type === 'reviewer'
      ? `${basePath}/reviewer/${row.id}`
      : `${basePath}/funding-intelligence/${row.id}`

  return (
    <div className="nk-ground min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <p className="nk-eyebrow">{scope === 'platform' ? 'Platform oversight' : 'Organization oversight'}</p>
          <h1 className="nk-title mt-2 text-[26px] leading-tight">Report archive</h1>
          <p className="nk-sub mt-1">
            Every AI grant-reviewer panel report and funding-intelligence analysis
            {scope === 'platform' ? ' run on the platform, across all tenants.' : ' run by members of your organization.'}{' '}
            Read-only: opening a report here never regenerates it or spends quota.
          </p>
        </header>

        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="nk-panel px-5 py-4">
            <p className="nk-eyebrow">Reports</p>
            <p className="nk-readout mt-3">{data ? data.total.toLocaleString() : '—'}</p>
          </div>
          <div className="nk-panel px-5 py-4">
            <p className="nk-eyebrow">Grant reviewer</p>
            <p className="nk-readout mt-3">{data ? data.totals.reviewer.toLocaleString() : '—'}</p>
          </div>
          <div className="nk-panel px-5 py-4">
            <p className="nk-eyebrow">Funding intelligence</p>
            <p className="nk-readout mt-3">{data ? data.totals.fundingIntelligence.toLocaleString() : '—'}</p>
          </div>
        </section>

        <section className="nk-panel mb-6 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-nickel-800">
            <Filter className="h-4 w-4" aria-hidden="true" /> Filters
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="nk-label">Report type</span>
              <select className="nk-select mt-1 w-full" value={type} onChange={(event) => setType(event.target.value as any)}>
                <option value="all">Both products</option>
                <option value="reviewer">Grant reviewer</option>
                <option value="funding_intelligence">Funding intelligence</option>
              </select>
            </label>

            {scope === 'platform' ? (
              <label className="block">
                <span className="nk-label">Tenant</span>
                <select
                  className="nk-select mt-1 w-full"
                  value={tenantId}
                  onChange={(event) => {
                    setTenantId(event.target.value)
                    setUserId('all')
                    setOrgUnitId('all')
                  }}
                >
                  <option value="all">All tenants</option>
                  {(data?.facets.tenants ?? []).map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="block">
              <span className="nk-label">School</span>
              <select
                className="nk-select mt-1 w-full"
                value={orgUnitId}
                onChange={(event) => setOrgUnitId(event.target.value)}
                disabled={schoolOptions.length === 0}
              >
                <option value="all">
                  {schoolOptions.length === 0
                    ? scope === 'platform'
                      ? 'Pick a tenant to filter by school'
                      : 'No schools defined'
                    : 'All schools'}
                </option>
                {schoolOptions.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="nk-label">Run by</span>
              <select className="nk-select mt-1 w-full" value={userId} onChange={(event) => setUserId(event.target.value)}>
                <option value="all">Everyone who ran a report</option>
                {userOptions.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.name || user.email || user.userId}
                    {user.school ? ` — ${user.school}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="nk-label">State</span>
              <select className="nk-select mt-1 w-full" value={state} onChange={(event) => setState(event.target.value as any)}>
                <option value="all">Any state</option>
                <option value="completed">Report ready</option>
                <option value="in_progress">In progress</option>
                <option value="failed">Failed</option>
              </select>
            </label>

            <label className="block">
              <span className="nk-label">From</span>
              <input type="date" className="nk-input mt-1 w-full" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>

            <label className="block">
              <span className="nk-label">To</span>
              <input type="date" className="nk-input mt-1 w-full" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>

            <label className="block lg:col-span-2">
              <span className="nk-label">Search</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="search"
                  className="nk-input w-full"
                  placeholder="Proposal, agency, idea, person, employee ID or school"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setAppliedSearch(search.trim())
                  }}
                />
                <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={() => setAppliedSearch(search.trim())}>
                  Apply
                </button>
              </div>
            </label>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              className="nk-btn-ghost nk-btn-sm"
              onClick={() => {
                setType('all')
                setTenantId('all')
                setUserId('all')
                setOrgUnitId('all')
                setState('all')
                setSearch('')
                setAppliedSearch('')
                setDateFrom('')
                setDateTo('')
              }}
            >
              Clear filters
            </button>
            <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
            </button>
          </div>
        </section>

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        {data?.truncated ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Combined listings are merged from two tables, so paging this deep is capped. Filter to one report type to page
            further.
          </div>
        ) : null}

        <section className="nk-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-nickel-50 text-left text-xs uppercase tracking-wide text-nickel-600">
                <tr>
                  <th className="px-4 py-3">Report</th>
                  <th className="px-4 py-3">Product</th>
                  {scope === 'platform' ? <th className="px-4 py-3">Tenant</th> : null}
                  <th className="px-4 py-3">Run by</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Run</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-nickel-100">
                {loading && !data ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-nickel-500">
                      Loading reports…
                    </td>
                  </tr>
                ) : null}

                {!loading && data && data.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-nickel-500">
                      No reports match these filters.
                    </td>
                  </tr>
                ) : null}

                {(data?.items ?? []).map((row) => (
                  <tr key={`${row.type}-${row.id}`} className="align-top hover:bg-nickel-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-nickel-900">{row.title}</div>
                      {row.subtitle ? <div className="mt-0.5 text-xs text-nickel-500">{row.subtitle}</div> : null}
                      {row.type === 'reviewer' && row.sectionCount !== null ? (
                        <div className="mt-1 text-xs text-nickel-500">
                          {row.sectionsReviewed}/{row.sectionCount} section drafts reviewed
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-nickel-700">
                        {row.type === 'reviewer' ? (
                          <ShieldCheck className="h-3.5 w-3.5 text-cobalt-600" aria-hidden="true" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
                        )}
                        {TYPE_LABELS[row.type]}
                      </span>
                    </td>
                    {scope === 'platform' ? (
                      <td className="px-4 py-3 text-nickel-700">{row.tenantName || '—'}</td>
                    ) : null}
                    <td className="px-4 py-3">
                      {/* Blank rather than a placeholder identity: an oversight
                          view must not imply it knows who ran something. */}
                      <div className="text-nickel-800">{row.runBy.name || row.runBy.email || ''}</div>
                      {row.runBy.name && row.runBy.email ? (
                        <div className="text-xs text-nickel-500">{row.runBy.email}</div>
                      ) : null}
                      {row.runBy.school || row.runBy.department ? (
                        <div className="mt-0.5 text-xs text-nickel-500">
                          {[row.runBy.school, row.runBy.department].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                      {row.runBy.employeeId ? (
                        <div className="text-[11px] text-nickel-400">ID {row.runBy.employeeId}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={STATE_BADGES[row.state]}>{STATE_LABELS[row.state]}</span>
                      <div className="mt-1 text-[11px] uppercase tracking-wide text-nickel-400">{row.statusLabel}</div>
                    </td>
                    <td className="px-4 py-3 nk-mono text-nickel-800">
                      {typeof row.score === 'number' ? row.score.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3 text-nickel-600">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {row.hasReport ? (
                        <Link href={detailHref(row)} className="nk-btn-secondary nk-btn-xs inline-flex">
                          <FileSearch className="h-3.5 w-3.5" aria-hidden="true" /> Open
                        </Link>
                      ) : (
                        <span className="text-xs text-nickel-400">No report yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-4 flex items-center justify-between text-sm text-nickel-600">
          <span>
            {data ? `Page ${data.page} of ${totalPages} · ${data.total.toLocaleString()} report${data.total === 1 ? '' : 's'}` : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="nk-btn-ghost nk-btn-sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || page <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              className="nk-btn-ghost nk-btn-sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={loading || page >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
