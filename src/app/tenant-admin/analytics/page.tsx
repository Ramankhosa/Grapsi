'use client'

import { useState } from 'react'
import { UsageAnalytics } from '@/components/analytics/UsageAnalytics'
import { useAuth } from '@/lib/auth-context'
import { useEffect } from 'react'
import { unstable_noStore as noStore } from 'next/cache'

export default function TenantAdminAnalyticsPage() {
  // Prevent static generation
  noStore()

  const { user, logout } = useAuth()
  const [tenantInfo, setTenantInfo] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (!user) {
      // Redirect to login if not authenticated
      window.location.href = '/login'
      return
    }

    if (!user.roles?.includes('ADMIN')) {
      // Redirect to appropriate dashboard if not tenant admin
      window.location.href = '/dashboard'
      return
    }

    // Get tenant info from API
    fetchTenantInfo()
  }, [user])

  const fetchTenantInfo = async () => {
    try {
      // Get tenant info from API
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (response.ok) {
        const userData = await response.json()
        if (userData.tenant) {
          setTenantInfo(userData.tenant)
        }
      }
    } catch (error) {
      console.error('Failed to fetch tenant info:', error)
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user.roles?.includes('ADMIN')) {
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
          {tenantInfo && ` - ${tenantInfo.name}`}
        </p>
      </div>

      {/* Tenant Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Team Members</h3>
          <div className="text-2xl font-bold text-gray-900">24</div>
          <p className="text-sm text-gray-500 mt-1">
            Active users in tenant
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Current Plan</h3>
          <div className="text-2xl font-bold text-gray-900">PRO</div>
          <p className="text-sm text-gray-500 mt-1">
            Monthly token limit: 10,000
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Plan Expiry</h3>
          <div className="text-2xl font-bold text-gray-900">45 days</div>
          <p className="text-sm text-gray-500 mt-1">
            Auto-renews monthly
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Cost This Month</h3>
          <div className="text-2xl font-bold text-gray-900">$147.23</div>
          <p className="text-sm text-gray-500 mt-1">
            73% of budget used
          </p>
        </div>
      </div>

      {/* Usage Analytics */}
      <UsageAnalytics
        title="Team Usage Analytics"
        isSuperAdmin={false}
      />

      {/* Team Insights */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-4">Team Usage Patterns</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Most active user</span>
              <span className="text-sm font-medium">Sarah Johnson (2,847 tokens)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Most used feature</span>
              <span className="text-sm font-medium">Patent Drafting (68%)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Peak usage time</span>
              <span className="text-sm font-medium">2-4 PM weekdays</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Cost efficiency</span>
              <span className="text-sm font-medium text-green-600">+15% vs last month</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-4">Recommendations</h3>
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900">Optimize Token Usage</h4>
              <p className="text-sm text-blue-700 mt-1">
                Consider using shorter prompts for routine tasks. This could save ~$23/month.
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <h4 className="font-medium text-green-900">Usage Distribution</h4>
              <p className="text-sm text-green-700 mt-1">
                Your team has good usage distribution. No single user accounts for more than 25% of usage.
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg">
              <h4 className="font-medium text-orange-900">Consider Upgrading</h4>
              <p className="text-sm text-orange-700 mt-1">
                You&apos;re approaching 80% of your monthly limit. Consider upgrading for next month.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white p-6 rounded-lg shadow border mt-8">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <h3 className="font-medium mb-1">Export Report</h3>
            <p className="text-sm text-gray-600">Download detailed usage report</p>
          </button>
          <button className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <h3 className="font-medium mb-1">Set Usage Alerts</h3>
            <p className="text-sm text-gray-600">Configure spending notifications</p>
          </button>
          <button className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <h3 className="font-medium mb-1">Upgrade Plan</h3>
            <p className="text-sm text-gray-600">Increase token limits</p>
          </button>
        </div>
      </div>
    </div>
  )
}
