'use client'
/* eslint-disable react/no-unescaped-entities */

import { useEffect, useState, useCallback } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'

// Types
interface FeatureQuota {
  id: string
  featureId: string
  featureCode: string
  featureName: string
  unit: string
  dailyQuota: number | null
  monthlyQuota: number | null
  dailyTokenLimit: number | null
  monthlyTokenLimit: number | null
}

interface Plan {
  id: string
  code: string
  name: string
  cycle: string
  status: string
  tenantCount: number
  userCount: number
  features: FeatureQuota[]
}

interface UsageSummary {
  serviceType: string
  completions: number
  tokens: number
  costUsd: number
}

interface TenantSummary {
  id: string
  name: string
  status: string
  userCount: number
  plan: string
  monthlyUsage?: UsageSummary[]
  totalMonthlyCost?: number
}

interface ModelPrice {
  id: string
  provider: string
  modelClass: string
  inputPricePerMTokens: number
  outputPricePerMTokens: number
  currency: string
}

interface DashboardData {
  summary: {
    totalTenants: number
    totalUsers: number
    totalPlans: number
    activeSubscriptions: number
  }
  todayUsage: UsageSummary[]
  monthUsage: UsageSummary[]
  plans: Plan[]
  tenants: TenantSummary[]
  modelPrices: ModelPrice[]
}

// Service display names
const SERVICE_LABELS: Record<string, string> = {
  PATENT_DRAFTING: 'Patent Drafting',
  NOVELTY_SEARCH: 'Novelty Search',
  PRIOR_ART_SEARCH: 'Prior Art Search',
  DIAGRAM_GENERATION: 'Diagram Generation',
  IDEA_BANK: 'Idea Bank',
  PERSONA_SYNC: 'Persona Sync',
  PATENT_REVIEW: 'Patent Review',
  IDEATION: 'Patent Ideation Engine',
  FUNDING_DISCOVERY: 'Funding Discovery',
  GRANT_PREP: 'Grant Prep',
  GRANT_DRAFTING: 'Grant Drafting',
}

const FEATURE_CODES = [
  'PATENT_DRAFTING',
  'PRIOR_ART_SEARCH',
  'DIAGRAM_GENERATION',
  'IDEA_BANK',
  'PERSONA_SYNC',
  'PATENT_REVIEW',
  'IDEATION',
  'FUNDING_DISCOVERY',
  'GRANT_PREP',
  'GRANT_DRAFTING',
]

