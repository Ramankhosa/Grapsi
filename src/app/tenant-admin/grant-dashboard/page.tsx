'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '@/lib/auth-context'

interface Summary {
  active: number
  submitted: number
  missed: number
  cancelled: number
  awarded: number
  rejected: number
  total: number
  awardedAmount: number
  unassignedExpiredCalls: number
  successRate: number | null
}

interface AllocationRow {
  school: string | null
  department: string | null
  facultyUserId: string | null
  facultyName: string | null
  active: number
  submitted: number
  missed: number
  awarded: number
  total: number
  awardedAmount: number
}

interface ListRow {
  id: string
  callTitle: string | null
  agencyName: string | null
  facultyName: string | null
  school: string | null
  department: string | null
  deadlineAt: string | null
  status: string
  outcome: string
}

interface ExpiredCall {
  id: string
  title: string | null
  agencyName: string | null
  closedAt: string | null
}

interface ReportRow {
  label: string
  active: number
  submitted: number
  missed: number
  awarded: number
  rejected: number
  total: number
  awardedAmount: number
}

interface Facets {
  schools: Array<{ id: string; name: string; departments: Array<{ id: string; name: string }> }>
}

const ADMIN_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN']

const GROUP_BY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'agency', label: 'Agency' },
  { value: 'call', label: 'Funding call' },
  { value: 'school', label: 'School' },
  { value: 'department', label: 'Department' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
]

const BUCKET_COLORS = ['#2563eb', '#059669', '#dc2626', '#a855f7']

const inputClass =
  'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white'

