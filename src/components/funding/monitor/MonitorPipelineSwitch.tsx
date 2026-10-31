'use client'

import { Loader2, Pause, Play, Power } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * The master switch for the Source Watch pipeline, shown in the page header,
 * plus the banner that says so while it is not running. Three positions:
 * running, crawling paused (the queue finishes, no new pages) and stopped.
 * Pausing or stopping asks first; resuming does not, since nothing is lost.
 */

export type PipelineMode = 'RUNNING' | 'CRAWL_PAUSED' | 'STOPPED'

export interface PipelineSwitchState {
  mode: PipelineMode
  reason: string | null
  by: string | null
  at: string | null
  running: number
  waiting: number
  waitingCrawl: number
  waitingScreening: number
  waitingExtraction: number
}

const LOOK: Record<PipelineMode, { label: string; box: string; text: string; dot: string }> = {
  RUNNING: { label: 'Pipeline running', box: 'border-green-200 bg-green-50', text: 'text-green-700', dot: 'animate-pulse bg-green-500' },
  CRAWL_PAUSED: { label: 'Crawling paused', box: 'border-amber-200 bg-amber-50', text: 'text-amber-800', dot: 'bg-amber-500' },
  STOPPED: { label: 'Pipeline stopped', box: 'border-red-200 bg-red-50', text: 'text-red-700', dot: 'bg-red-600' },
}

const n = (value: number) => value.toLocaleString()
const tasks = (value: number) => `${n(value)} task${value === 1 ? '' : 's'}`

function when(at: string | null) {
  if (!at) return ''
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function PipelineSwitchControl({ state, canOperate, onChange }: {
  state: PipelineSwitchState | null
  canOperate: boolean
  onChange: (mode: PipelineMode, reason?: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState<Exclude<PipelineMode, 'RUNNING'> | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!confirming) return
    input.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setConfirming(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, confirming])

  if (!state) return null
  const look = LOOK[state.mode]

  async function apply(mode: PipelineMode) {
    setBusy(true)
    setError(null)
    try {
      await onChange(mode, mode === 'RUNNING' ? undefined : reason)
      setConfirming(null)
      setReason('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the switch')
    } finally {
      setBusy(false)
    }
  }

  const stopping = confirming === 'STOPPED'
  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 rounded-lg border py-1 pl-2.5 pr-1 ${look.box}`}>
        <span className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${look.text}`}>
          <span className={`h-2 w-2 rounded-full ${look.dot}`} aria-hidden />
          {look.label}
        </span>
        {canOperate && (
          <span className="flex gap-1">
            {state.mode !== 'RUNNING' && (
              <button type="button" className="cb-btn-primary cb-btn-sm" onClick={() => void apply('RUNNING')} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {state.mode === 'STOPPED' ? 'Start' : 'Resume crawling'}
              </button>
            )}
            {state.mode === 'RUNNING' && (
              <button type="button" className="cb-btn-secondary cb-btn-sm text-amber-800" onClick={() => setConfirming('CRAWL_PAUSED')}>
                <Pause className="h-3.5 w-3.5" /> Pause crawling
              </button>
            )}
            {state.mode !== 'STOPPED' && (
              <button type="button" className="cb-btn-secondary cb-btn-sm text-red-700" onClick={() => setConfirming('STOPPED')}>
                <Power className="h-3.5 w-3.5" /> Stop all
              </button>
            )}
          </span>
        )}
      </div>
      {error && !confirming && <p className="w-full text-right text-[12px] text-red-700">{error}</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setConfirming(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="pipeline-switch-title" className="cb-card w-full max-w-md space-y-4 p-5" onClick={(event) => event.stopPropagation()}>
            <div>
              <h2 id="pipeline-switch-title" className="text-base font-semibold text-ink">
                {stopping ? 'Stop the whole pipeline?' : 'Pause crawling and finish the queue?'}
              </h2>
              <p className="cb-hint mt-1">Takes effect immediately, for everyone. Nothing is deleted.</p>
            </div>
            <ul className="space-y-1.5 text-[13px] text-nickel-700">
              <li>• No website is crawled for new pages{state.waitingCrawl ? `; ${tasks(state.waitingCrawl)} of crawling wait` : ''}.</li>
              {stopping ? (
                <li>• No screening, extraction or other paid AI call is made; {tasks(state.waiting)} wait.</li>
              ) : (
                <li>• Screening ({n(state.waitingScreening)} waiting) and extraction ({n(state.waitingExtraction)} waiting) carry on until the queue is empty, within the daily AI budgets.</li>
              )}
              <li>• {state.running ? `${tasks(state.running)} running now finish the page in hand.` : 'Nothing is running right now.'}</li>
            </ul>
            <p className="text-[12px] text-nickel-500">Reviewing, drafting and publishing found calls still work.</p>
            <label className="block">
              <span className="cb-label">Reason (optional)</span>
              <input ref={input} className="cb-input mt-1" value={reason} maxLength={300} placeholder={stopping ? 'e.g. checking costs, provider outage' : 'e.g. clear the backlog first'} onChange={(event) => setReason(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void apply(confirming) }} />
            </label>
            {error && <p className="text-[12.5px] text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="cb-btn-secondary cb-btn-sm" onClick={() => setConfirming(null)} disabled={busy}>Cancel</button>
              <button type="button" className={`cb-btn-sm inline-flex items-center gap-1.5 rounded-lg px-3 font-medium text-white disabled:opacity-60 ${stopping ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`} onClick={() => void apply(confirming)} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : stopping ? <Power className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {stopping ? 'Stop pipeline' : 'Pause crawling'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function PipelineStoppedBanner({ state }: { state: PipelineSwitchState | null }) {
  if (!state || state.mode === 'RUNNING') return null
  const stopped = state.mode === 'STOPPED'
  const who = `${stopped ? 'Stopped' : 'Paused'}${state.by ? ` by ${state.by}` : ''}${state.at ? ` on ${when(state.at)}` : ''}${state.reason ? ` — “${state.reason}”` : ''}.`
  return (
    <div role="status" className={`flex items-start gap-3 rounded-lg border p-3.5 text-[13px] ${stopped ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      {stopped ? <Power className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Pause className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div>
        <p className="font-semibold">
          {stopped ? 'Source Watch is stopped. No crawling, screening or extraction is running.' : 'Crawling is paused. No new pages are fetched; the queue is finishing.'}
        </p>
        <p className={`mt-0.5 ${stopped ? 'text-red-700' : 'text-amber-800'}`}>
          {who}{' '}
          {stopped
            ? `${tasks(state.waiting)} will resume when it is started again${state.running ? `; ${n(state.running)} still finishing` : ''}.`
            : `Still to finish: ${n(state.waitingScreening)} screening, ${n(state.waitingExtraction)} extraction. ${tasks(state.waitingCrawl)} of crawling wait for Resume.`}
        </p>
      </div>
    </div>
  )
}
