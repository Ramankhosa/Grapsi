'use client'

import { Ban, RotateCcw } from 'lucide-react'
import { useState } from 'react'

type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

/**
 * "Don't visit" for one page or its whole folder. The crawler stops fetching
 * it from the next check; "Visit again" removes the mark.
 */
export default function SkipPageButton({
  authedFetch,
  url,
  skipRuleId,
  onChanged,
  compact = false,
}: {
  authedFetch: AuthedFetch
  url: string
  skipRuleId?: string | null
  onChanged?: (message: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [match, setMatch] = useState<'PAGE' | 'FOLDER'>('PAGE')
  const [days, setDays] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const folder = (() => {
    try {
      const u = new URL(url)
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts.length > 1 || (parts.length === 1 && u.pathname.endsWith('/'))) {
        if (!u.pathname.endsWith('/')) parts.pop()
        return `${u.origin}/${parts.join('/')}/`
      }
      return null
    } catch {
      return null
    }
  })()

  async function restore() {
    setBusy(true)
    setError('')
    try {
      const response = await authedFetch(`/api/funding/monitor/skip-rules?id=${encodeURIComponent(skipRuleId!)}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not remove the mark')
      onChanged?.('The crawler will visit it again from the next check.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the mark')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const response = await authedFetch('/api/funding/monitor/skip-rules', {
        method: 'POST',
        body: JSON.stringify({ url: match === 'FOLDER' && folder ? folder : url, match, days, reason: reason || undefined }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not save')
      setOpen(false)
      onChanged?.(
        match === 'FOLDER'
          ? `Won't visit anything under ${folder}${data.parked ? ` (${data.parked} queued pages stopped)` : ''}.`
          : "Won't visit this page from the next check."
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (skipRuleId) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" className="cb-btn-ghost cb-btn-xs" disabled={busy} onClick={() => void restore()} title="Remove the don't-visit mark">
          <RotateCcw className="h-3 w-3" /> Visit again
        </button>
        {error && <span className="text-[11px] text-red-700">{error}</span>}
      </span>
    )
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className={compact ? 'cb-btn-ghost cb-btn-xs' : 'cb-btn-secondary cb-btn-sm'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Stop the crawler visiting this page"
      >
        <Ban className="h-3 w-3" /> Don&apos;t visit
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 space-y-3 rounded-xl border border-hairline bg-ground p-3 text-left shadow-lg">
          <p className="text-[12px] font-semibold text-ink">Stop visiting</p>
          <div className="space-y-1.5 text-[12.5px] text-ink-soft">
            <label className="flex items-start gap-2">
              <input type="radio" checked={match === 'PAGE'} onChange={() => setMatch('PAGE')} className="mt-0.5" />
              <span>This page only</span>
            </label>
            {folder && (
              <label className="flex items-start gap-2">
                <input type="radio" checked={match === 'FOLDER'} onChange={() => setMatch('FOLDER')} className="mt-0.5" />
                <span>
                  Everything under <span className="break-all font-mono text-[11px]">{new URL(folder).pathname}</span>
                </span>
              </label>
            )}
          </div>
          <div className="flex gap-1">
            {[
              [null, 'Until I undo it'],
              [30, 'For 30 days'],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                className={`cb-chip ${days === value ? 'cb-chip-active' : ''}`}
                onClick={() => setDays(value as number | null)}
              >
                {label}
              </button>
            ))}
          </div>
          <input className="cb-input text-[12.5px]" placeholder="Reason (optional), e.g. news archive" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          {error && <p className="text-[12px] text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="cb-btn-ghost cb-btn-xs" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="cb-btn-primary cb-btn-xs" disabled={busy} onClick={() => void save()}>
              Don&apos;t visit
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
