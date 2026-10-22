import Head from 'next/head'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import { useAuth } from '@/lib/auth-context'

const endpoint = '/api/admin/funding/ai-review'
const label = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
async function api(body?: any, params = '') {
  const response = await fetch(endpoint + params, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Review request failed')
  return data
}
const button = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40'
const input = 'w-full rounded border border-slate-300 p-2 text-sm'
export default function AiImportReview() {
  const { user, isLoading } = useAuth()
  const allowed = user?.roles?.includes('SUPER_ADMIN')
  const [filter, setFilter] = useState<Record<string, any>>({})
  const [preview, setPreview] = useState<any>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [allMatching, setAllMatching] = useState(true)
  const [limit, setLimit] = useState(100)
  const [batches, setBatches] = useState<any[]>([])
  const [batchId, setBatchId] = useState('')
  const [detail, setDetail] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [decision, setDecision] = useState('')
  const [confidenceAbove, setConfidenceAbove] = useState('90')
  const confidenceParam = confidenceAbove === '' ? '' : `&confidenceAbove=${Number(confidenceAbove) / 100}`
  const [status, setStatus] = useState('')
  const [approvals, setApprovals] = useState<string[]>([])
  const [bulk, setBulk] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [configured, setConfigured] = useState(false)
  const [models, setModels] = useState<any[]>([])
  const [model, setModel] = useState('gpt-5.4-mini')
  const inFlight = useRef(false)
  const load = useCallback(async () => {
    const data = await api(undefined, batchId ? `?batchId=${encodeURIComponent(batchId)}&page=${page}&decision=${decision}&status=${status}${confidenceParam}` : '')
    setBatches(data.batches || [])
    if (batchId) setDetail(data)
    else { setConfigured(data.configured); setModels(data.models || []) }
  }, [batchId, page, decision, status, confidenceParam])
  useEffect(() => { if (allowed) load().catch(e => setMessage(e.message)) }, [allowed, load])
  // Only one request per tab. The database lease also guards other tabs/workers.
  useEffect(() => {
    if (!running || !batchId) return
    let stopped = false
    const timer = setInterval(async () => {
      if (inFlight.current || stopped) return
      inFlight.current = true
      try {
        await api({ action: 'step', batchId })
        const data = await api(undefined, `?batchId=${encodeURIComponent(batchId)}&page=${page}&decision=${decision}&status=${status}${confidenceParam}`)
        if (!stopped) { setDetail(data); if (!['QUEUED', 'RUNNING'].includes(data.batch.status)) setRunning(false) }
      } catch (e: any) { setMessage(e.message); setRunning(false) }
      finally { inFlight.current = false }
    }, 1500)
    return () => { stopped = true; clearInterval(timer) }
  }, [running, batchId, page, decision, status, confidenceParam])
  async function act(action: string, ids?: string[]) {
    setBusy(true); setMessage('')
    try {
      const data = await api({ action, batchId, ids })
      if (action === 'pause' || action === 'cancel') setRunning(false)
      if (action === 'resume' || action === 'retry') setRunning(true)
      if (data.outcomes) { setMessage(`${data.outcomes.filter((o: any) => o.applied).length} approved. ${data.outcomes.filter((o: any) => !o.applied).map((o: any) => o.reason).join('; ')}`); setApprovals([]) }
      await load()
    } catch (e: any) { setMessage(e.message) } finally { setBusy(false) }
  }
  async function previewBulk(scope?: string) {
    setBusy(true); setBulk(null)
    try { setBulk({ ...await api({ action: 'approval-preview', batchId: scope, confidenceAbove: confidenceAbove === '' ? undefined : Number(confidenceAbove) / 100 }), scope, confidenceAbove: confidenceAbove === '' ? undefined : Number(confidenceAbove) / 100 }) }
    catch (e: any) { setMessage(e.message) } finally { setBusy(false) }
  }
  async function approveBulk() {
    const frozen = bulk; setBulk(null); setBusy(true)
    let approved = 0, skipped = 0
    const reasons = new Set<string>()
    try {
      for (let n = 0; n < frozen.items.length; n += 10) {
        const current = n === 0 ? frozen : await api({ action: 'approval-preview', batchId: frozen.scope, confidenceAbove: frozen.confidenceAbove })
        const chunk = frozen.items.slice(n, n + 10)
        const ids = chunk.filter((i: any) => current.items.some((c: any) => c.id === i.id)).map((i: any) => i.id)
        skipped += chunk.length - ids.length
        if (ids.length) {
          const data = await api({ action: 'approve-confirmed', batchId: frozen.scope, expectedHash: current.hash, confidenceAbove: frozen.confidenceAbove, ids })
          for (const o of data.outcomes) { if (o.applied) approved++; else { skipped++; reasons.add(o.reason) } }
        }
        setMessage(`${approved} approved; ${skipped} skipped. Processing ${Math.min(n + 10, frozen.items.length)} of ${frozen.items.length}. Keep this page open.`)
      }
      setMessage(`${approved} approved; ${skipped} skipped. ${[...reasons].join('; ')} Publication remains separate.`)
    } catch (e: any) { setMessage(`${approved} approved so far. ${e.message} Preview again to continue.`) }
    finally { setBusy(false); await load() }
  }
  async function start() {
    setBusy(true); setMessage('')
    try {
      const ids = allMatching ? undefined : selected
      if (!allMatching && !ids?.length) throw new Error('Select review items first')
      const p = await api({ action: 'preview', filter, ids, model })
      if (p.selectionHash !== preview?.selectionHash && allMatching) { setPreview(p); throw new Error('Selection changed. Check the updated preview and start again.') }
      const data = await api({ action: 'start', filter, ids, expectedHash: p.selectionHash, limit, model })
      setBatchId(data.batch.id); setPage(1); setRunning(true); setPreview(null)
    } catch (e: any) { setMessage(e.message) } finally { setBusy(false) }
  }
  async function previewPage(nextPage: number, reset = false) {
    setBusy(true); setMessage('')
    try { setPreview(await api({ action: 'preview', filter, page: nextPage, model })); if (reset) { setSelected([]); setAllMatching(true) } }
    catch (e: any) { setMessage(e.message) } finally { setBusy(false) }
  }
  function change(key: string, value: any) { setFilter(f => ({ ...f, [key]: value === '' ? undefined : value })); setPreview(null); setSelected([]) }
  if (isLoading) return <p className="p-8">Loading…</p>
  if (!allowed) return <p className="p-8">Superadmin access is required.</p>
  return <><Head><title>AI Import Review | Grapsi</title></Head><Header />
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div><Link href="/super-admin/funding" className="text-sm text-blue-700">Funding administration</Link><h1 className="mt-2 text-2xl font-semibold">AI Import Review</h1>
        <p className="mt-2 text-slate-600">Review conflicts using stored imported text. AI saves recommendations; it does not publish, merge, delete, notify, or change intake calls.</p></div>
      <p role="status" className="text-sm text-amber-800">{message}</p>
      <section className="space-y-4 rounded-xl border bg-slate-50 p-5">
        <h2 className="text-lg font-semibold">Choose pending conflicts</h2>
        <fieldset className="rounded-lg border bg-white p-4"><legend className="px-1 font-medium">Review model</legend>
          <p className="mb-3 text-sm text-slate-600">Available models are checked against your OpenAI account. Choose a model before previewing cost. Existing batches retain their original model.</p>
          <div className="grid gap-3 sm:grid-cols-2">{models.map(m => <label key={m.id} className={`cursor-pointer rounded-lg border p-3 ${model === m.id ? 'border-blue-600 bg-blue-50' : ''} ${!m.available ? 'opacity-50' : ''}`}>
            <input type="radio" name="review-model" value={m.id} checked={model === m.id} disabled={!m.available || busy} onChange={() => { setModel(m.id); setPreview(null) }} /> <strong>{m.name}</strong>{m.id === 'gpt-5.4-mini' ? ' · Recommended' : ''}
            <span className="mt-1 block text-sm">{m.description}</span><span className="block text-xs text-slate-600">{m.provider} · ${m.inputRate.toFixed(2)} input / ${m.outputRate.toFixed(2)} output per million tokens · {m.available ? 'Available' : 'Unavailable'}</span>
          </label>)}</div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          {[['q', 'Title or keyword'], ['agency', 'Funder'], ['subject', 'Subject category'], ['runId', 'Import batch ID']].map(([key, label]) => <label key={key} className="text-sm">{label}<input className={input} value={filter[key] || ''} onChange={e => change(key, e.target.value)} /></label>)}
          <label className="text-sm">Review reason<select className={input} value={filter.reason || ''} onChange={e => change('reason', e.target.value)}><option value="">All reasons</option>{['POSSIBLE_DUPLICATE', 'READINESS_FAILED', 'SOURCE_CONFLICT', 'FUNDER_MATCH_UNCERTAIN'].map(r => <option key={r} value={r}>{label(r)}</option>)}</select></label>
          <label className="text-sm">Call status<select className={input} value={filter.lifecycle || ''} onChange={e => change('lifecycle', e.target.value)}><option value="">All statuses</option>{['OPEN', 'ROLLING', 'FORTHCOMING', 'CLOSED', 'UNKNOWN'].map(r => <option key={r} value={r}>{label(r)}</option>)}</select></label>
          <label className="text-sm">Duplicate score at least<input type="number" min="0" max="1" step="0.05" className={input} value={filter.minScore ?? ''} onChange={e => change('minScore', e.target.value === '' ? undefined : Number(e.target.value))} /></label>
          <label className="text-sm">Duplicate score at most<input type="number" min="0" max="1" step="0.05" className={input} value={filter.maxScore ?? ''} onChange={e => change('maxScore', e.target.value === '' ? undefined : Number(e.target.value))} /></label>
          <label className="text-sm">Previous AI result<select className={input} value={filter.aiDecision || ''} onChange={e => change('aiDecision', e.target.value)}><option value="">Any result</option>{['UNREVIEWED', 'SAME_OPPORTUNITY', 'SEPARATE_OPPORTUNITIES', 'NEEDS_INFORMATION', 'UNCERTAIN'].map(r => <option key={r} value={r}>{label(r)}</option>)}</select></label>
          <label className="text-sm">Conflict strength<select className={input} value={filter.tier || ''} onChange={e => change('tier', e.target.value)}><option value="">All strengths</option>{['LIKELY_DUPLICATE', 'POSSIBLE_DUPLICATE', 'RELATED', 'INFO'].map(r => <option key={r} value={r}>{label(r)}</option>)}</select></label>
          <label className="text-sm">Maximum items in this batch<input type="number" min="1" max="10000" className={input} value={limit} onChange={e => setLimit(Number(e.target.value))} /></label>
        </div>
        <button className={button} disabled={busy} onClick={() => previewPage(1, true)}>Preview matching conflicts</button>
        {preview && <div className="space-y-3">
          <p>{preview.reviewItems.toLocaleString()} review items involving {preview.uniqueCalls.toLocaleString()} calls. Model: {preview.model}.</p>
          <p className="text-sm">Estimated first-pass budget: ${preview.estimatedCostUsd.toFixed(2)} for all matches before the batch limit, allowing for reasoning and output tokens; retries may cost up to three times this estimate. This is not a spending ceiling. Actual usage is saved with each result. No website visits. <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer" className="underline">Provider pricing</a> (estimate dated 21 October 2026).</p>
          <label className="block text-sm"><input type="checkbox" checked={allMatching} onChange={e => setAllMatching(e.target.checked)} /> Select all matching results across pages</label>
          <p className="text-sm text-slate-600">100 matches per page. Clear “all matching” to choose individual items across pages. The batch limit applies in a stable order.</p>
          <button className={button} disabled={busy} onClick={() => { setAllMatching(false); setSelected(s => [...new Set([...s, ...preview.items.map((r: any) => r.id)])]) }}>Select this page</button>
          <div className="max-h-72 overflow-auto rounded border bg-white">{preview.items.map((r: any) => <label key={r.id} className="flex gap-3 border-b p-3 text-sm"><input type="checkbox" disabled={allMatching} checked={allMatching || selected.includes(r.id)} onChange={e => setSelected(s => e.target.checked ? [...s, r.id] : s.filter(id => id !== r.id))} /><span>{r.subject?.title || 'Missing title'}<span className="block text-slate-500">{label(r.reason)} · {r.subject?.agency} {r.candidate ? `↔ ${r.candidate.title}` : ''}</span></span></label>)}</div>
          <div className="flex gap-3"><button className={button} disabled={busy || preview.page <= 1} onClick={() => previewPage(preview.page - 1)}>Previous matches</button><span>Page {preview.page}</span><button className={button} disabled={busy || preview.page * 100 >= preview.reviewItems} onClick={() => previewPage(preview.page + 1)}>Next matches</button></div>
          <button className={button} disabled={busy || !configured || !models.some(m => m.id === model && m.available) || !preview.reviewItems} onClick={start}>Start AI review ({Math.min(limit, allMatching ? preview.reviewItems : selected.length)} items)</button>
          {!configured && <p className="text-sm text-amber-800">AI provider configuration is required before starting.</p>}
        </div>}
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Saved review batches</h2>
        <label className="block text-sm">AI confidence above (%)<input aria-label="AI confidence above percent" type="number" min="0" max="100" step="1" className={input} value={confidenceAbove} disabled={busy} onChange={e => { setConfidenceAbove(e.target.value); setPage(1); setApprovals([]); setBulk(null) }} /><span>Applies to saved results and collective approvals across all pages. Leave blank for all confidence scores. A score is the AI's estimate, not measured accuracy.</span></label>
        <button className={button} disabled={busy || running || (confidenceAbove !== '' && (Number(confidenceAbove) < 0 || Number(confidenceAbove) > 100))} onClick={() => previewBulk()}>Approve all completed batches</button>
        {bulk && <div role="dialog" aria-label="Confirm collective approval" className="space-y-3 rounded border border-amber-400 bg-amber-50 p-4">
          <h3 className="font-semibold">Confirm {bulk.scope ? 'entire batch' : 'all completed batches'} (all pages)</h3>
          <p>Confidence: {bulk.confidenceAbove === undefined ? 'all scores' : `strictly above ${bulk.confidenceAbove * 100}%`}.</p>
          <p>{bulk.separate} separate-call decisions: keep both calls. {bulk.same} same-call decisions: archive the imported subject copy and link its sources to the other call.</p>
          <p>I have reviewed and accept these predictions. Archived records retain their data. Intake calls and attached work are protected. Changed, failed, uncertain and resolved items are skipped. Other blockers remain. No publication or factual edits. Safety checks may reduce these counts.</p>
          <button className={button} disabled={busy || !bulk.items.length} onClick={approveBulk}>Confirm and approve {bulk.items.length} recommendations</button>{' '}
          <button className={button} disabled={busy} onClick={() => setBulk(null)}>Cancel</button>
        </div>}
        <select aria-label="Saved batch" className={input} value={batchId} onChange={e => { setBatchId(e.target.value); setPage(1); setApprovals([]); setRunning(false) }}><option value="">Select a batch</option>{batches.map(b => <option key={b.id} value={b.id}>{new Date(b.created_at).toLocaleString()} · {label(b.status)} · {b._count.items} items</option>)}</select>
        {detail?.batch?.id === batchId && <>
          <button className={button} disabled={busy || running || detail.batch.status !== 'COMPLETE'} onClick={() => previewBulk(batchId)}>Approve entire batch (all pages)</button>
          <p>{label(detail.batch.status)} · Model: {detail.batch.model} · {detail.counts.map((c: any) => `${label(c.status)}: ${c._count._all}`).join(' · ')}</p>
          <p className="text-sm text-slate-600">Pause and cancel stop new requests; a request already running may finish. Keep this page open to process, or configure the persistent worker. Saved progress survives closing the page.</p>
          <div className="flex flex-wrap gap-2">{['pause', 'resume', 'retry', 'cancel'].map(action => <button key={action} className={button} disabled={busy || detail.batch.status === 'CANCELLED'} onClick={() => act(action)}>{({ pause: 'Pause', resume: 'Resume processing', retry: 'Retry failed items', cancel: 'Cancel remaining' })[action]}</button>)}</div>
          <div className="flex gap-3"><select aria-label="Result decision" className={input} value={decision} onChange={e => { setDecision(e.target.value); setPage(1); setApprovals([]) }}><option value="">All decisions</option>{['SAME_OPPORTUNITY', 'SEPARATE_OPPORTUNITIES', 'NEEDS_INFORMATION', 'UNCERTAIN'].map(d => <option key={d} value={d}>{label(d)}</option>)}</select><select aria-label="Processing status" className={input} value={status} onChange={e => { setStatus(e.target.value); setPage(1); setApprovals([]) }}><option value="">All processing states</option>{['DONE', 'FAILED', 'QUEUED', 'RUNNING'].map(d => <option key={d} value={d}>{label(d)}</option>)}</select></div>
          <button className={button} disabled={busy || !approvals.length} onClick={() => act('approve', approvals)}>Approve selected distinct-opportunity recommendations ({approvals.length})</button>
          <p className="text-sm text-slate-600">Approval clears only the selected duplicate conflict. Other blockers remain, and publication is separate. Merges and factual corrections require individual review.</p>
          {detail.items.map((item: any) => <article key={item.id} className="space-y-3 rounded-xl border p-4">
            <div className="flex gap-3"><input aria-label={`Approve ${item.snapshot.subject?.title}`} type="checkbox" disabled={!item.approvable} checked={approvals.includes(item.id)} onChange={e => setApprovals(s => e.target.checked ? [...s, item.id] : s.filter(id => id !== item.id))} /><h3 className="font-medium">{item.snapshot.subject?.title} {item.snapshot.candidate ? `↔ ${item.snapshot.candidate.title}` : ''}</h3></div>
            <p className="text-sm">{label(item.status)}{item.approved_at ? ' · Approved' : ''} · Attempts: {item.attempts}</p>
            {item.error && <p className="text-sm text-red-700">{item.error}</p>}
            {item.result && <><p className="font-medium">{label(item.result.decision)} · {Math.round(item.result.confidence * 100)}% confidence</p><p>{item.result.explanation}</p><p className="text-sm">{item.result.conflicts.map(label).join(' · ')}</p>{item.result.evidence.map((e: any, i: number) => <blockquote key={i} className="border-l-2 pl-3 text-sm text-slate-600">{e.side} / {e.field}: “{e.quote}”</blockquote>)}{item.result.suggestedFacts.map((f: any, i: number) => <p key={i} className="text-sm">Suggested {f.field}: {f.value} — supported by “{f.evidence}” (not applied)</p>)}</>}
            <details><summary className="cursor-pointer text-sm">Stored comparison text and usage</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ snapshot: item.snapshot, usage: item.usage }, null, 2)}</pre></details>
            <Link className="text-sm text-blue-700" href={`/admin/funding/import-review?reviewId=${encodeURIComponent(item.candidate_id)}`}>Open individual conflict resolution</Link>
          </article>)}
          <div className="flex items-center gap-3"><button className={button} disabled={page <= 1} onClick={() => { setPage(p => p - 1); setApprovals([]) }}>Previous</button><span>Page {page} · {detail.total} results</span><button className={button} disabled={page * 25 >= detail.total} onClick={() => { setPage(p => p + 1); setApprovals([]) }}>Next</button></div>
        </>}
      </section>
    </main></>
}

