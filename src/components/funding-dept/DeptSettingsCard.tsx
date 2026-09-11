'use client'

import { useCallback, useEffect, useState } from 'react'

import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'

/**
 * What this institution counts as late.
 *
 * Each control changes what appears on the accountability reports and, for the
 * escalation ones, who gets interrupted — so each says plainly what it does
 * rather than leaving an administrator to infer it from a label. Defaults match
 * the constants these replaced, so a tenant that never opens this screen sees no
 * change at all.
 */

interface Field {
  key: string
  label: string
  help: string
}

export default function DeptSettingsCard() {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [settings, setSettings] = useState<Record<string, any> | null>(null)
  const [toggles, setToggles] = useState<Field[]>([])
  const [numbers, setNumbers] = useState<Field[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const response = await authFetch('/api/tenant-admin/dept-settings')
    if (!response.ok) return
    const payload = await response.json()
    setSettings(payload.settings)
    setToggles(payload.toggles)
    setNumbers(payload.numbers)
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      const response = await authFetch('/api/tenant-admin/dept-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const payload = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: payload.error || 'Could not save that.' })
        return
      }
      // Replaced with what the server actually stored, not with what was typed:
      // the value is clamped on the way in, and showing the unclamped number back
      // would tell an administrator they set something they did not.
      setSettings(payload.settings)
      showToast({ type: 'success', title: 'Saved' })
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <section className="nk-panel">
        <div className="nk-panel-head">
          <h2 className="nk-title">Pendency and chasing</h2>
        </div>
        <p className="nk-sub px-4 py-6">Loading…</p>
      </section>
    )
  }

  return (
    <section className="nk-panel">
      <div className="nk-panel-head">
        <div>
          <h2 className="nk-title">Pendency and chasing</h2>
          <p className="nk-sub">
            When this office considers itself behind, and who hears about it. These drive the
            accountability reports and the automatic chasing — not what the office is allowed to do,
            which is the proposal desk settings above.
          </p>
        </div>
      </div>

      <div className="space-y-1 px-4 py-3">
        {toggles.map((field) => (
          <label
            key={field.key}
            className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-nickel-50"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(settings[field.key])}
              disabled={saving}
              onChange={(event) => void save({ [field.key]: event.target.checked })}
            />
            <span>
              <span className="block text-[13.5px] font-medium text-nickel-900">{field.label}</span>
              <span className="nk-sub block text-[12px]">{field.help}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="grid gap-3 border-t border-nickel-100 px-4 py-4 sm:grid-cols-2">
        {numbers.map((field) => (
          <label key={field.key} className="block">
            <span className="nk-label">{field.label}</span>
            <input
              type="number"
              className="nk-input"
              // Uncontrolled per render key, so typing is not fought by a reload
              // on every keystroke; committed on blur.
              defaultValue={settings[field.key]}
              key={`${field.key}:${settings[field.key]}`}
              disabled={saving}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value) || value === settings[field.key]) return
                void save({ [field.key]: Math.round(value) })
              }}
            />
            <span className="nk-sub mt-1 block text-[11.5px]">{field.help}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
