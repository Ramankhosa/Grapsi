'use client'

import { useState, useEffect, useCallback } from 'react'
import { DateRangePicker } from './DateRangePicker'
import { UsageOverview } from './UsageOverview'
import { UsageChart } from './UsageChart'
import { UsageTable } from './UsageTable'
import { TopUsersChart } from './TopUsersChart'

interface UsageMetrics {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  apiCalls: number
  cost: number
  requests: number
}

interface AnalyticsData {
  summary: UsageMetrics
  breakdown: Array<{
    entity: string
    entityName: string
    metrics: UsageMetrics
    percentage: number
  }>
  trends: Array<{
    period: string
    metrics: UsageMetrics
  }>
  topUsers: Array<{
    userId: string
    userName: string
    metrics: UsageMetrics
  }>
}

interface UsageAnalyticsProps {
  title: string
  isSuperAdmin?: boolean
  tenantId?: string // For super admin to filter specific tenant
}

export function UsageAnalytics({ title, isSuperAdmin = false, tenantId }: UsageAnalyticsProps) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('charts')
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    to: new Date()
  })
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly')
  const [groupBy, setGroupBy] = useState<'tenant' | 'user' | 'feature' | 'task' | 'model' | 'provider'>('user')

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        startDate: dateRange.from.toISOString(),
        endDate: dateRange.to.toISOString(),
        period,
        groupBy,
      })

      if (tenantId) {
        params.append('tenantId', tenantId)
      }

      const response = await fetch(`/api/analytics/usage?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (!response.ok) {
        throw new Error('Failed to fetch analytics data')
      }

      const analyticsData = await response.json()
      setData(analyticsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [dateRange, groupBy, period, tenantId])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow border">
          <div className="text-center text-red-600">
            <p className="text-lg font-semibold">Error Loading Analytics</p>
            <p className="text-sm mt-2">{error}</p>
            <button
              onClick={fetchAnalytics}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{title}</h1>
        <div className="flex items-center space-x-4">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
          />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            {isSuperAdmin && <option value="tenant">By Tenant</option>}
            <option value="user">By User</option>
            <option value="feature">By Feature</option>
            <option value="task">By Task</option>
            <option value="model">By Model</option>
            <option value="provider">By Provider</option>
          </select>
        </div>
      </div>

      {/* Summary Overview */}
      <UsageOverview data={data.summary} />

      {/* Detailed Analytics */}
      <div className="space-y-6">
        <div className="flex space-x-4 mb-4">
          <button
            onClick={() => setActiveTab('charts')}
            className={`px-4 py-2 rounded ${activeTab === 'charts' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
          >
            Charts
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`px-4 py-2 rounded ${activeTab === 'table' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
          >
            Table
          </button>
          {!isSuperAdmin && data.topUsers.length > 0 && (
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded ${activeTab === 'users' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
            >
              Top Users
            </button>
          )}
        </div>

        {activeTab === 'charts' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <UsageChart
              data={data.trends}
              title="Usage Trends"
              dataKey="totalTokens"
            />
            <UsageChart
              data={data.breakdown}
              title={`Breakdown by ${groupBy}`}
              dataKey="metrics.totalTokens"
              isPieChart
            />
          </div>
        )}

        {activeTab === 'table' && (
          <UsageTable
            data={data.breakdown}
            groupBy={groupBy}
          />
        )}

        {activeTab === 'users' && !isSuperAdmin && data.topUsers.length > 0 && (
          <TopUsersChart data={data.topUsers} />
        )}
      </div>
    </div>
  )
}
