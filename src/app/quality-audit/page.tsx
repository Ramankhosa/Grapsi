'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewItem {
  id: string
  type: 'grant_ai_review' | 'reviewer_report' | 'novelty_search'
  projectId: string | null
  projectTitle: string | null
  userId: string
  userName?: string | null
  createdAt: string
  updatedAt: string
  // grant_ai_review
  sessionId?: string
  sessionStatus?: string
  fundingCallTitle?: string | null
  agencyName?: string | null
  sectionKey?: string
  sectionLabel?: string
  score?: number | null
  issueCount?: number
  errors?: number
  warnings?: number
  suggestions?: number
  recommendation?: string | null
  // reviewer_report
  reviewStatus?: string
  finalReviewStatus?: string
  sectionCount?: number
  reviewedCount?: number
  overallScore?: number | null
  overallRecommendation?: string | null
  // novelty_search
  title?: string
  status?: string
  currentStage?: string
  jurisdiction?: string
}

interface Summary {
  totalReviews: number
  aiReviews: number
  reviewerReports: number
  noveltySearches: number
}

interface Facets {
  projects: Array<{ id: string; title: string }>
  users: Array<{ id: string; email: string; name: string | null }>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'grant_ai_review', label: 'Grant AI Reviews' },
  { value: 'reviewer_report', label: 'Reviewer Reports' },
  { value: 'novelty_search', label: 'Novelty Searches' },
] as const

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  grant_ai_review: {
    label: 'AI Review',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  reviewer_report: {
    label: 'Reviewer',
    className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  },
  novelty_search: {
    label: 'Novelty',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
}

const inputClass =
  'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function QualityAuditPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const { canQualityAudit, isSuperAdmin } = useRoleAccess()

  // Data
  const [items, setItems] = useState<ReviewItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [type, setType] = useState('all')
  const [projectId, setProjectId] = useState('')
  const [userId, setUserId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  // Expanded detail
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const buildParams = useCallback(() => {
    const params = new URLSearchParams()
    if (type !== 'all') params.set('type', type)
    if (projectId) params.set('projectId', projectId)
    if (userId) params.set('userId', userId)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    params.set('page', String(page))
    params.set('limit', '20')
    return params
  }, [type, projectId, userId, dateFrom, dateTo, page])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = buildParams()
      const res = await authFetch(`/api/tenant-admin/quality-audit?${params}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load audit data')
      }
      const data = await res.json()
      setItems(data.items ?? [])
      setSummary(data.summary ?? null)
      setFacets(data.facets ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [authFetch, buildParams])

  useEffect(() => {
    if (!authLoading && user) load()
  }, [authLoading, user, load])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [type, projectId, userId, dateFrom, dateTo])

  // Guard
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }
  if (!canQualityAudit && !isSuperAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-24 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h1>
        <p className="text-gray-600 dark:text-gray-400">
          You need the <strong>Quality Auditor</strong> role to access this page.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Quality Audit</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Cross-project review and report oversight for your organization.
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <SummaryCard label="Total Reviews" value={summary.totalReviews} />
          <SummaryCard
            label="Grant AI Reviews"
            value={summary.aiReviews}
            accent="text-blue-600 dark:text-blue-400"
          />
          <SummaryCard
            label="Reviewer Reports"
            value={summary.reviewerReports}
            accent="text-purple-600 dark:text-purple-400"
          />
          <SummaryCard
            label="Novelty Searches"
            value={summary.noveltySearches}
            accent="text-amber-600 dark:text-amber-400"
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Type
            </label>
            <select
              className={inputClass}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Project
            </label>
            <select
              className={inputClass}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">All Projects</option>
              {facets?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              User
            </label>
            <select
              className={inputClass}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">All Users</option>
              {facets?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              From
            </label>
            <input
              type="date"
              className={inputClass}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              To
            </label>
            <input
              type="date"
              className={inputClass}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <button
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            onClick={() => {
              setType('all')
              setProjectId('')
              setUserId('')
              setDateFrom('')
              setDateTo('')
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Results table */}
      {!loading && items.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          No reviews found matching your filters.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Project
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Details
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Score / Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((item) => (
                  <ReviewRow
                    key={`${item.type}-${item.id}`}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">Page {page}</span>
            <button
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
              disabled={items.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? 'text-gray-900 dark:text-white'}`}>{value}</p>
    </div>
  )
}