function formatAmount(value: number) {
  if (!value) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

function deadlineLabel(value: string | null) {
  if (!value) return 'No deadline'
  const due = new Date(value)
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (days < 0) return `Overdue ${Math.abs(days)}d`
  if (days === 0) return 'Due today'
  return `Due in ${days}d`
}

export default function GrantDashboardPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()

  const [tab, setTab] = useState<'overview' | 'reports'>('overview')
  const [facets, setFacets] = useState<Facets | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [allocation, setAllocation] = useState<AllocationRow[]>([])
  const [upcoming, setUpcoming] = useState<ListRow[]>([])
  const [missed, setMissed] = useState<ListRow[]>([])
  const [expired, setExpired] = useState<ExpiredCall[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [schoolIds, setSchoolIds] = useState<string[]>([])
  const [departmentIds, setDepartmentIds] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [agency, setAgency] = useState('')

  // Reports
  const [groupBy, setGroupBy] = useState('agency')
  const [reportRows, setReportRows] = useState<ReportRow[]>([])
  const [reportLoading, setReportLoading] = useState(false)

  // Notify
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [notifyTarget, setNotifyTarget] = useState<AllocationRow | null>(null)
  const [notifyTitle, setNotifyTitle] = useState('')
  const [notifyBody, setNotifyBody] = useState('')
  const [notifySaving, setNotifySaving] = useState(false)
  const [notifyError, setNotifyError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isAdmin = Boolean(user?.roles?.some((role: string) => ADMIN_ROLES.includes(role)))

  /** A School selection expands to its departments — faculty hang off departments. */
  const effectiveOrgUnitIds = useMemo(() => {
    if (departmentIds.length > 0) return departmentIds
    if (schoolIds.length === 0 || !facets) return []
    return facets.schools
      .filter((school) => schoolIds.includes(school.id))
      .flatMap((school) => school.departments.map((department) => department.id))
  }, [departmentIds, schoolIds, facets])

  const departmentOptions = useMemo(() => {
    if (!facets) return []
    const schools =
      schoolIds.length > 0
        ? facets.schools.filter((school) => schoolIds.includes(school.id))
        : facets.schools
    return schools.flatMap((school) => school.departments)
  }, [facets, schoolIds])

  const buildParams = useCallback(() => {
    const params = new URLSearchParams()
    if (effectiveOrgUnitIds.length > 0) params.set('orgUnitIds', effectiveOrgUnitIds.join(','))
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (agency.trim()) params.set('agency', agency.trim())
    return params
  }, [effectiveOrgUnitIds, dateFrom, dateTo, agency])

  const loadFacets = useCallback(async () => {
    try {
      const res = await authFetch('/api/researcher-matching?action=facets')
      if (res.ok) setFacets(await res.json())
    } catch {}
  }, [authFetch])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/tenant-admin/grant-dashboard?${buildParams()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the dashboard')
      setSummary(data.summary)
      setAllocation(data.allocation || [])
      setUpcoming(data.upcoming || [])
      setMissed(data.missed || [])
      setExpired(data.unassignedExpired || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authFetch, buildParams])

  const loadReport = useCallback(async () => {
    setReportLoading(true)
    try {
      const params = buildParams()
      params.set('groupBy', groupBy)
      const res = await authFetch(`/api/tenant-admin/grant-dashboard/report?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not build the report')
      setReportRows(data.rows || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setReportLoading(false)
    }
  }, [authFetch, buildParams, groupBy])

  useEffect(() => {
    if (user) loadFacets()
  }, [user, loadFacets])

  useEffect(() => {
    if (user) loadDashboard()
  }, [user, loadDashboard])

  useEffect(() => {
    if (user && tab === 'reports') loadReport()
  }, [user, tab, loadReport])

  const exportCsv = async () => {
    try {
      const params = buildParams()
      params.set('groupBy', groupBy)
      params.set('format', 'csv')
      const res = await authFetch(`/api/tenant-admin/grant-dashboard/report?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `grant-report-${groupBy}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const openNotify = (row: AllocationRow | null) => {
    setNotifyTarget(row)
    setNotifyTitle('')
    setNotifyBody('')
    setNotifyError(null)
    setNotifyOpen(true)
  }

  const sendNotification = async () => {
    setNotifySaving(true)
    setNotifyError(null)
    try {
      const payload: any = { title: notifyTitle, body: notifyBody, linkUrl: '/assignments' }
      if (notifyTarget?.facultyUserId) {
        payload.userIds = [notifyTarget.facultyUserId]
      } else if (effectiveOrgUnitIds.length > 0) {
        payload.orgUnitIds = effectiveOrgUnitIds
      } else {
        payload.allTenantUsers = true
      }

      const res = await authFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send')
      setNotice(`Notification sent to ${data.sent} recipient${data.sent === 1 ? '' : 's'}.`)
      setNotifyOpen(false)
    } catch (e: any) {
      setNotifyError(e.message)
    } finally {
      setNotifySaving(false)
    }
  }

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

  const chartData = useMemo(
    () =>
      summary
        ? [
            { name: 'Active', value: summary.active },
            { name: 'Submitted', value: summary.submitted },
            { name: 'Missed', value: summary.missed },
            { name: 'Awarded', value: summary.awarded },
          ]
        : [],
    [summary]
  )

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Access denied</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Organization admin access is required.
          </p>
        </div>
      </div>
    )
  }

  const kpis = summary
    ? [
        { label: 'Active', value: summary.active, hint: 'Deadline ahead', tone: 'text-blue-600 dark:text-blue-400' },
        { label: 'Submitted', value: summary.submitted, hint: 'Application submitted', tone: 'text-green-600 dark:text-green-400' },
        { label: 'Missed', value: summary.missed, hint: 'Deadline passed, no submission', tone: 'text-rose-600 dark:text-rose-400' },
        {
          label: 'Awarded',
          value: summary.awarded,
          hint: summary.successRate !== null ? `${summary.successRate}% success rate` : 'No decisions yet',
          tone: 'text-purple-600 dark:text-purple-400',
        },
        { label: 'Funding won', value: formatAmount(summary.awardedAmount), hint: 'Total awarded', tone: 'text-emerald-600 dark:text-emerald-400' },
        {
          label: 'Unassigned expired',
          value: summary.unassignedExpiredCalls,
          hint: 'Calls nobody was put on',
          tone: 'text-amber-600 dark:text-amber-400',
        },
      ]
    : []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Grant Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Allocation, status and outcomes across your organization.
            </p>
          </div>
          <button
            onClick={() => openNotify(null)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Notify faculty
          </button>
        </div>

        {notice && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">School</label>
              <div className="max-h-28 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                {!facets || facets.schools.length === 0 ? (
                  <span className="text-xs text-gray-400">No schools defined</span>
                ) : (
                  facets.schools.map((school) => (
                    <label key={school.id} className="flex items-center gap-2 text-xs py-0.5 text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={schoolIds.includes(school.id)}
                        onChange={() => {
                          const next = toggle(schoolIds, school.id)
                          setSchoolIds(next)
                          if (next.length > 0 && facets) {
                            const allowed = new Set(
                              facets.schools.filter((s) => next.includes(s.id)).flatMap((s) => s.departments.map((d) => d.id))
                            )
                            setDepartmentIds((ids) => ids.filter((id) => allowed.has(id)))
                          }
                        }}
                      />
                      {school.name}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Department</label>
              <div className="max-h-28 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                {departmentOptions.length === 0 ? (
                  <span className="text-xs text-gray-400">No departments</span>
                ) : (
                  departmentOptions.map((department) => (
                    <label key={department.id} className="flex items-center gap-2 text-xs py-0.5 text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={departmentIds.includes(department.id)}
                        onChange={() => setDepartmentIds(toggle(departmentIds, department.id))}
                      />
                      {department.name}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${inputClass} w-full`} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${inputClass} w-full`} />
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Agency</label>
                <input
                  type="text"
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  placeholder="e.g. SERB"
                  className={`${inputClass} w-full`}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { loadDashboard(); if (tab === 'reports') loadReport() }}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setSchoolIds([]); setDepartmentIds([]); setDateFrom(''); setDateTo(''); setAgency('')
                  }}
                  className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          {(['overview', 'reports'] as const).map((entry) => (
            <button
              key={entry}
              onClick={() => setTab(entry)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                tab === entry
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
              }`}
            >
              {entry === 'overview' ? 'Overview' : 'Reports'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : tab === 'overview' ? (
          <div className="space-y-6">
            {/* KPIs */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
              {kpis.map((kpi) => (
                <div key={kpi.label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                  <div className={`text-2xl font-bold ${kpi.tone}`}>{kpi.value}</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{kpi.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{kpi.hint}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            {summary && summary.total > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Portfolio breakdown</h2>
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={90} label>
                        {chartData.map((entry, index) => (
                          <Cell key={entry.name} fill={BUCKET_COLORS[index % BUCKET_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Allocation */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
              <h2 className="px-4 pt-4 text-sm font-semibold text-gray-900 dark:text-white">
                Allocation by school / department / faculty
              </h2>
              <table className="mt-3 min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {['School', 'Department', 'Faculty', 'Active', 'Submitted', 'Missed', 'Awarded', 'Total', ''].map((heading) => (
                      <th key={heading} className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {allocation.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                        No assignments match these filters.
                      </td>
                    </tr>
                  ) : (
                    allocation.map((row) => (
                      <tr key={`${row.facultyUserId}-${row.department}`}>
                        <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.school || '—'}</td>
                        <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.department || '—'}</td>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">{row.facultyName || '—'}</td>
                        <td className="px-4 py-2 text-sm text-blue-600 dark:text-blue-400">{row.active}</td>
                        <td className="px-4 py-2 text-sm text-green-600 dark:text-green-400">{row.submitted}</td>
                        <td className="px-4 py-2 text-sm text-rose-600 dark:text-rose-400">{row.missed}</td>
                        <td className="px-4 py-2 text-sm text-purple-600 dark:text-purple-400">{row.awarded}</td>
                        <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.total}</td>
                        <td className="px-4 py-2 text-right">
                          {row.facultyUserId && (
                            <button
                              onClick={() => openNotify(row)}
                              className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                            >
                              Notify
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Panels */}
            <div className="grid gap-6 lg:grid-cols-3">
              {[
                { title: 'Upcoming deadlines', rows: upcoming, empty: 'Nothing due soon.' },
                { title: 'Missed', rows: missed, empty: 'Nothing missed.' },
              ].map((panel) => (
                <div key={panel.title} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{panel.title}</h2>
                  {panel.rows.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{panel.empty}</p>
                  ) : (
                    <ul className="space-y-2">
                      {panel.rows.slice(0, 8).map((row) => (
                        <li key={row.id} className="text-sm">
                          <div className="font-medium text-gray-900 dark:text-white truncate">{row.callTitle}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {row.facultyName} · {row.department || '—'} · {deadlineLabel(row.deadlineAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">Missed opportunities</h2>
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">Calls that closed with nobody assigned.</p>
                {expired.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">None — every closed call had someone on it.</p>
                ) : (
                  <ul className="space-y-2">
                    {expired.slice(0, 8).map((call) => (
                      <li key={call.id} className="text-sm">
                        <div className="font-medium text-gray-900 dark:text-white truncate">{call.title}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {call.agencyName || 'Unknown agency'}
                          {call.closedAt && ` · closed ${new Date(call.closedAt).toLocaleDateString()}`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Reports */
          <div className="space-y-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Group by</label>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputClass}>
                  {GROUP_BY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <button onClick={loadReport} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                Run report
              </button>
              <button
                onClick={exportCsv}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg"
              >
                Export CSV
              </button>
            </div>

            {reportLoading ? (
              <div className="flex justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : reportRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
                No data for this grouping and date range.
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                  <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <BarChart data={reportRows.slice(0, 12)}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="active" name="Active" fill="#2563eb" />
                        <Bar dataKey="submitted" name="Submitted" fill="#059669" />
                        <Bar dataKey="missed" name="Missed" fill="#dc2626" />
                        <Bar dataKey="awarded" name="Awarded" fill="#a855f7" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        {['Group', 'Active', 'Submitted', 'Missed', 'Awarded', 'Rejected', 'Total', 'Funding won'].map((heading) => (
                          <th key={heading} className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {reportRows.map((row) => (
                        <tr key={row.label}>
                          <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">{row.label}</td>
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.active}</td>
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.submitted}</td>
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.missed}</td>
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.awarded}</td>
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.rejected}</td>
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{row.total}</td>
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{formatAmount(row.awardedAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Notify modal */}
      {notifyOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Notify faculty</h3>
            <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">
              {notifyTarget?.facultyUserId
                ? `Sending to ${notifyTarget.facultyName}.`
                : effectiveOrgUnitIds.length > 0
                  ? 'Sending to everyone in the selected school/department.'
                  : 'Sending to everyone in your organization.'}
            </p>

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
            <input
              type="text"
              value={notifyTitle}
              onChange={(e) => setNotifyTitle(e.target.value)}
              placeholder="e.g. Reminder: SERB proposals due Friday"
              className={`${inputClass} w-full mb-3`}
            />

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
            <textarea
              value={notifyBody}
              onChange={(e) => setNotifyBody(e.target.value)}
              rows={4}
              className={`${inputClass} w-full`}
            />

            {notifyError && (
              <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {notifyError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setNotifyOpen(false)}
                disabled={notifySaving}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={sendNotification}
                disabled={notifySaving || !notifyTitle.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {notifySaving ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