export default function ServiceControlPage() {
  noStore()

  const { user, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'plans' | 'tenants' | 'costs'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [allTenants, setAllTenants] = useState<TenantSummary[]>([])
  
  // Edit states
  const [editingPlan, setEditingPlan] = useState<string | null>(null)
  const [editingQuotas, setEditingQuotas] = useState<Record<string, any>>({})
  const [savingQuota, setSavingQuota] = useState(false)
  
  // New plan form
  const [showNewPlanForm, setShowNewPlanForm] = useState(false)
  const [newPlanForm, setNewPlanForm] = useState({
    code: '',
    name: '',
    cycle: 'MONTHLY'
  })
  const [creatingPlan, setCreatingPlan] = useState(false)

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (!user.roles?.some((role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }

    fetchDashboardData()
    fetchAllTenantsUsage()
  }, [user])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/super-admin/service-control?action=dashboard', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load dashboard data')
      }

      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }

  const fetchAllTenantsUsage = async () => {
    try {
      const response = await fetch('/api/super-admin/service-control?action=all_tenants', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })

      if (response.ok) {
        const result = await response.json()
        setAllTenants(result.tenants || [])
      }
    } catch (err) {
      console.error('Failed to fetch tenant usage:', err)
    }
  }

  const handleEditPlan = (planId: string) => {
    const plan = data?.plans.find(p => p.id === planId)
    if (!plan) return

    const quotas: Record<string, any> = {}
    plan.features.forEach(f => {
      quotas[f.featureCode] = {
        dailyQuota: f.dailyQuota,
        monthlyQuota: f.monthlyQuota,
        dailyTokenLimit: f.dailyTokenLimit,
        monthlyTokenLimit: f.monthlyTokenLimit
      }
    })

    setEditingQuotas(quotas)
    setEditingPlan(planId)
  }

  const handleSaveQuotas = async () => {
    if (!editingPlan) return

    try {
      setSavingQuota(true)
      setError(null)

      for (const [featureCode, quotas] of Object.entries(editingQuotas)) {
        const response = await fetch('/api/super-admin/service-control', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'update_plan_quota',
            planId: editingPlan,
            featureCode,
            updates: quotas
          })
        })

        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to save quota')
        }
      }

      setSuccess('Quotas updated successfully')
      setEditingPlan(null)
      await fetchDashboardData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quotas')
    } finally {
      setSavingQuota(false)
    }
  }

  const handleCreatePlan = async () => {
    if (!newPlanForm.code || !newPlanForm.name) {
      setError('Plan code and name are required')
      return
    }

    try {
      setCreatingPlan(true)
      setError(null)

      const response = await fetch('/api/super-admin/service-control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'create_plan',
          ...newPlanForm
        })
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create plan')
      }

      setSuccess('Plan created successfully')
      setShowNewPlanForm(false)
      setNewPlanForm({ code: '', name: '', cycle: 'MONTHLY' })
      await fetchDashboardData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create plan')
    } finally {
      setCreatingPlan(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4
    }).format(amount)
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num)
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
      </div>
    )
  }

  const isViewer = user.roles?.includes('SUPER_ADMIN_VIEWER') && !user.roles?.includes('SUPER_ADMIN')

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">🎛️ Service Control Center</h1>
            <p className="text-slate-400 text-sm mt-1">
              Comprehensive quota management, usage monitoring, and cost tracking
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-slate-400">
              {isViewer ? '👁️ Viewer' : '⚡ Admin'}: {user.email}
            </span>
            <button
              onClick={() => logout()}
              className="px-4 py-2 text-sm font-medium rounded-md text-slate-300 bg-slate-700 hover:bg-slate-600 border border-slate-600"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {[
              { id: 'overview', label: '📊 Overview', icon: '📊' },
              { id: 'plans', label: '📋 Plans & Quotas', icon: '📋' },
              { id: 'tenants', label: '🏢 Tenants', icon: '🏢' },
              { id: 'costs', label: '💰 Cost Analytics', icon: '💰' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-cyan-400 text-cyan-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Alerts */}
        {error && (
          <div className="mb-6 bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="float-right text-red-400 hover:text-red-200">×</button>
          </div>
        )}
        {success && (
          <div className="mb-6 bg-green-900/50 border border-green-700 text-green-200 px-4 py-3 rounded-lg">
            {success}
            <button onClick={() => setSuccess(null)} className="float-right text-green-400 hover:text-green-200">×</button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
          </div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === 'overview' && data && (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <div className="text-3xl font-bold text-cyan-400">{data.summary.totalTenants}</div>
                    <div className="text-slate-400 text-sm mt-1">Total Tenants</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <div className="text-3xl font-bold text-emerald-400">{data.summary.totalUsers}</div>
                    <div className="text-slate-400 text-sm mt-1">Total Users</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <div className="text-3xl font-bold text-amber-400">{data.summary.totalPlans}</div>
                    <div className="text-slate-400 text-sm mt-1">Active Plans</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <div className="text-3xl font-bold text-purple-400">{data.summary.activeSubscriptions}</div>
                    <div className="text-slate-400 text-sm mt-1">Active Subscriptions</div>
                  </div>
                </div>

                {/* Today's Usage */}
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <h2 className="text-lg font-semibold text-cyan-400 mb-4">📈 Today's Usage</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-3 px-4 text-slate-400">Service</th>
                          <th className="text-right py-3 px-4 text-slate-400">Completions</th>
                          <th className="text-right py-3 px-4 text-slate-400">Tokens Used</th>
                          <th className="text-right py-3 px-4 text-slate-400">Cost (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.todayUsage.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500">No usage today</td>
                          </tr>
                        ) : (
                          data.todayUsage.map(u => (
                            <tr key={u.serviceType} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                              <td className="py-3 px-4 font-medium">{SERVICE_LABELS[u.serviceType] || u.serviceType}</td>
                              <td className="py-3 px-4 text-right font-mono">{formatNumber(u.completions)}</td>
                              <td className="py-3 px-4 text-right font-mono">{formatNumber(u.tokens)}</td>
                              <td className="py-3 px-4 text-right font-mono text-emerald-400">{formatCurrency(u.costUsd)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Monthly Usage */}
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <h2 className="text-lg font-semibold text-cyan-400 mb-4">📅 This Month's Usage</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-3 px-4 text-slate-400">Service</th>
                          <th className="text-right py-3 px-4 text-slate-400">Completions</th>
                          <th className="text-right py-3 px-4 text-slate-400">Tokens Used</th>
                          <th className="text-right py-3 px-4 text-slate-400">Cost (USD)</th>
                          <th className="text-right py-3 px-4 text-slate-400">Avg Cost/Completion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.monthUsage.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-500">No usage this month</td>
                          </tr>
                        ) : (
                          data.monthUsage.map(u => (
                            <tr key={u.serviceType} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                              <td className="py-3 px-4 font-medium">{SERVICE_LABELS[u.serviceType] || u.serviceType}</td>
                              <td className="py-3 px-4 text-right font-mono">{formatNumber(u.completions)}</td>
                              <td className="py-3 px-4 text-right font-mono">{formatNumber(u.tokens)}</td>
                              <td className="py-3 px-4 text-right font-mono text-emerald-400">{formatCurrency(u.costUsd)}</td>
                              <td className="py-3 px-4 text-right font-mono text-amber-400">
                                {u.completions > 0 ? formatCurrency(u.costUsd / u.completions) : '-'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Plans Tab */}
            {activeTab === 'plans' && data && (
              <div className="space-y-6">
                {/* Create Plan Button */}
                {!isViewer && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowNewPlanForm(true)}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium"
                    >
                      + Create New Plan
                    </button>
                  </div>
                )}

                {/* New Plan Form */}
                {showNewPlanForm && (
                  <div className="bg-slate-800 rounded-xl p-6 border border-cyan-600">
                    <h3 className="text-lg font-semibold text-cyan-400 mb-4">Create New Plan</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Plan Code</label>
                        <input
                          type="text"
                          value={newPlanForm.code}
                          onChange={e => setNewPlanForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                          placeholder="e.g., STARTER_PLAN"
                          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Plan Name</label>
                        <input
                          type="text"
                          value={newPlanForm.name}
                          onChange={e => setNewPlanForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g., Starter Plan"
                          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">Billing Cycle</label>
                        <select
                          value={newPlanForm.cycle}
                          onChange={e => setNewPlanForm(prev => ({ ...prev, cycle: e.target.value }))}
                          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-slate-100"
                        >
                          <option value="MONTHLY">Monthly</option>
                          <option value="YEARLY">Yearly</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end space-x-3 mt-4">
                      <button
                        onClick={() => setShowNewPlanForm(false)}
                        className="px-4 py-2 text-slate-400 hover:text-slate-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreatePlan}
                        disabled={creatingPlan}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium disabled:opacity-50"
                      >
                        {creatingPlan ? 'Creating...' : 'Create Plan'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Plans List */}
                {data.plans.map(plan => (
                  <div key={plan.id} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-semibold text-cyan-400">
                          {plan.name}
                          <span className="ml-2 text-xs font-mono text-slate-500">({plan.code})</span>
                        </h3>
                        <p className="text-sm text-slate-400">
                          {plan.tenantCount} tenants · {plan.userCount} users · {plan.cycle}
                        </p>
                      </div>
                      {!isViewer && (
                        <button
                          onClick={() => editingPlan === plan.id ? setEditingPlan(null) : handleEditPlan(plan.id)}
                          className="px-4 py-2 text-sm font-medium rounded-md text-slate-300 bg-slate-700 hover:bg-slate-600 border border-slate-600"
                        >
                          {editingPlan === plan.id ? 'Cancel' : 'Edit Quotas'}
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className="text-left py-3 px-4 text-slate-400">Service</th>
                            <th className="text-right py-3 px-4 text-slate-400">Daily Completions</th>
                            <th className="text-right py-3 px-4 text-slate-400">Monthly Completions</th>
                            <th className="text-right py-3 px-4 text-slate-400">Daily Tokens</th>
                            <th className="text-right py-3 px-4 text-slate-400">Monthly Tokens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {FEATURE_CODES.map(featureCode => {
                            const feature = plan.features.find(f => f.featureCode === featureCode)
                            const isEditing = editingPlan === plan.id
                            const quotas = editingQuotas[featureCode] || {}

                            return (
                              <tr key={featureCode} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                <td className="py-3 px-4 font-medium">{SERVICE_LABELS[featureCode] || featureCode}</td>
                                <td className="py-3 px-4 text-right">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      value={quotas.dailyQuota ?? ''}
                                      onChange={e => setEditingQuotas(prev => ({
                                        ...prev,
                                        [featureCode]: { ...prev[featureCode], dailyQuota: e.target.value ? parseInt(e.target.value) : null }
                                      }))}
                                      className="w-24 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-right text-slate-100"
                                      placeholder="∞"
                                    />
                                  ) : (
                                    <span className="font-mono">{feature?.dailyQuota ?? '∞'}</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      value={quotas.monthlyQuota ?? ''}
                                      onChange={e => setEditingQuotas(prev => ({
                                        ...prev,
                                        [featureCode]: { ...prev[featureCode], monthlyQuota: e.target.value ? parseInt(e.target.value) : null }
                                      }))}
                                      className="w-24 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-right text-slate-100"
                                      placeholder="∞"
                                    />
                                  ) : (
                                    <span className="font-mono">{feature?.monthlyQuota ?? '∞'}</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      value={quotas.dailyTokenLimit ?? ''}
                                      onChange={e => setEditingQuotas(prev => ({
                                        ...prev,
                                        [featureCode]: { ...prev[featureCode], dailyTokenLimit: e.target.value ? parseInt(e.target.value) : null }
                                      }))}
                                      className="w-28 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-right text-slate-100"
                                      placeholder="∞"
                                    />
                                  ) : (
                                    <span className="font-mono text-amber-400">{feature?.dailyTokenLimit ? formatNumber(feature.dailyTokenLimit) : '∞'}</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      value={quotas.monthlyTokenLimit ?? ''}
                                      onChange={e => setEditingQuotas(prev => ({
                                        ...prev,
                                        [featureCode]: { ...prev[featureCode], monthlyTokenLimit: e.target.value ? parseInt(e.target.value) : null }
                                      }))}
                                      className="w-28 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-right text-slate-100"
                                      placeholder="∞"
                                    />
                                  ) : (
                                    <span className="font-mono text-amber-400">{feature?.monthlyTokenLimit ? formatNumber(feature.monthlyTokenLimit) : '∞'}</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {editingPlan === plan.id && (
                      <div className="flex justify-end mt-4">
                        <button
                          onClick={handleSaveQuotas}
                          disabled={savingQuota}
                          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium disabled:opacity-50"
                        >
                          {savingQuota ? 'Saving...' : 'Save All Quotas'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Tenants Tab */}
            {activeTab === 'tenants' && (
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h2 className="text-lg font-semibold text-cyan-400 mb-4">🏢 All Tenants Usage (This Month)</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-3 px-4 text-slate-400">Tenant</th>
                        <th className="text-left py-3 px-4 text-slate-400">Plan</th>
                        <th className="text-right py-3 px-4 text-slate-400">Users</th>
                        <th className="text-right py-3 px-4 text-slate-400">Patents</th>
                        <th className="text-right py-3 px-4 text-slate-400">Searches</th>
                        <th className="text-right py-3 px-4 text-slate-400">Diagrams</th>
                        <th className="text-right py-3 px-4 text-slate-400">Total Cost</th>
                        <th className="text-center py-3 px-4 text-slate-400">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTenants.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">No tenants found</td>
                        </tr>
                      ) : (
                        allTenants.map(tenant => {
                          const patents = tenant.monthlyUsage?.find(u => u.serviceType === 'PATENT_DRAFTING')?.completions || 0
                          const searches = tenant.monthlyUsage?.find(u => u.serviceType === 'PRIOR_ART_SEARCH' || u.serviceType === 'NOVELTY_SEARCH')?.completions || 0
                          const diagrams = tenant.monthlyUsage?.find(u => u.serviceType === 'DIAGRAM_GENERATION')?.completions || 0
                          
                          return (
                            <tr key={tenant.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                              <td className="py-3 px-4">
                                <div className="font-medium">{tenant.name}</div>
                                <div className="text-xs text-slate-500 font-mono">{tenant.id}</div>
                              </td>
                              <td className="py-3 px-4">
                                <span className="px-2 py-1 bg-slate-700 rounded text-xs">{tenant.plan}</span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono">{tenant.userCount}</td>
                              <td className="py-3 px-4 text-right font-mono">{patents}</td>
                              <td className="py-3 px-4 text-right font-mono">{searches}</td>
                              <td className="py-3 px-4 text-right font-mono">{diagrams}</td>
                              <td className="py-3 px-4 text-right font-mono text-emerald-400">
                                {formatCurrency(tenant.totalMonthlyCost || 0)}
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className={`px-2 py-1 rounded text-xs ${
                                  tenant.status === 'ACTIVE' 
                                    ? 'bg-emerald-900/50 text-emerald-400' 
                                    : 'bg-red-900/50 text-red-400'
                                }`}>
                                  {tenant.status}
                                </span>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Costs Tab */}
            {activeTab === 'costs' && data && (
              <div className="space-y-6">
                {/* Model Prices */}
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <h2 className="text-lg font-semibold text-cyan-400 mb-4">💵 LLM Model Prices</h2>
                  <p className="text-sm text-slate-400 mb-4">
                    Configure per-million token costs for accurate cost tracking. These prices are used to calculate costs per operation.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-3 px-4 text-slate-400">Provider</th>
                          <th className="text-left py-3 px-4 text-slate-400">Model Class</th>
                          <th className="text-right py-3 px-4 text-slate-400">Input ($/1M tokens)</th>
                          <th className="text-right py-3 px-4 text-slate-400">Output ($/1M tokens)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.modelPrices.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500">
                              No model prices configured. Go to Model Costs page to add pricing.
                            </td>
                          </tr>
                        ) : (
                          data.modelPrices.map(mp => (
                            <tr key={mp.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                              <td className="py-3 px-4 font-mono">{mp.provider}</td>
                              <td className="py-3 px-4 font-mono">{mp.modelClass}</td>
                              <td className="py-3 px-4 text-right font-mono text-amber-400">${mp.inputPricePerMTokens.toFixed(4)}</td>
                              <td className="py-3 px-4 text-right font-mono text-amber-400">${mp.outputPricePerMTokens.toFixed(4)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 text-right">
                    <a
                      href="/super-admin/model-costs"
                      className="text-cyan-400 hover:text-cyan-300 text-sm"
                    >
                      Manage Model Prices →
                    </a>
                  </div>
                </div>

                {/* Cost Per Operation Summary */}
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <h2 className="text-lg font-semibold text-cyan-400 mb-4">📊 Average Cost Per Operation (This Month)</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {data.monthUsage.map(u => (
                      <div key={u.serviceType} className="bg-slate-700/50 rounded-lg p-4">
                        <div className="text-slate-400 text-sm">{SERVICE_LABELS[u.serviceType] || u.serviceType}</div>
                        <div className="text-2xl font-bold text-emerald-400 mt-1">
                          {u.completions > 0 ? formatCurrency(u.costUsd / u.completions) : '-'}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {u.completions} completions · {formatNumber(u.tokens)} tokens
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick Links */}
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <h2 className="text-lg font-semibold text-cyan-400 mb-4">🔗 Quick Links</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <a href="/super-admin/quota-controller" className="bg-slate-700/50 hover:bg-slate-700 rounded-lg p-4 text-center">
                      <div className="text-2xl mb-2">🎚️</div>
                      <div className="text-sm font-medium">Quota Controller</div>
                    </a>
                    <a href="/super-admin/model-costs" className="bg-slate-700/50 hover:bg-slate-700 rounded-lg p-4 text-center">
                      <div className="text-2xl mb-2">💰</div>
                      <div className="text-sm font-medium">Model Costs</div>
                    </a>
                    <a href="/super-admin/analytics" className="bg-slate-700/50 hover:bg-slate-700 rounded-lg p-4 text-center">
                      <div className="text-2xl mb-2">📈</div>
                      <div className="text-sm font-medium">Analytics</div>
                    </a>
                    <a href="/super-admin/user-service-usage" className="bg-slate-700/50 hover:bg-slate-700 rounded-lg p-4 text-center">
                      <div className="text-2xl mb-2">👥</div>
                      <div className="text-sm font-medium">User Usage</div>
                    </a>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
