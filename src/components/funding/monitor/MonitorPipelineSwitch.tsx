'use client'

import { Loader2, Play, Power } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * The master switch for the whole Source Watch pipeline, shown in the page
 * header, plus the banner that says so while it is off. Stopping asks first;
 * starting does not, since nothing is lost either way.
 */

export interface PipelineSwitchState {
  paused: boolean
  reason: string | null
  by: string | null
  at: string | null
  running: number
  waiting: number
}

function when(at: string | null) {
  if (!at) return ''
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function PipelineSwitchControl({ state, canOperate, onChange }: {
  state: PipelineSwitchState | null
  canOperate: boolean
  onChange: (paused: boolean, reason?: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!confirming) return
    input.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setConfirming(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, confirming])

  if (!state) return null

  async function apply(paused: boolean) {
    setBusy(true)
    setError(null)
    try {
      await onChange(paused, paused ? reason : undefined)
      setConfirming(false)
      setReason('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the switch')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={`flex items-center gap-2 rounded-lg border py-1 pl-2.5 pr-1 ${state.paused ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
        <span className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${state.paused ? 'text-red-700' : 'text-green-700'}`}>
          <span className={`h-2 w-2 rounded-full ${state.paused ? 'bg-red-600' : 'animate-pulse bg-green-500'}`} aria-hidden />
          {state.paused ? 'Pipeline stopped' : 'Pipeline running'}
        </span>
        {canOperate && (state.paused ? (
          <button type="button" className="cb-btn-primary cb-btn-sm" onClick={() => void apply(false)} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start
          </button>
        ) : (
          <button type="button" className="cb-btn-secondary cb-btn-sm text-red-700" onClick={() => setConfirming(true)}>
            <Power className="h-3.5 w-3.5" /> Stop all
          </button>
        ))}
      </div>
      {error && !confirming && <p className="w-full text-right text-[12px] text-red-700">{error}</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setConfirming(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="stop-pipeline-title" className="cb-card w-full max-w-md space-y-4 p-5" onClick={(event) => event.stopPropagation()}>
            <div>
              <h2 id="stop-pipeline-title" className="text-base font-semibold text-ink">Stop the whole pipeline?</h2>
              <p className="cb-hint mt-1">Takes effect immediately, for everyone. Nothing is deleted.</p>
            </div>
            <ul className="space-y-1.5 text-[13px] text-nickel-700">
              <li>• No website is crawled and no scheduled check is queued.</li>
              <li>• No screening, extraction or other paid AI call is made.</li>
              <li>• {state.running ? `${state.running} task${state.running === 1 ? '' : 's'} running now finish${state.running === 1 ? 'es' : ''} the page in hand.` : 'Nothing is running right now.'}</li>
              <li>• {state.waiting.toLocaleString()} waiting task{state.waiting === 1 ? '' : 's'} stay queued and resume when you start it again.</li>
            </ul>
            <p className="text-[12px] text-nickel-500">Reviewing, drafting and publishing found calls still work.</p>
            <label className="block">
              <span className="cb-label">Reason (optional)</span>
              <input ref={input} className="cb-input mt-1" value={reason} maxLength={300} placeholder="e.g. checking costs, provider outage" onChange={(event) => setReason(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void apply(true) }} />
            </label>
            {error && <p className="text-[12.5px] text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="cb-btn-secondary cb-btn-sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              <button type="button" className="cb-btn-sm inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 font-medium text-white hover:bg-red-700 disabled:opacity-60" onClick={() => void apply(true)} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />} Stop pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function PipelineStoppedBanner({ state }: { state: PipelineSwitchState | null }) {
  if (!state?.paused) return null
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5 text-[13px] text-red-800">
      <Power className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">Source Watch is stopped. No crawling, screening or extraction is running.</p>
        <p className="mt-0.5 text-red-700">
          Stopped{state.by ? ` by ${state.by}` : ''}{state.at ? ` on ${when(state.at)}` : ''}{state.reason ? ` — “${state.reason}”` : ''}.
          {' '}{state.waiting.toLocaleString()} task{state.waiting === 1 ? '' : 's'} will resume when it is started again{state.running ? `; ${state.running} still finishing` : ''}.
        </p>
      </div>
    </div>
  )
}
