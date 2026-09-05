'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * How this institution runs its proposal desk.
 *
 * Every toggle turns a whole stage of the process on or off, so each one says
 * plainly what happens when it is off rather than leaving an administrator to
 * guess from the label. Defaults are all on: a tenant that never opens this
 * screen gets the full process.
 */

interface Toggle {
  key: string
  label: string
  help: string
}

interface Settings {
  [key: string]: any
  cutoffOffsetDays: number
  reviewSlaDays: number
  agencyStaleDays: number
  budgetHeads: string[]
}

export default function ProposalSettingsCard() {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [settings, setSettings] = useState<Settings | null>(null)
  const [toggles, setToggles] = useState<Toggle[]>([])
  const [headOptions, setHeadOptions] = useState<Array<{ key: string; label: string }>>([])
  const [defaultTemplate, setDefaultTemplate] = useState<string[]>([])
  // The template is edited as text, so a draft in progress is not fighting a
  // reload of the saved value on every keystroke.
  const [templateDraft, setTemplateDraft] = useState('')
  const [templateDirty, setTemplateDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authFetch('/api/tenant-admin/proposal-settings')
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not load the proposal settings.')
      setSettings(data.settings)
      setToggles(data.toggles || [])
      setHeadOptions(data.budgetHeadOptions || [])
      setDefaultTemplate(data.defaultChecklistTemplate || [])
      setTemplateDraft((data.settings?.checklistTemplate || []).join('\n'))
      setTemplateDirty(false)
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load the proposal settings.')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load])

  async function save(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      const response = await authFetch('/api/tenant-admin/proposal-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not save.')
      setSettings(data.settings)
      if ('checklistTemplate' in patch) {
        setTemplateDraft((data.settings?.checklistTemplate || []).join('\n'))
        setTemplateDirty(false)
      }
      showToast({ type: 'success', title: 'Saved' })
    } catch (saveError: any) {
      showToast({ type: 'error', title: 'Could not save', description: saveError?.message })
      // Put the screen back in step with the server rather than leaving a
      // switch showing a state that was refused.
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="nk-panel p-5">
        <p className="nk-sub text-sm">Loading proposal settings…</p>
      </div>
    )
  }

  if (error || !settings) {
    return (
      <div className="nk-panel border-rose-200 bg-rose-50 p-5">
        <p className="text-sm text-rose-700">{error}</p>
        <button type="button" className="nk-btn-secondary nk-btn-sm mt-3" onClick={() => void load()}>
          Try again
        </button>
      </div>
    )
  }

  function saveTemplate(lines: string[]) {
    void save({ checklistTemplate: lines.map((line) => line.trim()).filter(Boolean).slice(0, 40) })
  }

  function toggleHead(head: string) {
    const current: string[] = settings!.budgetHeads || []
    const next = current.includes(head)
      ? current.filter((value) => value !== head)
      : [...current, head]
    // At least one head, or the budget grid would have no rows at all — the
    // toggle above is how you turn budgets off.
    if (next.length === 0) {
      showToast({ type: 'error', title: 'Keep at least one head, or switch budgets off above' })
      return
    }
    void save({ budgetHeads: next })
  }

  return (
    <div className="nk-panel p-5">
      <header className="mb-4">
        <h2 className="nk-title text-base">Proposal desk</h2>
        <p className="nk-sub mt-1 text-sm">
          Which parts of the proposal process your office runs. Everything is on by default; what you
          switch off disappears from the screens rather than sitting there unused.
        </p>
      </header>

      <ul className="divide-y divide-hairline">
        {toggles.map((toggle) => (
          <li key={toggle.key} className="flex items-start gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-nickel-900">{toggle.label}</p>
              <p className="nk-hint mt-0.5 text-xs">{toggle.help}</p>
            </div>
            <label className="flex shrink-0 items-center gap-2 pt-0.5">
              <input
                type="checkbox"
                checked={Boolean(settings[toggle.key])}
                disabled={saving}
                onChange={(event) => void save({ [toggle.key]: event.target.checked })}
              />
              <span className="nk-hint text-xs">{settings[toggle.key] ? 'On' : 'Off'}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-5 grid gap-4 border-t border-hairline pt-5 sm:grid-cols-3">
        <div>
          <label className="nk-label" htmlFor="cutoff-offset">
            Cut-off, days before the deadline
          </label>
          <input
            id="cutoff-offset"
            type="number"
            min={0}
            max={90}
            className="nk-input mt-1 w-full"
            defaultValue={settings.cutoffOffsetDays}
            disabled={saving || !settings.cutoffEnabled}
            onBlur={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value) && value !== settings.cutoffOffsetDays) {
                void save({ cutoffOffsetDays: value })
              }
            }}
          />
          <p className="nk-hint mt-1 text-xs">Applied to new proposals as they are opened.</p>
        </div>
        <div>
          <label className="nk-label" htmlFor="sla-days">
            Warn us after a draft waits
          </label>
          <input
            id="sla-days"
            type="number"
            min={1}
            max={60}
            className="nk-input mt-1 w-full"
            defaultValue={settings.reviewSlaDays}
            disabled={saving}
            onBlur={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value) && value !== settings.reviewSlaDays) {
                void save({ reviewSlaDays: value })
              }
            }}
          />
          <p className="nk-hint mt-1 text-xs">Days unreviewed or unsent before the office is told.</p>
        </div>
        <div>
          <label className="nk-label" htmlFor="stale-days">
            Chase the agency after
          </label>
          <input
            id="stale-days"
            type="number"
            min={7}
            max={730}
            className="nk-input mt-1 w-full"
            defaultValue={settings.agencyStaleDays}
            disabled={saving || !settings.agencyTrackingEnabled}
            onBlur={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value) && value !== settings.agencyStaleDays) {
                void save({ agencyStaleDays: value })
              }
            }}
          />
          <p className="nk-hint mt-1 text-xs">Days of silence after submission before a prompt.</p>
        </div>
      </div>

      {settings.budgetEnabled && (
        <div className="mt-5 border-t border-hairline pt-5">
          <p className="nk-label mb-1">Heads of expenditure</p>
          <p className="nk-hint mb-3 text-xs">
            The rows of the budget grid your researchers fill in.
          </p>
          <div className="flex flex-wrap gap-2">
            {headOptions.map((option) => {
              const on = (settings.budgetHeads || []).includes(option.key)
              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={saving}
                  onClick={() => toggleHead(option.key)}
                  className={on ? 'nk-btn-primary nk-btn-xs' : 'nk-btn-secondary nk-btn-xs'}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {settings.checklistEnabled && (
        <div className="mt-5 border-t border-hairline pt-5">
          <p className="nk-label mb-1">Checklist a new proposal starts with</p>
          <p className="nk-hint mb-3 text-xs">
            One attachment per line. Officers can add or waive lines on any individual proposal, and
            changing this list never touches proposals already open.
          </p>
          <textarea
            className="nk-input w-full font-mono text-xs"
            rows={8}
            value={templateDraft}
            disabled={saving}
            onChange={(event) => {
              setTemplateDraft(event.target.value)
              setTemplateDirty(true)
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="nk-btn-primary nk-btn-sm"
              disabled={saving || !templateDirty}
              onClick={() => saveTemplate(templateDraft.split('\n'))}
            >
              Save the checklist
            </button>
            {templateDirty && (
              <button
                type="button"
                className="nk-btn-ghost nk-btn-sm"
                disabled={saving}
                onClick={() => {
                  setTemplateDraft((settings.checklistTemplate || []).join('\n'))
                  setTemplateDirty(false)
                }}
              >
                Discard
              </button>
            )}
            {defaultTemplate.length > 0 && (
              <button
                type="button"
                className="nk-btn-ghost nk-btn-sm"
                disabled={saving}
                onClick={() => {
                  setTemplateDraft(defaultTemplate.join('\n'))
                  setTemplateDirty(true)
                }}
              >
                Use the standard list
              </button>
            )}
            <span className="nk-hint text-xs">
              {templateDraft.split('\n').filter((line) => line.trim()).length} lines
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
