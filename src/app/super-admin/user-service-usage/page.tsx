'use client'

import { useEffect, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'
import { DateRangePicker } from '@/components/analytics/DateRangePicker'

interface TenantOption {
  id: string
  name: string
}

interface ServiceUsageUser {
  userId: string
  userName: string
  userEmail: string
  tenantId: string | null
  tenantName: string | null
  tenantType: 'INDIVIDUAL' | 'ENTERPRISE' | null
  patentsDrafted: number
  noveltySearches: number
  ideasReserved: number
  // Optional aggregated LLM usage metrics (filled from admin usage APIs when available)
  totalInputTokens?: number
  totalOutputTokens?: number
  totalApiCalls?: number
  totalCost?: number
  lastActivity?: string | null
}

interface ServiceUsageResponse {
  startDate: string
  endDate: string
  users: ServiceUsageUser[]
  summary: {
    totalPatentsDrafted: number
    totalNoveltySearches: number
    totalIdeasReserved: number
  }
}

type PeriodMode = 'date' | 'month' | 'year'

interface AdminUsageTenant {
  tenantId: string | null
  tenantName: string | null
  tenantType: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  patentDrafts: number
  noveltySearches: number
  ideasReserved: number
}

interface AdminUsageSummaryResponse {
  startDate: string
  endDate: string
  summary: {
    totalInputTokens: number
    totalOutputTokens: number
    totalApiCalls: number
    totalCost: number
    totalPatentsDrafted: number
    totalNoveltySearches: number
    totalIdeasReserved: number
  }
  tenants: AdminUsageTenant[]
  pagination: {
    page: number
    pageSize: number
    totalTenants: number
  }
}

interface TenantUserUsageRow {
  userId: string
  userName: string
  userEmail: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  patentDrafts: number
  noveltySearches: number
  ideasReserved: number
  lastActivity: string | null
}

interface TenantUserUsageResponse {
  startDate: string
  endDate: string
  tenantId: string
  users: TenantUserUsageRow[]
  pagination: {
    page: number
    pageSize: number
    totalUsers: number
  }
}

interface TokenTaskModel {
  model: string
  inputTokens: number
  outputTokens: number
  apiCalls: number
  cost?: number
}

interface TokenTask {
  task: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
   totalCost?: number
  models: TokenTaskModel[]
}

interface TokenDetailsState {
  userId: string
  loading: boolean
  error: string | null
  tasks: TokenTask[]
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost?: number
  activityLogs?: {
    id: string
    timestamp: string
    action: string
    taskCode?: string | null
    modelClass?: string | null
    apiCode?: string | null
    inputTokens: number
    outputTokens: number
    apiCalls: number
    cost: number
    meta?: {
      patentId?: string | null
      projectId?: string | null
      documentId?: string | null
    }
  }[]
}

// Patent cost tracking interfaces
interface PatentStageBreakdown {
  stage: string
  inputTokens: number
  outputTokens: number
  actualCost: number
  contingencyCost: number
  callCount: number
}

interface PatentCostMetrics {
  patentId: string
  patentTitle: string
  userId: string
  userName: string | null
  userEmail: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number
  createdAt: string
  stageBreakdown: PatentStageBreakdown[]
}

interface PatentCostsResponse {
  startDate: string
  endDate: string
  tenantId: string
  userId?: string
  totals: {
    totalInputTokens: number
    totalOutputTokens: number
    totalApiCalls: number
    actualCost: number
    contingencyCost: number
    patentCount: number
  }
  patents: PatentCostMetrics[]
}

export default function UserServiceUsagePage() {
  // Prevent static generation
  noStore()

  const { user, logout } = useAuth()

  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState<string>('')
  const [mode, setMode] = useState<PeriodMode>('date')
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null)

  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date()
  })

  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [selectedYear, setSelectedYear] = useState<string>('')

  const [data, setData] = useState<ServiceUsageUser[]>([])
  const [summary, setSummary] = useState<ServiceUsageResponse['summary'] | null>(null)
  const [adminSummary, setAdminSummary] = useState<AdminUsageSummaryResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [tokenDetails, setTokenDetails] = useState<TokenDetailsState | null>(null)
  const [tenantUsers, setTenantUsers] = useState<TenantUserUsageRow[]>([])
  const [tenantUsersTenantId, setTenantUsersTenantId] = useState<string | null>(null)
  const [tenantUsersLoading, setTenantUsersLoading] = useState<boolean>(false)
  const [tenantUsersError, setTenantUsersError] = useState<string | null>(null)
  
  // Patent cost tracking state
  const [patentCosts, setPatentCosts] = useState<PatentCostsResponse | null>(null)
  const [patentCostsLoading, setPatentCostsLoading] = useState<boolean>(false)
  const [patentCostsError, setPatentCostsError] = useState<string | null>(null)
  const [expandedPatentId, setExpandedPatentId] = useState<string | null>(null)
  const [showPatentCosts, setShowPatentCosts] = useState<boolean>(false)

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }

    fetchTenants()
  }, [user])

  useEffect(() => {
    if (user && user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      fetchUsage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dateRange, selectedMonth, selectedYear, selectedTenantId])

  const fetchTenants = async () => {
    try {
      const response = await fetch('/api/tenants', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })
      if (response.ok) {
        const tenantData = await response.json()
        setTenants(tenantData.tenants || [])
      }
    } catch (err) {
      console.error('Failed to fetch tenants:', err)
    }
  }

  const resolveDateRange = () => {
    if (mode === 'date') {
      return {
        start: dateRange.from,
        end: dateRange.to
      }
    }

    if (mode === 'month' && selectedMonth) {
      const [yearStr, monthStr] = selectedMonth.split('-')
      const year = parseInt(yearStr, 10)
      const month = parseInt(monthStr, 10) - 1
      const start = new Date(year, month, 1)
      const end = new Date(year, month + 1, 0)
      return { start, end }
    }

    if (mode === 'year' && selectedYear) {
      const year = parseInt(selectedYear, 10)
      const start = new Date(year, 0, 1)
      const end = new Date(year, 11, 31)
      return { start, end }
    }

    const fallbackEnd = new Date()
    const fallbackStart = new Date(fallbackEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    return { start: fallbackStart, end: fallbackEnd }
  }

  const fetchUsage = async () => {
    try {
      setLoading(true)
      setError(null)

      const { start, end } = resolveDateRange()

      const baseParams = {
        startDate: start.toISOString(),
        endDate: end.toISOString()
      }

      const serviceParams = new URLSearchParams(baseParams)
      if (selectedTenantId) {
        serviceParams.append('tenantId', selectedTenantId)
      }

      const adminParams = new URLSearchParams(baseParams)
      adminParams.append('pageSize', '1000')
      adminParams.append('sortBy', 'inputTokens')
      adminParams.append('sortDir', 'desc')

      const headers = {
        Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
      }

      const [serviceResponse, adminResponse] = await Promise.all([
        fetch(`/api/analytics/service-usage?${serviceParams.toString()}`, {
          headers
        }),
        fetch(`/api/admin/usage/summary?${adminParams.toString()}`, {
          headers
        })
      ])

      if (!serviceResponse.ok) {
        const errorData = await serviceResponse.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch service usage data')
      }

      const serviceBody: ServiceUsageResponse = await serviceResponse.json()
      setData(serviceBody.users)
      setSummary(serviceBody.summary)

      if (adminResponse.ok) {
        const adminBody: AdminUsageSummaryResponse = await adminResponse.json()
        setAdminSummary(adminBody)
      } else {
        const adminError = await adminResponse.json().catch(() => ({}))
        console.error(
          'Failed to fetch admin usage summary:',
          (adminError as any).error || adminResponse.statusText
        )
        setAdminSummary(null)
      }

      // Reset token and tenant user details when filters change
      setTokenDetails(null)
      setExpandedTenant(null)
      setTenantUsers([])
      setTenantUsersTenantId(null)
      setTenantUsersError(null)
    } catch (err) {
      console.error('Failed to fetch service usage data:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      setData([])
      setSummary(null)
      setAdminSummary(null)
      setTenantUsers([])
      setTenantUsersTenantId(null)
      setTenantUsersError(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchTenantUsers = async (tenantId: string) => {
    try {
      setTenantUsersLoading(true)
      setTenantUsersError(null)

      const { start, end } = resolveDateRange()

      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        pageSize: '1000',
        sortBy: 'inputTokens',
        sortDir: 'desc'
      })

      const response = await fetch(
        `/api/admin/usage/tenant/${tenantId}/users?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        }
      )

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to fetch tenant user usage')
      }

      const body: TenantUserUsageResponse = await response.json()

      setTenantUsers(body.users || [])
      setTenantUsersTenantId(body.tenantId || tenantId)
    } catch (err) {
      console.error('Failed to fetch tenant user usage:', err)
      setTenantUsers([])
      setTenantUsersTenantId(null)
      setTenantUsersError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setTenantUsersLoading(false)
    }
  }

  const fetchPatentCosts = async (tenantId: string, userId?: string) => {
    try {
      setPatentCostsLoading(true)
      setPatentCostsError(null)

      const { start, end } = resolveDateRange()

      const params = new URLSearchParams({
        tenantId,
        startDate: start.toISOString(),
        endDate: end.toISOString()
      })

      if (userId) {
        params.append('userId', userId)
      }

      const response = await fetch(`/api/admin/usage/patent-costs?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to fetch patent costs')
      }

      const body: PatentCostsResponse = await response.json()
      setPatentCosts(body)
    } catch (err) {
      console.error('Failed to fetch patent costs:', err)
      setPatentCostsError(err instanceof Error ? err.message : 'Unknown error')
      setPatentCosts(null)
    } finally {
      setPatentCostsLoading(false)
    }
  }

  const fetchTokenDetails = async (userId: string, tenantId?: string | null) => {
    try {
      if (tokenDetails && tokenDetails.userId === userId) {
        // Toggle off if clicking the same user again
        setTokenDetails(null)
        return
      }

      const { start, end } = resolveDateRange()

      setTokenDetails({
        userId,
        loading: true,
        error: null,
        tasks: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0
      })

      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        userId
      })

      if (selectedTenantId) {
        params.append('tenantId', selectedTenantId)
      }

      const response = await fetch(`/api/analytics/user-task-tokens?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to fetch token usage details')
      }

      const body = await response.json()
      const users = body.users || []
      const entry = users.find((u: any) => u.userId === userId)

      if (!entry) {
        setTokenDetails(prev => ({
          userId,
          loading: false,
          error: null,
          tasks: [],
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalApiCalls: 0,
          totalCost: 0
        }))
        return
      }

      const baseDetails: TokenDetailsState = {
        userId,
        loading: false,
        error: null,
        tasks: entry.tasks || [],
        totalInputTokens: entry.totalInputTokens || 0,
        totalOutputTokens: entry.totalOutputTokens || 0,
        totalApiCalls: entry.totalApiCalls || 0,
        totalCost: entry.totalCost || 0
      }

      let activityLogs: TokenDetailsState['activityLogs'] = []
      if (tenantId) {
        try {
          const params2 = new URLSearchParams({
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            page: '1',
            pageSize: '50',
            sortBy: 'startedAt',
            sortDir: 'desc'
          })
          const resp2 = await fetch(
            `/api/admin/usage/tenant/${tenantId}/user/${userId}/details?${params2.toString()}`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
              }
            }
          )
          if (resp2.ok) {
            const body2 = await resp2.json()
            activityLogs = (body2.logs || []).map((log: any) => ({
              id: log.id,
              timestamp: log.timestamp,
              action: log.action,
              taskCode: log.taskCode,
              modelClass: log.modelClass,
              apiCode: log.apiCode,
              inputTokens: log.inputTokens,
              outputTokens: log.outputTokens,
              apiCalls: log.apiCalls,
              cost: log.cost,
              meta: log.meta
            }))
          }
        } catch {
          // ignore activity log errors
        }
      }

      setTokenDetails({
        ...baseDetails,
        activityLogs
      })
    } catch (err) {
      setTokenDetails({
        userId,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load token details',
        tasks: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        activityLogs: []
      })
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Access denied. Super admin privileges required.</div>
      </div>
    )
  }

  const formatNumber = (value: number) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 4
    }).format(value || 0)

  const tenantsAggregated = (() => {
    if (adminSummary) {
      const usersByTenant: Record<string, ServiceUsageUser[]> = {}
      data.forEach(u => {
        const key = u.tenantId || 'no-tenant'
        if (!usersByTenant[key]) {
          usersByTenant[key] = []
        }
        usersByTenant[key].push(u)
      })

      return adminSummary.tenants.map(t => {
        const key = t.tenantId || 'no-tenant'
        const usersForTenant = usersByTenant[key] || []
        const totalActions =
          t.patentDrafts + t.noveltySearches + t.ideasReserved

        return {
          tenantId: key,
          realTenantId: t.tenantId,
          name: t.tenantName || 'No tenant',
          type: t.tenantType,
          users: usersForTenant,
          patentsDrafted: t.patentDrafts,
          noveltySearches: t.noveltySearches,
          ideasReserved: t.ideasReserved,
          totalInputTokens: t.totalInputTokens,
          totalOutputTokens: t.totalOutputTokens,
          totalApiCalls: t.totalApiCalls,
          totalCost: t.totalCost,
          totalActions
        }
      })
    }

    const buckets: Record<string, {
      name: string
      type: string | null
      users: ServiceUsageUser[]
      patentsDrafted: number
      noveltySearches: number
      ideasReserved: number
    }> = {}
    data.forEach(u => {
      const key = u.tenantId || 'no-tenant'
      if (!buckets[key]) {
        buckets[key] = {
          name: u.tenantName || 'No tenant',
          type: u.tenantType || null,
          users: [],
          patentsDrafted: 0,
          noveltySearches: 0,
          ideasReserved: 0
        }
      }
      buckets[key].users.push(u)
      buckets[key].patentsDrafted += u.patentsDrafted
      buckets[key].noveltySearches += u.noveltySearches
      buckets[key].ideasReserved += u.ideasReserved
    })
    return Object.entries(buckets).map(([id, bucket]) => ({
      tenantId: id,
      realTenantId: id === 'no-tenant' ? null : id,
      ...bucket,
      totalActions: bucket.patentsDrafted + bucket.noveltySearches + bucket.ideasReserved
    }))
  })()

  const visibleUsers: ServiceUsageUser[] = (() => {
    if (expandedTenant && tenantUsersTenantId && tenantUsers.length > 0) {
      const domainUsers = data.filter(
        u => (u.tenantId || 'no-tenant') === expandedTenant
      )
      const domainMap = new Map(domainUsers.map(u => [u.userId, u]))

      return tenantUsers.map(u => {
        const domain = domainMap.get(u.userId)
        const base: ServiceUsageUser = domain || {
          userId: u.userId,
          userName: u.userName,
          userEmail: u.userEmail,
          tenantId: expandedTenant === 'no-tenant' ? null : expandedTenant,
          tenantName: null,
          tenantType: null,
          patentsDrafted: u.patentDrafts,
          noveltySearches: u.noveltySearches,
          ideasReserved: u.ideasReserved
        }

        return {
          ...base,
          totalInputTokens: u.totalInputTokens,
          totalOutputTokens: u.totalOutputTokens,
          totalApiCalls: u.totalApiCalls,
          totalCost: u.totalCost,
          lastActivity: u.lastActivity
        }
      })
    }

    return expandedTenant
      ? data.filter(u => (u.tenantId || 'no-tenant') === expandedTenant)
      : data
  })()

  const handleTenantRowClick = (tenantId: string, realTenantId: string | null) => {
    const isOpen = expandedTenant === tenantId
    if (isOpen) {
      setExpandedTenant(null)
      setTenantUsers([])
      setTenantUsersTenantId(null)
      setTenantUsersError(null)
      return
    }

    setExpandedTenant(tenantId)

    if (realTenantId) {
      fetchTenantUsers(realTenantId)
    } else {
      setTenantUsers([])
      setTenantUsersTenantId(null)
      setTenantUsersError(null)
    }
  }

  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleString()
    } catch {
      return value
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">User Wise Service Usage</h1>
            <p className="text-gray-600 mt-1">
              Monitor how many patents, novelty searches, idea reservations, and LLM tokens each user consumes.
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">Super Admin: {user.email}</span>
            <button
              onClick={() => logout()}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Filters */}
        <div className="bg-white p-6 rounded-lg shadow border space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Filters</h2>
              <p className="text-sm text-gray-500">
                Filter by date, month, or year and narrow down to a specific tenant.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-sm font-medium text-gray-700">View by:</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as PeriodMode)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="date">Date range</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            {mode === 'date' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date range
                </label>
                <DateRangePicker value={dateRange} onChange={setDateRange} />
              </div>
            )}

            {mode === 'month' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Month
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            )}

            {mode === 'year' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Year
                </label>
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="e.g. 2025"
                />
              </div>
            )}

            <div className={mode === 'date' ? 'md:col-span-1' : ''}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tenant
              </label>
              <select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All tenants</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchUsage}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow border">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Patents drafted</h3>
            <div className="text-2xl font-bold text-gray-900">
              {summary ? formatNumber(summary.totalPatentsDrafted) : '—'}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Total drafting sessions started in the selected period.
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Novelty searches</h3>
            <div className="text-2xl font-bold text-gray-900">
              {summary ? formatNumber(summary.totalNoveltySearches) : '—'}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Completed novelty search runs in the selected period.
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Patent ideas reserved</h3>
            <div className="text-2xl font-bold text-gray-900">
              {summary ? formatNumber(summary.totalIdeasReserved) : '—'}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              New idea bank reservations created in the selected period.
            </p>
          </div>
        </div>

        {/* Token + cost summary */}
        {adminSummary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-lg shadow border">
              <h3 className="text-sm font-medium text-gray-600 mb-2">Total input tokens</h3>
              <div className="text-2xl font-bold text-gray-900">
                {formatNumber(adminSummary.summary.totalInputTokens)}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Across all tenants in the selected period.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border">
              <h3 className="text-sm font-medium text-gray-600 mb-2">Total output tokens</h3>
              <div className="text-2xl font-bold text-gray-900">
                {formatNumber(adminSummary.summary.totalOutputTokens)}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Tokens generated by LLM responses.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border">
              <h3 className="text-sm font-medium text-gray-600 mb-2">API calls</h3>
              <div className="text-2xl font-bold text-gray-900">
                {formatNumber(adminSummary.summary.totalApiCalls)}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Total metered LLM operations.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border">
              <h3 className="text-sm font-medium text-gray-600 mb-2">Estimated LLM cost</h3>
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(adminSummary.summary.totalCost)}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Based on dynamic per-model pricing.
              </p>
            </div>
          </div>
        )}

        {/* Tenant drill-down */}
        <div className="bg-white p-6 rounded-lg shadow border space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Tenant overview</h2>
              <p className="text-sm text-gray-500">Click a tenant to view its users.</p>
            </div>
            <span className="text-xs text-gray-500">{tenantsAggregated.length} tenant rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-2 text-left">Tenant</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-right">Patents drafted</th>
                  <th className="px-4 py-2 text-right">Novelty searches</th>
                  <th className="px-4 py-2 text-right">Ideas reserved</th>
                  <th className="px-4 py-2 text-right">Total actions</th>
                  <th className="px-4 py-2 text-right">Users</th>
                </tr>
              </thead>
              <tbody>
                {tenantsAggregated.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                      No tenant data for the selected filters.
                    </td>
                  </tr>
                )}
                  {tenantsAggregated.map(t => {
                    const isOpen = expandedTenant === t.tenantId
                    return (
                      <tr key={t.tenantId} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => handleTenantRowClick(t.tenantId, t.realTenantId)}>
                      <td className="px-4 py-2">
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-gray-500">{t.tenantId}</div>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700">{t.type || 'N/A'}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatNumber(t.patentsDrafted)}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatNumber(t.noveltySearches)}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatNumber(t.ideasReserved)}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{formatNumber(t.totalActions)}</td>
                      <td className="px-4 py-2 text-right text-xs text-indigo-600 underline">
                        {t.users.length} user{t.users.length === 1 ? '' : 's'} {isOpen ? '▼' : '▶'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white p-6 rounded-lg shadow border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">User-wise service usage</h2>
              <p className="text-sm text-gray-500">
                Showing {visibleUsers.length} user{visibleUsers.length === 1 ? '' : 's'}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const header = [
                    'tenantName',
                    'tenantType',
                    'userName',
                    'userEmail',
                    'patentsDrafted',
                    'noveltySearches',
                    'ideasReserved',
                    'totalActions'
                  ]
                  const rows = visibleUsers.map(row => [
                    row.tenantName || '',
                    row.tenantType || '',
                    row.userName,
                    row.userEmail,
                    row.patentsDrafted,
                    row.noveltySearches,
                    row.ideasReserved,
                    row.patentsDrafted + row.noveltySearches + row.ideasReserved
                  ])
                  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = 'user-service-usage.csv'
                  link.click()
                  URL.revokeObjectURL(url)
                }}
                className="inline-flex items-center px-3 py-2 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Export CSV
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-2 text-left">Tenant</th>
                    <th className="px-4 py-2 text-left">Tenant type</th>
                    <th className="px-4 py-2 text-left">User</th>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-right">Patents drafted</th>
                    <th className="px-4 py-2 text-right">Novelty searches</th>
                    <th className="px-4 py-2 text-right">Ideas reserved</th>
                    <th className="px-4 py-2 text-right">Total actions</th>
                    <th className="px-4 py-2 text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        No activity found for the selected filters.
                      </td>
                    </tr>
                  )}

                  {visibleUsers.map((row) => {
                    const totalActions =
                      row.patentsDrafted + row.noveltySearches + row.ideasReserved

                    const isExpanded = tokenDetails?.userId === row.userId

                    return (
                      <>
                        <tr key={row.userId} className="border-b hover:bg-gray-50 align-top">
                          <td className="px-4 py-2">
                            <div className="font-medium">
                              {row.tenantName || '—'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {row.tenantId || 'No tenant'}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                              {row.tenantType || 'N/A'}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-medium">{row.userName}</div>
                            <div className="text-xs text-gray-500">ID: {row.userId}</div>
                          </td>
                          <td className="px-4 py-2">{row.userEmail}</td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatNumber(row.patentsDrafted)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatNumber(row.noveltySearches)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatNumber(row.ideasReserved)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold">
                            {formatNumber(totalActions)}
                            {typeof row.totalInputTokens === 'number' &&
                              typeof row.totalOutputTokens === 'number' && (
                                <div className="mt-1 text-[11px] text-gray-500 font-normal">
                                  {formatNumber(row.totalInputTokens)}/
                                  {formatNumber(row.totalOutputTokens)} tokens
                                  {typeof row.totalCost === 'number' && (
                                    <>
                                      {' '}
                                      · {formatCurrency(row.totalCost || 0)}
                                    </>
                                  )}
                                </div>
                              )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => fetchTokenDetails(row.userId, row.tenantId)}
                                className="inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                              >
                                {isExpanded ? 'Hide' : 'View'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && tokenDetails && (
                          <tr className="bg-gray-50">
                            <td colSpan={9} className="px-4 py-3">
                              {tokenDetails.loading ? (
                                <div className="text-xs text-gray-500">Loading token usage...</div>
                              ) : tokenDetails.error ? (
                                <div className="text-xs text-red-600">{tokenDetails.error}</div>
                              ) : (
                                <div className="space-y-2 text-xs text-gray-700">
                                  <div className="font-semibold">
                                    Token usage (input/output, API calls, cost):{' '}
                                    {formatNumber(tokenDetails.totalInputTokens)}/
                                    {formatNumber(tokenDetails.totalOutputTokens)} ·{' '}
                                    {formatNumber(tokenDetails.totalApiCalls)} calls ·{' '}
                                    {formatCurrency((tokenDetails as any).totalCost || 0)}
                                  </div>
                                  {tokenDetails.tasks.length === 0 ? (
                                    <div className="text-gray-500">
                                      No LLM usage logs found for this user in the selected period.
                                    </div>
                                  ) : (
                                    <div className="space-y-2">
                                      {tokenDetails.tasks.map(task => (
                                        <div key={task.task} className="border rounded-md p-2 bg-white">
                                          <div className="flex justify-between">
                                            <div>
                                              <span className="font-semibold">Task:</span>{' '}
                                              <span className="font-mono">{task.task}</span>
                                            </div>
                                            <div className="font-mono text-[11px] text-gray-600">
                                              in/out: {formatNumber(task.totalInputTokens)}/
                                              {formatNumber(task.totalOutputTokens)} ·{' '}
                                              {formatNumber(task.totalApiCalls)} calls ·{' '}
                                              {formatCurrency((task as any).totalCost || 0)}
                                            </div>
                                          </div>
                                          {task.models.length > 0 && (
                                            <div className="mt-1 pl-2 border-l border-gray-200">
                                              <div className="text-[11px] text-gray-500 mb-1">
                                                Models:
                                              </div>
                                              <ul className="space-y-0.5">
                                                {task.models.map(model => (
                                                  <li key={model.model} className="flex justify-between text-[11px]">
                                                    <span className="font-mono">{model.model}</span>
                                                    <span className="font-mono text-gray-600">
                                                      in/out: {formatNumber(model.inputTokens)}/
                                                      {formatNumber(model.outputTokens)} ·{' '}
                                                      {formatNumber(model.apiCalls)} calls ·{' '}
                                                      {formatCurrency((model as any).cost || 0)}
                                                    </span>
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Patent-wise Cost Tracking Section */}
        <div className="bg-white p-6 rounded-lg shadow border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Patent-wise Cost Breakdown</h2>
              <p className="text-sm text-gray-500">
                View detailed LLM costs per patent with 10% contingency buffer for billing.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {selectedTenantId && (
                <button
                  onClick={() => {
                    setShowPatentCosts(true)
                    fetchPatentCosts(selectedTenantId)
                  }}
                  disabled={patentCostsLoading}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  {patentCostsLoading ? 'Loading...' : 'Load Patent Costs'}
                </button>
              )}
              {!selectedTenantId && (
                <span className="text-sm text-amber-600">
                  ⚠️ Select a tenant to view patent-wise costs
                </span>
              )}
            </div>
          </div>

          {showPatentCosts && patentCostsError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {patentCostsError}
            </div>
          )}

          {showPatentCosts && patentCosts && (
            <>
              {/* Patent Cost Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                  <h4 className="text-xs font-medium text-blue-700 mb-1">Total Patents</h4>
                  <div className="text-xl font-bold text-blue-900">
                    {formatNumber(patentCosts.totals.patentCount)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
                  <h4 className="text-xs font-medium text-purple-700 mb-1">Input Tokens</h4>
                  <div className="text-xl font-bold text-purple-900">
                    {formatNumber(patentCosts.totals.totalInputTokens)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 rounded-lg border border-indigo-200">
                  <h4 className="text-xs font-medium text-indigo-700 mb-1">Output Tokens</h4>
                  <div className="text-xl font-bold text-indigo-900">
                    {formatNumber(patentCosts.totals.totalOutputTokens)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                  <h4 className="text-xs font-medium text-green-700 mb-1">Actual Cost</h4>
                  <div className="text-xl font-bold text-green-900">
                    {formatCurrency(patentCosts.totals.actualCost)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-lg border border-amber-200">
                  <h4 className="text-xs font-medium text-amber-700 mb-1">With 10% Buffer</h4>
                  <div className="text-xl font-bold text-amber-900">
                    {formatCurrency(patentCosts.totals.contingencyCost)}
                  </div>
                  <p className="text-[10px] text-amber-600 mt-1">Use for billing</p>
                </div>
              </div>

              {/* Patent Cost Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="px-4 py-2 text-left">Patent</th>
                      <th className="px-4 py-2 text-left">User</th>
                      <th className="px-4 py-2 text-right">Input Tokens</th>
                      <th className="px-4 py-2 text-right">Output Tokens</th>
                      <th className="px-4 py-2 text-right">API Calls</th>
                      <th className="px-4 py-2 text-right">Actual Cost</th>
                      <th className="px-4 py-2 text-right">With 10% Buffer</th>
                      <th className="px-4 py-2 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patentCosts.patents.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                          No patent cost data found for the selected filters.
                        </td>
                      </tr>
                    )}
                    {patentCosts.patents.map((patent) => {
                      const isExpanded = expandedPatentId === patent.patentId
                      return (
                        <>
                          <tr key={patent.patentId} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <div className="font-medium text-gray-900 max-w-xs truncate" title={patent.patentTitle}>
                                {patent.patentTitle}
                              </div>
                              <div className="text-xs text-gray-500 font-mono">{patent.patentId.substring(0, 12)}...</div>
                            </td>
                            <td className="px-4 py-2">
                              <div className="text-gray-900">{patent.userName || 'Unknown'}</div>
                              <div className="text-xs text-gray-500">{patent.userEmail}</div>
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatNumber(patent.totalInputTokens)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatNumber(patent.totalOutputTokens)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {formatNumber(patent.totalApiCalls)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-green-700">
                              {formatCurrency(patent.actualCost)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-semibold text-amber-700">
                              {formatCurrency(patent.contingencyCost)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={() => setExpandedPatentId(isExpanded ? null : patent.patentId)}
                                className="inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                              >
                                {isExpanded ? 'Hide' : 'Stages'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && patent.stageBreakdown.length > 0 && (
                            <tr className="bg-gray-50">
                              <td colSpan={8} className="px-4 py-3">
                                <div className="text-xs">
                                  <div className="font-semibold text-gray-700 mb-2">
                                    Cost breakdown by stage/operation:
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {patent.stageBreakdown.map((stage, idx) => (
                                      <div key={idx} className="bg-white border rounded p-2">
                                        <div className="font-medium text-gray-800">{stage.stage}</div>
                                        <div className="text-[11px] text-gray-600 space-y-0.5 mt-1">
                                          <div>Input: {formatNumber(stage.inputTokens)} tokens</div>
                                          <div>Output: {formatNumber(stage.outputTokens)} tokens</div>
                                          <div>Calls: {stage.callCount}</div>
                                          <div className="text-green-700">
                                            Actual: {formatCurrency(stage.actualCost)}
                                          </div>
                                          <div className="text-amber-700 font-semibold">
                                            +10%: {formatCurrency(stage.contingencyCost)}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Export Patent Costs Button */}
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => {
                    const header = [
                      'patentId',
                      'patentTitle',
                      'userName',
                      'userEmail',
                      'inputTokens',
                      'outputTokens',
                      'apiCalls',
                      'actualCost',
                      'contingencyCost'
                    ]
                    const rows = patentCosts.patents.map(p => [
                      p.patentId,
                      p.patentTitle,
                      p.userName || '',
                      p.userEmail,
                      p.totalInputTokens,
                      p.totalOutputTokens,
                      p.totalApiCalls,
                      p.actualCost.toFixed(6),
                      p.contingencyCost.toFixed(6)
                    ])
                    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = 'patent-costs.csv'
                    link.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Export Patent Costs CSV
                </button>
              </div>
            </>
          )}

          {showPatentCosts && patentCostsLoading && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
