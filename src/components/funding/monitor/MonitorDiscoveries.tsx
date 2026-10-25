'use client'
import { useCallback, useEffect, useState } from 'react'
type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>
interface Discovery {
  id: string; title: string | null; review_revision: number; evidence_manifest_version: number
  review_state: string; processing_state: string; lifecycle: string; triage_reason: string | null; triage_confidence: number | null
  match_type: string | null; stale_evidence: boolean; site: { host: string }
  primary_resource: { title:string|null; canonical_url: string | null; last_validation_status: string | null } | null
  funding_call: { id: string; title:string; revision: number; catalog_status: string | null } | null
  conflicts: Array<string|{id:string;title:string}>
  local_analysis?: { decision: string; assessedOn: string; details: { candidates: Array<{title:string;titleQuote:string;invitationQuote:string|null}>; multipleCalls:boolean;needsMoreEvidence:boolean } } | null
  field_evidence: { quality?: {state:string;reasons:string[]}; warnings?:string[]; payload?: { fields?: Record<string, { value: unknown; status: string; evidence: Array<{ quote: string }> }> }; conflicts?: string[] } | null
}
export default function MonitorDiscoveries({ authedFetch, canOperate, canPublish }: { authedFetch: AuthedFetch; canOperate: boolean; canPublish: boolean }) {
  const [rows, setRows] = useState<Discovery[]>([])
  const [lane, setLane] = useState('PENDING')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [cursor, setCursor] = useState<string | null>(null)
  const [ocrPages, setOcrPages] = useState<Record<string, string>>({})
  const load = useCallback(async (after?: string) => {
    setError('')
    try {
      const response = await authedFetch(`/api/funding/monitor/discoveries?lane=${lane}${after ? `&cursor=${encodeURIComponent(after)}` : ''}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not load discoveries')
      setRows(old => after ? [...old, ...data.discoveries] : data.discoveries)
      setCursor(data.next)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load discoveries') }
  }, [authedFetch, lane])
  useEffect(() => { void load() }, [load])
  async function act(row: Discovery, action: string, label?: 'RELEVANT' | 'IRRELEVANT' | 'UNSURE') {
    setBusy(true); setNotice(''); setError('')
    try {
      const pages = (ocrPages[row.id] ?? '').split(',').map(s => s.trim()).filter(Boolean).map(Number)
      const response = await authedFetch(`/api/funding/monitor/discoveries/${row.id}`, { method: 'PATCH', body: JSON.stringify({ action, reviewRevision: row.review_revision, callRevision: row.funding_call?.revision, evidenceManifestVersion: row.evidence_manifest_version, selectedFields: selected[row.id] ?? [], label, reason: reasons[row.id], ...(pages.length ? { ocrPages: pages } : {}) }) })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error(data.message ?? data.reason ?? 'The action could not be completed')
      setNotice(['extract', 'draft', 'revalidate'].includes(action) ? 'Queued. Refresh shortly to see the result.' : 'Saved.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'The action failed') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4">
    <p className="cb-hint">New announcements and source changes appear here. Review the quoted evidence before publishing. Drafts are never published automatically.</p>
    <div className="flex flex-wrap gap-2">{[['PENDING', 'To review'], ['WAITING_LOCAL', 'Waiting for laptop'], ['NEEDS_EVIDENCE', 'Needs evidence'], ['UPDATE_PROPOSED', 'Updates'], ['PUBLISHED', 'Published'], ['REJECTED', 'Rejected'], ['SNOOZED', 'Snoozed'], ['AUDIT', 'Screened out'], ['ALL', 'All']].map(([value, label]) => <button key={value} className={`cb-chip ${lane === value ? 'cb-chip-active' : ''}`} onClick={() => setLane(value)}>{label}</button>)}<button className="cb-btn-secondary cb-btn-sm" onClick={() => void load()}>Refresh</button></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {!rows.length && <p className="cb-hint">No discoveries in this view yet. Check Health to see whether sources are being checked.</p>}
    {rows.map(row => <article key={row.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex justify-between gap-3"><h3 className="font-semibold">{row.title ?? 'Announcement awaiting details'}</h3><span className="cb-badge">{row.lifecycle.toLowerCase().replace(/_/g, ' ')}</span></div>
      <p className="cb-hint">{row.site.host} · {row.processing_state.toLowerCase().replace(/_/g, ' ')}{row.triage_confidence !== null ? ` · ${Math.round(row.triage_confidence * 100)}% screening confidence` : ''}</p>
      {row.primary_resource?.canonical_url && <a className="text-sm text-blue-700 underline" href={row.primary_resource.canonical_url} target="_blank" rel="noreferrer">Official source</a>}
      <p className="text-sm">{row.triage_reason}</p>
      {row.primary_resource?.title&&<p className="text-sm">Page heading: {row.primary_resource.title}</p>}
      {row.funding_call&&<p className="text-sm">Catalogue title: {row.funding_call.title}</p>}
      {row.conflicts?.some(c=>typeof c==='object')&&<div className="text-sm"><p>Possible catalogue matches · {row.match_type?.toLowerCase().replace(/_/g,' ')}</p>{row.conflicts.filter((c):c is {id:string;title:string}=>typeof c==='object').map(c=><a className="block underline" key={c.id} href={`/admin/funding/catalog/${c.id}`}>{c.title}</a>)}<p>Similar titles require identity and round review.</p></div>}
      {row.local_analysis && <div className="rounded border bg-slate-50 p-3 text-sm space-y-2"><p>Local suggestion · {row.local_analysis.decision} · assessed {row.local_analysis.assessedOn}</p>{row.local_analysis.details.candidates.map((candidate,i)=><div key={i}><strong>Proposed call title: {candidate.title}</strong><blockquote className="ml-3 border-l-2 pl-2">{candidate.titleQuote}</blockquote>{candidate.invitationQuote&&<p>{candidate.invitationQuote}</p>}</div>)}{row.local_analysis.details.multipleCalls&&<p>This page lists several calls. Follow each official call link.</p>}{row.local_analysis.details.needsMoreEvidence&&<p>Further evidence is needed; this suggestion does not establish an open call.</p>}</div>}
      {row.field_evidence?.quality && <p className="text-sm">Evidence quality: {row.field_evidence.quality.state.toLowerCase()} · {row.field_evidence.quality.reasons.join('; ')}</p>}
      {!!row.field_evidence?.warnings?.length&&<details className="text-sm"><summary>Fields needing further evidence</summary>{row.field_evidence.warnings.join('; ')}</details>}
      {row.funding_call && <a className="text-sm text-blue-700 underline" href={`/admin/funding/catalog/${row.funding_call.id}`}>Review or edit the catalog draft</a>}
      {canOperate && <input className="rounded border px-2 text-sm" aria-label="Scanned PDF pages" placeholder="Scanned PDF pages (optional, e.g. 3,4; maximum two)" value={ocrPages[row.id] ?? ''} onChange={e => setOcrPages(old => ({ ...old, [row.id]: e.target.value }))} />}
      {Boolean(row.stale_evidence || row.field_evidence?.conflicts?.length) && <p className="text-sm text-amber-800">{row.stale_evidence ? 'Source evidence changed. Check it again before publishing.' : row.field_evidence?.conflicts?.join('; ')}</p>}
      {row.field_evidence?.payload?.fields && <details><summary className="cursor-pointer text-sm font-medium">Extracted details and source quotes</summary><div className="mt-3 space-y-3">{Object.entries(row.field_evidence.payload.fields).map(([key, field]) => <div key={key} className="border-t pt-2 text-sm">
        <label className="flex items-start gap-2">{row.match_type === 'UPDATE_OF' && field.status === 'supported' && <input type="checkbox" checked={(selected[row.id] ?? []).includes(key)} onChange={e => setSelected(old => ({ ...old, [row.id]: e.target.checked ? [...(old[row.id] ?? []), key] : (old[row.id] ?? []).filter(k => k !== key) }))} />}<span><strong>{key.replace(/_/g, ' ')}:</strong> {field.value === null ? 'Not stated in verified evidence' : Array.isArray(field.value) ? field.value.join(', ') : String(field.value)}</span></label>
        {field.evidence.map((e, i) => <blockquote key={i} className="ml-4 border-l-2 pl-3 text-gray-600">{e.quote}</blockquote>)}
      </div>)}</div></details>}
      {(canOperate || canPublish) && <div className="flex flex-wrap gap-2">
        {canOperate && <><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act(row, 'extract')}>Extract details</button><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act(row, 'revalidate')}>Check evidence again</button><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act(row, 'snooze')}>Snooze 7 days</button></>}
        {canPublish && !row.funding_call && <button disabled={busy} className="cb-btn-primary cb-btn-sm" onClick={() => void act(row, 'draft')}>Draft it</button>}
        {canPublish && row.funding_call && row.match_type !== 'UPDATE_OF' && row.funding_call.catalog_status !== 'PUBLISHED' && <button disabled={busy} className="cb-btn-primary cb-btn-sm" onClick={() => void act(row, 'publish')}>Publish</button>}
        {canPublish && row.match_type === 'UPDATE_OF' && <button disabled={busy || !(selected[row.id]?.length)} className="cb-btn-primary cb-btn-sm" onClick={() => void act(row, 'accept_update')}>Accept selected updates</button>}
        {canOperate && <><input aria-label="Reason for rejection" className="rounded border px-2 text-sm" placeholder="Reason for rejection" value={reasons[row.id] ?? ''} onChange={e => setReasons(old => ({ ...old, [row.id]: e.target.value }))} /><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act(row, 'reject')}>Reject</button></>}
      </div>}
      {canOperate && <div className="flex flex-wrap items-center gap-2 text-sm"><span>Screening feedback:</span><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act(row, 'label', 'RELEVANT')}>Funding opportunity</button><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act(row, 'label', 'IRRELEVANT')}>Not funding</button><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act(row, 'label', 'UNSURE')}>Unsure</button></div>}
    </article>)}
    {cursor && <button className="cb-btn-secondary" onClick={() => void load(cursor)}>Load more</button>}
  </section>
}