function ReviewRow({
  item,
  expanded,
  onToggle,
}: {
  item: ReviewItem
  expanded: boolean
  onToggle: () => void
}) {
  const badge = TYPE_BADGE[item.type]
  const dateStr = new Date(item.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  return (
    <>
      <tr
        className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <span
            className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}
          >
            {badge.label}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-[200px] truncate">
          {item.projectTitle ?? '—'}
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          <DetailSummary item={item} />
        </td>
        <td className="px-4 py-3">
          <ScoreBadge item={item} />
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-[150px] truncate">
          {item.userName ?? '—'}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {dateStr}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 py-4 bg-gray-50 dark:bg-gray-900/30">
            <ExpandedDetail item={item} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailSummary({ item }: { item: ReviewItem }) {
  if (item.type === 'grant_ai_review') {
    return (
      <span>
        {item.sectionLabel ?? item.sectionKey}
        {item.fundingCallTitle && (
          <span className="text-gray-400 dark:text-gray-500"> — {item.fundingCallTitle}</span>
        )}
      </span>
    )
  }
  if (item.type === 'reviewer_report') {
    return (
      <span>
        {item.agencyName ?? 'Unknown agency'}
        <span className="text-gray-400 dark:text-gray-500">
          {' '}
          — {item.reviewedCount ?? 0}/{item.sectionCount ?? 0} sections
        </span>
      </span>
    )
  }
  if (item.type === 'novelty_search') {
    return (
      <span>
        {item.title}
        {item.jurisdiction && (
          <span className="text-gray-400 dark:text-gray-500"> ({item.jurisdiction})</span>
        )}
      </span>
    )
  }
  return <span>—</span>
}

function ScoreBadge({ item }: { item: ReviewItem }) {
  if (item.type === 'grant_ai_review') {
    const score = item.score
    if (score == null) return <span className="text-sm text-gray-400">—</span>
    const color =
      score >= 80
        ? 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/30'
        : score >= 50
          ? 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30'
          : 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/30'
    return (
      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
        {score}/100
      </span>
    )
  }

  if (item.type === 'reviewer_report') {
    const st = item.finalReviewStatus ?? item.reviewStatus ?? '—'
    return <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{st}</span>
  }

  if (item.type === 'novelty_search') {
    const st = item.status ?? '—'
    const stageLabel = item.currentStage?.replace('STAGE_', 'S') ?? ''
    return (
      <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
        {st.toLowerCase()}
        {stageLabel && <span className="text-gray-400 ml-1">({stageLabel})</span>}
      </span>
    )
  }

  return <span className="text-sm text-gray-400">—</span>
}

function ExpandedDetail({ item }: { item: ReviewItem }) {
  if (item.type === 'grant_ai_review') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Errors</span>
          <span className="font-semibold text-red-600 dark:text-red-400">{item.errors ?? 0}</span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Warnings</span>
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            {item.warnings ?? 0}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Suggestions</span>
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            {item.suggestions ?? 0}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Recommendation</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {item.recommendation ?? '—'}
          </span>
        </div>
        {item.agencyName && (
          <div className="col-span-2">
            <span className="block text-xs text-gray-500 dark:text-gray-400">Agency</span>
            <span className="text-gray-900 dark:text-white">{item.agencyName}</span>
          </div>
        )}
        {item.sessionStatus && (
          <div className="col-span-2">
            <span className="block text-xs text-gray-500 dark:text-gray-400">Session Status</span>
            <span className="text-gray-900 dark:text-white capitalize">
              {item.sessionStatus.toLowerCase().replace(/_/g, ' ')}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'reviewer_report') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Review Status</span>
          <span className="font-semibold text-gray-900 dark:text-white capitalize">
            {item.reviewStatus ?? '—'}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Final Status</span>
          <span className="font-semibold text-gray-900 dark:text-white capitalize">
            {item.finalReviewStatus ?? '—'}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Overall Score</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {item.overallScore ?? '—'}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Sections</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {item.reviewedCount ?? 0} / {item.sectionCount ?? 0} reviewed
          </span>
        </div>
        {item.overallRecommendation && (
          <div className="col-span-4">
            <span className="block text-xs text-gray-500 dark:text-gray-400">Recommendation</span>
            <span className="text-gray-900 dark:text-white">{item.overallRecommendation}</span>
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'novelty_search') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Status</span>
          <span className="font-semibold text-gray-900 dark:text-white capitalize">
            {item.status?.toLowerCase() ?? '—'}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Current Stage</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {item.currentStage ?? '—'}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Jurisdiction</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {item.jurisdiction ?? '—'}
          </span>
        </div>
        <div>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Title</span>
          <span className="font-semibold text-gray-900 dark:text-white">{item.title ?? '—'}</span>
        </div>
      </div>
    )
  }

  return null
}
