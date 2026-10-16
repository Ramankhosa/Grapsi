import { useEffect, useState } from 'react'

/**
 * Super-admin editor for a customer tenant's regional settings (currency,
 * time zone, locale, country). Blank means the India default. Writes go to
 * PATCH /api/v1/platform/tenants/[id] (full SUPER_ADMIN only).
 */

interface TenantOption {
  id: string
  name: string
  ati_id: string
  status: string
}

interface Settings {
  stored: { currency: string | null; timezone: string | null; locale: string | null; countryCode: string | null }
  effective: { currency: string; timezone: string; locale: string; countryCode: string }
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token')}` })

export default function TenantRegionalSettingsCard({ tenants }: { tenants: TenantOption[] }) {
  const [tenantId, setTenantId] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState({ currency: '', timezone: '', locale: '', countryCode: '' })
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSettings(null)
    setNotice(null)
    if (!tenantId) return
    let live = true
    fetch(`/api/v1/platform/tenants/${tenantId}`, { headers: authHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Settings | null) => {
        if (!live || !data) return
        setSettings(data)
        setDraft({
          currency: data.stored.currency || '',
          timezone: data.stored.timezone || '',
          locale: data.stored.locale || '',
          countryCode: data.stored.countryCode || '',
        })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [tenantId])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/platform/tenants/${tenantId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: draft.currency.trim() || null,
          timezone: draft.timezone.trim() || null,
          locale: draft.locale.trim() || null,
          countryCode: draft.countryCode.trim() || null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setNotice({ kind: 'error', text: data?.error || data?.message || 'Could not save.' })
        return
      }
      setSettings(data)
      setNotice({ kind: 'ok', text: `Saved. In force: ${data.effective.currency} · ${data.effective.timezone} · ${data.effective.locale} · ${data.effective.countryCode}` })
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof typeof draft, label: string, placeholder: string) => (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-800 mb-1">{label}</span>
      <input
        value={draft[key]}
        onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
        placeholder={placeholder}
        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
      />
    </label>
  )

  return (
    <div className="bg-white shadow rounded-lg mb-8">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Regional Settings</h3>
        <p className="mt-1 text-sm text-gray-500">
          A tenant&apos;s currency, time zone, number format and country. Leave a field blank for the India default. The time
          zone moves deadline days and reporting weeks for that tenant&apos;s funding department.
        </p>
        <div className="mt-5 max-w-md">
          <label htmlFor="regional_tenant" className="block text-sm font-semibold text-gray-800 mb-1">
            Tenant
          </label>
          <select
            id="regional_tenant"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
          >
            <option value="">Select tenant…</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.ati_id})
              </option>
            ))}
          </select>
        </div>
        {settings ? (
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-4 sm:items-end">
            {field('currency', 'Currency', 'INR')}
            {field('timezone', 'Time zone', 'Asia/Kolkata')}
            {field('locale', 'Locale', 'en-IN')}
            {field('countryCode', 'Country', 'IN')}
            <div className="sm:col-span-4 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">
                In force: {settings.effective.currency} · {settings.effective.timezone} · {settings.effective.locale} · {settings.effective.countryCode}
              </span>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : null}
        {notice ? (
          <p role="status" className={`mt-3 text-sm ${notice.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
            {notice.text}
          </p>
        ) : null}
      </div>
    </div>
  )
}
