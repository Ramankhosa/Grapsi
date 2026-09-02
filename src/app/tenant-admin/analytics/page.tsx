'use client'

import { useCallback, useEffect, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { UsageAnalytics } from '@/components/analytics/UsageAnalytics'
import { useAuth, useRoleAccess } from '@/lib/auth-context'

/**
 * Tenant usage analytics. Every number on this page is fetched — a card that
 * cannot load shows a dash rather than a made-up figure.
 */
export default function TenantAdminAnalyticsPage() {
  noStore()

  const { user, isLoading: authLoading, authFetch } = useAuth()
  const { isTenantAdmin, isSuperAdmin } = useRoleAccess()

  const [tenantName, setTenantName] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [planName, setPlanName] = useState<string | null>(null)
  const [planTier, setPlanTier] = useState<string | null>(null)
  const [monthCost, setMonthCost] = useState<number | null>(null)

  const allowed = isTenantAdmin || isSuperAdmin

  const loadCards = useCallback(async () => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    // Each card loads independently; one failing endpoint must not blank the rest.
    await Promise.allSettled([
      authFetch('/api/tenant-admin/users').then(async (response) => {
        if (!response.ok) return
        const data = await response.json()
        if (typeof data.total === 'number') setMemberCount(data.total)
        if (data.tenant?.name) setTenantName(data.tenant.name)
      }),
      authFetch('/api/v1/me/entitlements').then(async (response) => {
        if (!response.ok) return
        const data = await response.json()
        setPlanName(data.plan?.name ?? 'No plan')
        setPlanTier(data.plan?.tier ?? null)
      }),
      authFetch(
        `/api/analytics/usage?startDate=${encodeURIComponent(monthStart.toISOString())}`
      ).then(async (response) => {
        if (!response.ok) return
        const data = await response.json()
        if (typeof data.summary?.cost === 'number') setMonthCost(data.summary.cost)
      }),
    ])
  }, [authFetch])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!allowed) {
      window.location.href = '/dashboard'
      return
    }
    void loadCards()
  }, [authLoading, user, allowed, loadCards])

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Access denied. Tenant admin privileges required.</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Tenant Analytics</h1>
        <p className="text-gray-600">
          Monitor LLM usage within your organization
          {tenantName ? ` - ${tenantName}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Team Members</h3>
          <div className="text-2xl font-bold text-gray-900">{memberCount ?? '—'}</div>
          <p className="text-sm text-gray-500 mt-1">Users in your organization</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Current Plan</h3>
          <div className="text-2xl font-bold text-gray-900">{planName ?? '—'}</div>
          <p className="text-sm text-gray-500 mt-1">
            {planTier ? `Tier: ${planTier}` : 'Active entitlement for your organization'}
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Cost This Month</h3>
          <div className="text-2xl font-bold text-gray-900">
            {monthCost != null ? `$${monthCost.toFixed(2)}` : '—'}
          </div>
          <p className="text-sm text-gray-500 mt-1">Estimated LLM cost since the 1st</p>
        </div>
      </div>

      <UsageAnalytics title="Team Usage Analytics" isSuperAdmin={false} />
    </div>
  )
}
