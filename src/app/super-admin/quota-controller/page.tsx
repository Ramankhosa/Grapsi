'use client'

import { useEffect, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'

type FeatureCode =
  | 'PRIOR_ART_SEARCH'
  | 'PATENT_DRAFTING'
  | 'IDEA_BANK'
  | 'DIAGRAM_GENERATION'
  | 'PERSONA_SYNC'
  | 'PATENT_REVIEW'
  | 'IDEATION'
  | 'FUNDING_DISCOVERY'
  | 'GRANT_PREP'
  | 'GRANT_DRAFTING'
type PlanCode = 'FREE_PLAN' | 'PRO_PLAN' | 'ENTERPRISE_PLAN'

interface FeatureQuota {
  featureCode: FeatureCode
  dailyQuota: number
  monthlyQuota: number
  dailyTokenLimit?: number | null
  monthlyTokenLimit?: number | null
}

interface PlanQuota {
  id: string
  code: PlanCode
  name: string
  tenantCount: number
  userCount: number
  features: FeatureQuota[]
}

interface ApiResponse {
  plans: PlanQuota[]
}

const FEATURE_LABELS: Record<FeatureCode, string> = {
  PRIOR_ART_SEARCH: 'Novelty searches',
  PATENT_DRAFTING: 'Patent drafts',
  IDEA_BANK: 'Ideas reserved',
  DIAGRAM_GENERATION: 'Diagrams generated',
  PERSONA_SYNC: 'Style trainings',
  PATENT_REVIEW: 'Patent reviews',
  IDEATION: 'Ideation sessions',
  FUNDING_DISCOVERY: 'Funding discovery runs',
  GRANT_PREP: 'Grant prep sessions',
  GRANT_DRAFTING: 'Grant drafting sessions',
}

export default function QuotaControllerPage() {
  // Prevent static generation
  noStore()

  const { user, logout } = useAuth()

  const [plans, setPlans] = useState<PlanQuota[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }
    fetchQuotas()
  }, [user])

  const fetchQuotas = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/v1/admin/plan-quotas', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load plan quotas')
      }

      const data: ApiResponse = await response.json()
      setPlans(data.plans)
    } catch (err) {
      console.error('Failed to load plan quotas:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const updateQuotaValue = (
    planCode: PlanCode,
    featureCode: FeatureCode,
    field: 'dailyQuota' | 'monthlyQuota',
    value: string,
  ) => {
    const numeric = value === '' ? 0 : Number(value)
    if (Number.isNaN(numeric) || numeric < 0) {
      return
    }

    setPlans((prev) =>
      prev.map((plan) => {
        if (plan.code !== planCode) return plan
        return {
          ...plan,
          features: plan.features.map((fq) =>
            fq.featureCode === featureCode
              ? { ...fq, [field]: numeric }
              : fq,
          ),
        }
      }),
    )
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const updates: Array<{
        planCode: PlanCode
        featureCode: FeatureCode
        dailyQuota: number
        monthlyQuota: number
      }> = []

      for (const plan of plans) {
        for (const feature of plan.features) {
          updates.push({
            planCode: plan.code,
            featureCode: feature.featureCode,
            dailyQuota: feature.dailyQuota,
            monthlyQuota: feature.monthlyQuota,
          })
        }
      }

      const response = await fetch('/api/v1/admin/plan-quotas', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ updates }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to save quotas')
      }

      setSuccess('Quotas updated successfully.')
      await fetchQuotas()
    } catch (err) {
      console.error('Failed to save plan quotas:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Quota Controller</h1>
            <p className="text-gray-600 mt-1">
              Configure plan-wise limits for patent drafts, novelty searches, and idea reservations.
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
        <div className="bg-white p-6 rounded-lg shadow border">
          <h2 className="text-lg font-semibold mb-2">How quotas work</h2>
          <p className="text-sm text-gray-600 mb-2">
            Quotas are enforced at the plan level via the metering system. All tenants on a plan share the same limits.
          </p>
          <p className="text-sm text-gray-600">
            - <strong>Patent drafts</strong> map to the <code>PATENT_DRAFTING</code> feature.<br />
            - <strong>Novelty searches</strong> map to the <code>PRIOR_ART_SEARCH</code> feature (novelty stages and reports).<br />
            - <strong>Ideas reserved</strong> map to the <code>IDEA_BANK</code> feature.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="bg-white p-6 rounded-lg shadow border"
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-semibold">
                      {plan.name}{' '}
                      <span className="text-xs font-mono text-gray-500">
                        ({plan.code})
                      </span>
                    </h3>
                    <p className="text-sm text-gray-500">
                      {plan.tenantCount} tenant{plan.tenantCount === 1 ? '' : 's'} ·{' '}
                      {plan.userCount} user{plan.userCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="px-4 py-2 text-left">Service</th>
                        <th className="px-4 py-2 text-right">Monthly limit</th>
                        <th className="px-4 py-2 text-right">Daily limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.features.map((f) => (
                        <tr key={f.featureCode} className="border-b">
                          <td className="px-4 py-2">
                            <div className="font-medium">
                              {FEATURE_LABELS[f.featureCode]}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                              {f.featureCode}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              value={f.monthlyQuota}
                              onChange={(e) =>
                                updateQuotaValue(
                                  plan.code,
                                  f.featureCode,
                                  'monthlyQuota',
                                  e.target.value,
                                )
                              }
                              className="w-32 px-2 py-1 border border-gray-300 rounded text-right"
                            />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              value={f.dailyQuota}
                              onChange={(e) =>
                                updateQuotaValue(
                                  plan.code,
                                  f.featureCode,
                                  'dailyQuota',
                                  e.target.value,
                                )
                              }
                              className="w-32 px-2 py-1 border border-gray-300 rounded text-right"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save quotas'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
