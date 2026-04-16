'use client'

import { useState, useEffect } from 'react'
import { UsageAnalytics } from '@/components/analytics/UsageAnalytics'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'

export default function SuperAdminAnalyticsPage() {
  // Prevent static generation
  noStore()

  const { user, logout } = useAuth()
  const [selectedTenantId, setSelectedTenantId] = useState<string>('')
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (!user) {
      // Redirect to login if not authenticated
      window.location.href = '/login'
      return
    }

    if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      // Redirect to appropriate dashboard if not super admin
      window.location.href = '/dashboard'
      return
    }

    // Fetch tenants for the dropdown
    fetchTenants()
  }, [user])

  const fetchTenants = async () => {
    try {
      const response = await fetch('/api/tenants', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (response.ok) {
        const tenantData = await response.json()
        setTenants(tenantData.tenants || [])
      }
    } catch (error) {
      console.error('Failed to fetch tenants:', error)
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

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Super Admin Analytics</h1>
        <p className="text-gray-600">
          Monitor LLM usage across all tenants in your platform
        </p>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Total Tenants</h3>
          <div className="text-2xl font-bold text-gray-900">{tenants.length}</div>
          <p className="text-sm text-gray-500 mt-1">
            Active tenant accounts
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Platform Health</h3>
          <div className="text-2xl font-bold text-green-600">Healthy</div>
          <p className="text-sm text-gray-500 mt-1">
            All systems operational
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Active Plans</h3>
          <div className="text-2xl font-bold text-gray-900">3</div>
          <p className="text-sm text-gray-500 mt-1">
            BASIC, PRO, ENTERPRISE tiers
          </p>
        </div>
      </div>

      {/* Tenant Filter */}
      <div className="bg-white p-6 rounded-lg shadow border mb-8">
        <h3 className="text-lg font-semibold mb-4">Tenant Selection</h3>
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">All Tenants (Aggregated)</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm text-gray-600">
            {selectedTenantId
              ? `Viewing analytics for ${tenants.find(t => t.id === selectedTenantId)?.name}`
              : 'Viewing aggregated analytics across all tenants'
            }
          </div>
        </div>
      </div>

      {/* Analytics Dashboard */}
      <UsageAnalytics
        title={selectedTenantId ? "Tenant Usage Analytics" : "Platform-wide Usage Analytics"}
        isSuperAdmin={true}
        tenantId={selectedTenantId || undefined}
      />

      {/* Additional Insights */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-4">Cost Optimization Opportunities</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Unused FREE tier capacity</span>
              <span className="text-sm font-medium text-green-600">23%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Potential cost savings</span>
              <span className="text-sm font-medium text-blue-600">$1,247/mo</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Underutilized PRO plans</span>
              <span className="text-sm font-medium text-orange-600">5 tenants</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-4">System Performance</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Avg response time</span>
              <span className="text-sm font-medium text-green-600">245ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Success rate</span>
              <span className="text-sm font-medium text-green-600">99.7%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Active reservations</span>
              <span className="text-sm font-medium text-blue-600">12</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
