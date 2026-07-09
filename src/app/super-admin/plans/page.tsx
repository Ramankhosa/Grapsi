'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'

interface PlanFeature {
  featureCode: string
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
  isCustom: boolean
  tenantCount: number
  userCount: number
  features: PlanFeature[]
}
interface CatalogFeature {
  code: string
  name: string
  unit: string
  seeded: boolean
  isModuleFeature: boolean
}
interface ModuleInfo {
  key: string
  name: string
  description: string
  featureCodes: string[]
  minTier: string
}
interface TenantOption {
  id: string
  name: string
}

type EditState = Record<
  string,
  Record<string, { enabled: boolean; dailyQuota: string; monthlyQuota: string }>
>

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token')}` })

export default function PlansAdminPage() {
  noStore()
  const { user } = useAuth()

  const [plans, setPlans] = useState<Plan[]>([])
  const [catalog, setCatalog] = useState<CatalogFeature[]>([])
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [edits, setEdits] = useState<EditState>({})
  const [loading, setLoading] = useState(true)
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showCustom, setShowCustom] = useState(false)

  const canWrite = user?.roles?.includes('SUPER_ADMIN')

  const buildEdits = useCallback((planList: Plan[], cat: CatalogFeature[]): EditState => {
    const next: EditState = {}
    for (const plan of planList) {
      next[plan.id] = {}
      for (const f of cat) {
        const pf = plan.features.find((x) => x.featureCode === f.code)
        next[plan.id][f.code] = {
          enabled: Boolean(pf),
          dailyQuota: pf?.dailyQuota != null ? String(pf.dailyQuota) : '',
          monthlyQuota: pf?.monthlyQuota != null ? String(pf.monthlyQuota) : ''
        }
      }
    }
    return next
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/v1/admin/plans', { headers: authHeader() })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error || 'Failed to load plans')
      }
      const data = await res.json()
      setPlans(data.plans)
      setCatalog(data.featureCatalog)
      setModules(data.modules)
      setEdits(buildEdits(data.plans, data.featureCatalog))
      // Tenants for the custom-plan flow (best-effort; platform scope required)
      fetch('/api/v1/platform/tenants', { headers: authHeader() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return
          const list = (d.tenants || d.data || d || []) as any[]
          setTenants(
            list
              .filter((t) => t && t.id && (t.atiId ?? t.ati_id) !== 'PLATFORM')
              .map((t) => ({ id: t.id, name: t.name || t.id }))
          )
        })
        .catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [buildEdits])

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some((r) => r === 'SUPER_ADMIN' || r === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }
    load()
  }, [user, load])

  const featureName = useMemo(() => {
    const m: Record<string, string> = {}
    catalog.forEach((f) => (m[f.code] = f.name))
    return m
  }, [catalog])

  const moduleFeatureCodes = useMemo(
    () => new Set(modules.flatMap((m) => m.featureCodes)),
    [modules]
  )
  const otherFeatures = useMemo(
    () => catalog.filter((f) => !moduleFeatureCodes.has(f.code)),
    [catalog, moduleFeatureCodes]
  )

  const toggleFeature = (planId: string, code: string) => {
    setEdits((prev) => ({
      ...prev,
      [planId]: {
        ...prev[planId],
        [code]: { ...prev[planId][code], enabled: !prev[planId][code].enabled }
      }
    }))
  }
  const setQuota = (planId: string, code: string, field: 'dailyQuota' | 'monthlyQuota', value: string) => {
    setEdits((prev) => ({
      ...prev,
      [planId]: { ...prev[planId], [code]: { ...prev[planId][code], [field]: value } }
    }))
  }

  const savePlanFeatures = async (plan: Plan) => {
    if (!canWrite) return
    setSavingPlanId(plan.id)
    setError(null)
    setSuccess(null)
    try {
      const planEdits = edits[plan.id] || {}
      const features = Object.entries(planEdits)
        .filter(([, v]) => v.enabled)
        .map(([code, v]) => ({
          featureCode: code,
          dailyQuota: v.dailyQuota === '' ? null : Number(v.dailyQuota),
          monthlyQuota: v.monthlyQuota === '' ? null : Number(v.monthlyQuota),
          dailyTokenLimit: null,
          monthlyTokenLimit: null
        }))
      const res = await fetch(`/api/v1/admin/plans/${plan.id}/features`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ features })
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error || 'Failed to save features')
      }
      setSuccess(`Saved feature access for ${plan.name}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingPlanId(null)
    }
  }

  const updatePlanMeta = async (plan: Plan, patch: { name?: string; status?: string }) => {
    if (!canWrite) return
    try {
      const res = await fetch(`/api/v1/admin/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(patch)
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error || 'Failed to update plan')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const deletePlan = async (plan: Plan) => {
    if (!canWrite) return
    if (!confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/v1/admin/plans/${plan.id}`, { method: 'DELETE', headers: authHeader() })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error || 'Failed to delete plan')
      }
      setSuccess(`Deleted ${plan.name}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  if (loading) {
    return <div className="p-10 text-gray-500">Loading plans…</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Plans &amp; Feature Access</h1>
            <p className="mt-1 text-sm text-gray-600">
              Group product modules into Starter / Pro / Enterprise plans, add or remove features per
              plan, and build custom plans for individual tenants.
            </p>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreate(true)}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                + New plan
              </button>
              <button
                onClick={() => setShowCustom(true)}
                className="rounded-lg border border-gray-900 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
              >
                + Custom plan for tenant
              </button>
            </div>
          )}
        </div>

        {!canWrite && (
          <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
            Read-only mode — SUPER_ADMIN role required to make changes.
          </div>
        )}
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</div>}

        <div className="space-y-6">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">{plan.name}</h2>
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500">
                      {plan.code}
                    </span>
                    {plan.isCustom && (
                      <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">custom</span>
                    )}
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        plan.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {plan.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {plan.tenantCount} tenant(s) · {plan.userCount} user(s) · {plan.cycle}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const name = prompt('Rename plan', plan.name)
                        if (name && name.trim() && name !== plan.name) updatePlanMeta(plan, { name: name.trim() })
                      }}
                      className="text-xs text-gray-600 underline hover:text-gray-900"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() =>
                        updatePlanMeta(plan, { status: plan.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
                      }
                      className="text-xs text-gray-600 underline hover:text-gray-900"
                    >
                      {plan.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                    {plan.isCustom && (
                      <button
                        onClick={() => deletePlan(plan)}
                        className="text-xs text-red-600 underline hover:text-red-800"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Product modules */}
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Product modules
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {modules.map((mod) => (
                    <div key={mod.key} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <div className="mb-1 text-sm font-medium text-gray-800">{mod.name}</div>
                      <div className="mb-2 text-xs text-gray-500">{mod.minTier}+ tier</div>
                      <div className="space-y-1">
                        {mod.featureCodes.map((code) => {
                          const st = edits[plan.id]?.[code]
                          if (!st) return null
                          return (
                            <label key={code} className="flex items-center gap-2 text-xs text-gray-700">
                              <input
                                type="checkbox"
                                disabled={!canWrite}
                                checked={st.enabled}
                                onChange={() => toggleFeature(plan.id, code)}
                              />
                              <span>{featureName[code] || code}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Other features */}
              {otherFeatures.length > 0 && (
                <details className="mb-4">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Other features ({otherFeatures.filter((f) => edits[plan.id]?.[f.code]?.enabled).length}/
                    {otherFeatures.length})
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {otherFeatures.map((f) => {
                      const st = edits[plan.id]?.[f.code]
                      if (!st) return null
                      return (
                        <label key={f.code} className="flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            disabled={!canWrite}
                            checked={st.enabled}
                            onChange={() => toggleFeature(plan.id, f.code)}
                          />
                          <span>{f.name}</span>
                          {!f.seeded && <span className="text-amber-600">(unseeded)</span>}
                        </label>
                      )
                    })}
                  </div>
                </details>
              )}

              {canWrite && (
                <div className="flex justify-end">
                  <button
                    onClick={() => savePlanFeatures(plan)}
                    disabled={savingPlanId === plan.id}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingPlanId === plan.id ? 'Saving…' : 'Save feature access'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {showCreate && (
        <CreatePlanModal
          title="Create plan"
          catalog={catalog}
          modules={modules}
          tenants={tenants}
          withTenant={false}
          onClose={() => setShowCreate(false)}
          onCreated={(msg) => {
            setShowCreate(false)
            setSuccess(msg)
            load()
          }}
          onError={setError}
        />
      )}
      {showCustom && (
        <CreatePlanModal
          title="Custom plan for a tenant"
          catalog={catalog}
          modules={modules}
          tenants={tenants}
          withTenant
          onClose={() => setShowCustom(false)}
          onCreated={(msg) => {
            setShowCustom(false)
            setSuccess(msg)
            load()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function CreatePlanModal({
  title,
  catalog,
  modules,
  tenants,
  withTenant,
  onClose,
  onCreated,
  onError
}: {
  title: string
  catalog: CatalogFeature[]
  modules: ModuleInfo[]
  tenants: TenantOption[]
  withTenant: boolean
  onClose: () => void
  onCreated: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [name, setName] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })

  const submit = async () => {
    if (!name.trim()) {
      onError('Plan name is required')
      return
    }
    if (withTenant && !tenantId) {
      onError('Select a tenant for the custom plan')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/v1/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          name: name.trim(),
          featureCodes: Array.from(selected),
          assignTenantId: withTenant ? tenantId : undefined
        })
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(b.error || 'Failed to create plan')
      let msg = `Created plan "${name.trim()}"`
      if (withTenant) {
        msg += b.assignment?.assigned ? ' and assigned it to the tenant' : ' (tenant assignment failed — assign manually)'
      }
      onCreated(msg)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  const moduleFeatureCodes = new Set(modules.flatMap((m) => m.featureCodes))
  const others = catalog.filter((f) => !moduleFeatureCodes.has(f.code))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>

        <label className="mb-1 block text-sm font-medium text-gray-700">Plan name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme University — Custom"
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        {withTenant && (
          <>
            <label className="mb-1 block text-sm font-medium text-gray-700">Tenant</label>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select a tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="mb-2 text-sm font-medium text-gray-700">Modules &amp; features</div>
        <div className="mb-4 space-y-3">
          {modules.map((mod) => (
            <div key={mod.key} className="rounded-lg border border-gray-100 p-2">
              <div className="mb-1 text-xs font-semibold text-gray-600">{mod.name}</div>
              {mod.featureCodes.map((code) => (
                <label key={code} className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={selected.has(code)} onChange={() => toggle(code)} />
                  <span>{catalog.find((f) => f.code === code)?.name || code}</span>
                </label>
              ))}
            </div>
          ))}
          {others.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-gray-500">Other features</summary>
              <div className="mt-1 space-y-1">
                {others.map((f) => (
                  <label key={f.code} className="flex items-center gap-2 text-xs text-gray-700">
                    <input type="checkbox" checked={selected.has(f.code)} onChange={() => toggle(f.code)} />
                    <span>{f.name}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm text-gray-600">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
