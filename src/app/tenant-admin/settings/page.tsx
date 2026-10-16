'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth, useRoleAccess } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { formatDate, formatMoney, timeZoneLabel } from '@/lib/i18n/format'

/**
 * Regional settings: the organization's currency, time zone, locale and
 * country. Unset values fall back to India (INR, Asia/Kolkata, en-IN), so a
 * tenant that never opens this page behaves exactly as before.
 */

interface LocaleSettings {
  stored: { currency: string | null; timezone: string | null; locale: string | null; countryCode: string | null }
  effective: { currency: string; timezone: string; locale: string; countryCode: string }
  options: { suggestedTimezones: string[]; timezones: string[]; locales: string[]; countryCodes: string[] }
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'ZAR', 'KES', 'JPY', 'CHF', 'SEK', 'BRL']

export default function TenantRegionalSettingsPage() {
  const { authFetch, isLoading } = useAuth()
  const { isTenantAdmin, isSuperAdmin } = useRoleAccess()
  const { showToast } = useToast()
  const allowed = isTenantAdmin || isSuperAdmin
  const [settings, setSettings] = useState<LocaleSettings | null>(null)
  const [draft, setDraft] = useState({ currency: '', timezone: '', locale: '', countryCode: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const response = await authFetch('/api/tenant-admin/locale-settings')
    if (!response.ok) {
      setError('Could not load regional settings.')
      return
    }
    const data = (await response.json()) as LocaleSettings
    setSettings(data)
    setDraft({
      currency: data.stored.currency || '',
      timezone: data.stored.timezone || '',
      locale: data.stored.locale || '',
      countryCode: data.stored.countryCode || '',
    })
  }, [authFetch])

  useEffect(() => {
    if (!isLoading && allowed) void load()
  }, [isLoading, allowed, load])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await authFetch('/api/tenant-admin/locale-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: draft.currency || null,
          timezone: draft.timezone || null,
          locale: draft.locale || null,
          countryCode: draft.countryCode || null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error || 'Could not save regional settings.')
        return
      }
      setSettings(data as LocaleSettings)
      showToast({ type: 'success', title: 'Regional settings saved.' })
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <p className="nk-sub">Loading…</p>
        </div>
      </main>
    )
  }

  if (!allowed) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Access denied</h1>
          <p className="nk-sub mt-2">Only organization owners and admins can change regional settings.</p>
        </div>
      </main>
    )
  }

  const preview = {
    timezone: draft.timezone || settings?.effective.timezone || 'Asia/Kolkata',
    locale: draft.locale || 'en-IN',
    currency: draft.currency || 'INR',
  }
  const timezones = settings
    ? Array.from(new Set([...settings.options.suggestedTimezones, ...settings.options.timezones]))
    : []

  return (
    <main className="nk-ground nk-wash">
      <div className="relative mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Organization admin</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">Regional settings</h1>
          <p className="nk-sub mt-1.5 max-w-2xl">
            How amounts, dates and deadline days are shown and counted for your organization. Leave a field on its
            default to keep India settings.
          </p>
        </header>

        {error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        <form onSubmit={save} className="nk-panel space-y-5 p-5">
          <label className="block">
            <span className="text-sm font-medium text-nickel-800">Time zone</span>
            <select
              className="nk-select mt-1.5 w-full"
              value={draft.timezone}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
            >
              <option value="">Default (Asia/Kolkata)</option>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <span className="nk-sub mt-1 block text-xs">
              A deadline stays open until the end of its day in this zone, and reporting weeks run Monday to Sunday here.
              Changing it moves those boundaries for every report.
            </span>
          </label>

          <div className="grid gap-5 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-nickel-800">Currency</span>
              <select
                className="nk-select mt-1.5 w-full"
                value={draft.currency}
                onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
              >
                <option value="">Default (INR)</option>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-nickel-800">Number and date format</span>
              <select
                className="nk-select mt-1.5 w-full"
                value={draft.locale}
                onChange={(event) => setDraft({ ...draft, locale: event.target.value })}
              >
                <option value="">Default (en-IN)</option>
                {(settings?.options.locales || []).map((locale) => (
                  <option key={locale} value={locale}>
                    {locale}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-nickel-800">Country</span>
              <select
                className="nk-select mt-1.5 w-full"
                value={draft.countryCode}
                onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })}
              >
                <option value="">Default (IN)</option>
                {(settings?.options.countryCodes || []).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-md border border-nickel-200 bg-nickel-50 px-3 py-2.5 text-sm text-nickel-700">
            <span className="font-medium">Preview:</span> {formatMoney(1234567, preview.currency, { locale: preview.locale })} ·{' '}
            {formatDate(new Date(), { timeZone: preview.timezone, locale: preview.locale })} · {timeZoneLabel(preview.timezone)}
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving || !settings} className="nk-btn-primary">
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
