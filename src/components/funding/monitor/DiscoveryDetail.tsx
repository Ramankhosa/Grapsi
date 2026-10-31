'use client'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { DuplicateCheck } from '@/lib/monitor/reviewDuplicates'
import type { ReviewSummary } from '@/lib/monitor/reviewList'

import SkipPageButton from './SkipPageButton'
type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

interface Detail {
  id: string; title: string | null; review_revision: number; evidence_manifest_version: number
  review_state: string; processing_state: string; lifecycle: string; triage_reason: string | null; triage_confidence: number | null
  triage_verdict: string | null; match_type: string | null; stale_evidence: boolean; created_at: string; site: { host: string }
  primary_resource: { title: string | null; canonical_url: string | null; last_validation_status: string | null; call_score?: number | null; call_band?: string | null; call_signals?: string[] } | null
  funding_call: { id: string; title: string; revision: number; catalog_status: string | null } | null
  conflicts: Array<string | { id: string; title: string }> | null
  duplicates: DuplicateCheck
  local_analysis?: { decision: string; assessedOn: string; details: { candidates: Array<{ title: string; titleQuote: string; invitationQuote: string | null; opensOn?: string | null; opensQuote?: string | null; closesOn?: string | null; closesQuote?: string | null }>; multipleCalls: boolean; needsMoreEvidence: boolean } } | null
  field_evidence: { quality?: { state: string; reasons: string[] }; warnings?: string[]; payload?: { fields?: Record<string, { value: unknown; status: string; evidence: Array<{ quote: string }> }> }; conflicts?: string[] } | null
}
const CALL_BANDS: Record<string, { label: string; tone: string }> = {
  LIKELY: { label: 'Likely call', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  POSSIBLE: { label: 'Possible call', tone: 'border-sky-200 bg-sky-50 text-sky-800' },
  WEAK: { label: 'Weak signals', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  UNLIKELY: { label: 'Unlikely', tone: 'border-gray-200 bg-gray-50 text-gray-600' },
}
const VERDICTS: Record<string, string> = { NEW_OPPORTUNITY: 'A new funding call', UPDATE_TO_EXISTING: 'An update to a known call', UNSURE: 'Unsure', NOT_FUNDING: 'Not funding', NEEDS_EVIDENCE: 'Needs more evidence' }
const callHref = (id: string) => `/funding/calls/${id}`
const value = (v: unknown) => v === null || v === undefined || v === '' ? null : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')
// A scanned-page request only means something for a PDF or a page the pipeline could not read.
const scannable = (d: Detail) => /\.pdf(\?|$)/i.test(d.primary_resource?.canonical_url ?? '') || /scanned|ocr|unreadable/i.test(d.triage_reason ?? '')

export default function DiscoveryDetail({ id, summary, authedFetch, canOperate, canPublish, onOpen, onChanged }: { id: string; summary: ReviewSummary; authedFetch: AuthedFetch; canOperate: boolean; canPublish: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const [row, setRow] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [ocrPages, setOcrPages] = useState('')
  const load = useCallback(async () => {
    try {
      const response = await authedFetch(`/api/funding/monitor/discoveries/${id}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not load this discovery')
      setRow(data.discovery)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this discovery') }
  }, [authedFetch, id])
  useEffect(() => { void load() }, [load])

  async function act(action: string, label?: 'RELEVANT' | 'IRRELEVANT' | 'UNSURE') {
    if (!row) return
    if (action === 'draft' && row.duplicates.catalogue.length && !window.confirm(`This may already be in the catalogue:\n\n${row.duplicates.catalogue.map(t => `• ${t.title} (${t.reason.toLowerCase()})`).join('\n')}\n\nDraft it anyway?`)) return
    setBusy(true); setNotice(''); setError('')
    try {
      const pages = ocrPages.split(',').map(s => s.trim()).filter(Boolean).map(Number)
      const response = await authedFetch(`/api/funding/monitor/discoveries/${row.id}`, { method: 'PATCH', body: JSON.stringify({ action, reviewRevision: row.review_revision, callRevision: row.funding_call?.revision, evidenceManifestVersion: row.evidence_manifest_version, selectedFields: selected, label, reason: reason || undefined, ...(pages.length ? { ocrPages: pages } : {}) }) })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error(data.message ?? data.reason ?? 'The action could not be completed')
      setNotice(['extract', 'draft', 'revalidate'].includes(action) ? 'Queued. It runs in the background; refresh in a minute to see the result.' : action === 'label' ? 'Thanks, the feedback is recorded.' : 'Saved.')
      if (['reject', 'snooze', 'publish'].includes(action)) onChanged()
      else { await load(); onChanged() }
    } catch (e) { setError(e instanceof Error ? e.message : 'The action failed') }
    finally { setBusy(false) }
  }

  if (!row) return <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 text-sm text-gray-500">{error ? <span role="alert" className="text-red-700">{error}</span> : <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading the evidence…</>}</div>

  const fields = row.field_evidence?.payload?.fields ?? {}
  const facts: Array<[string, string | null]> = [
    ['Funder', value(fields.agency_name?.value) ?? summary.facts.funder],
    ['Deadline', value(fields.close_date?.value) ?? (summary.facts.rolling ? 'Rolling' : null)],
    ['Opens', value(fields.open_date?.value)],
    ['Award', summary.facts.award],
    ['Who can apply', value(fields.career_stages?.value) ?? value(fields.institution_types?.value)],
    ['Countries', value(fields.eligible_countries?.value)],
    ['Status', row.lifecycle !== 'UNKNOWN' ? sentence(row.lifecycle) : null],
    ['Screening', row.triage_verdict ? `${VERDICTS[row.triage_verdict] ?? sentence(row.triage_verdict)}${row.triage_confidence !== null ? ` · ${Math.round(row.triage_confidence * 100)}% sure` : ''}` : null],
  ]
  const stored = (row.conflicts ?? []).filter((c): c is { id: string; title: string } => typeof c === 'object' && c !== null)
  const catalogue = [...row.duplicates.catalogue, ...stored.filter(s => !row.duplicates.catalogue.some(t => t.id === s.id)).map(s => ({ id: s.id, title: s.title, status: '', origin: '' as const, reason: 'Matched when screened' as const }))]
  const draftBlock = summary.draftBlock

  return <div className="space-y-4 border-t border-gray-100 bg-gray-50/60 px-4 py-4 text-sm">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {row.primary_resource?.canonical_url && <a className="inline-flex items-center gap-1 font-medium text-cobalt-700 underline" href={row.primary_resource.canonical_url} target="_blank" rel="noreferrer">Official page <ExternalLink className="h-3.5 w-3.5" /></a>}
      {row.funding_call && <a className="inline-flex items-center gap-1 font-medium text-cobalt-700 underline" href={callHref(row.funding_call.id)} target="_blank" rel="noreferrer">Catalogue draft ({sentence(row.funding_call.catalog_status ?? 'DRAFT')}) <ExternalLink className="h-3.5 w-3.5" /></a>}
      {canOperate && row.primary_resource?.canonical_url && <SkipPageButton compact authedFetch={authedFetch} url={row.primary_resource.canonical_url} onChanged={message => setNotice(message)} />}
      <span className="text-gray-500">Found {row.created_at.slice(0, 10)} on {row.site.host}</span>
    </div>

    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
      {facts.map(([label, text]) => <div key={label}><dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</dt><dd className={text ? 'text-gray-900' : 'text-gray-400'}>{text ?? 'Not found'}</dd></div>)}
    </dl>

    <section aria-label="Duplicate check" className={`rounded-lg border p-3 ${catalogue.length || row.duplicates.discoveries.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
      {catalogue.length || row.duplicates.discoveries.length ? <>
        <p className="flex items-center gap-1.5 font-medium text-amber-900"><AlertTriangle className="h-4 w-4" />Check for a duplicate before drafting</p>
        {catalogue.length > 0 && <ul className="mt-2 space-y-1">{catalogue.map(t => <li key={t.id}><a className="text-cobalt-700 underline" href={callHref(t.id)} target="_blank" rel="noreferrer">{t.title}</a> <span className="text-gray-600">· {t.reason.toLowerCase()}{t.origin ? ` · ${t.origin.toLowerCase()} catalogue` : ''}{t.status ? ` · ${t.status.toLowerCase()}` : ''}</span></li>)}</ul>}
        {row.duplicates.discoveries.length > 0 && <div className="mt-2"><p className="text-gray-700">Also found here:</p><ul className="space-y-1">{row.duplicates.discoveries.map(t => <li key={t.id}><button className="text-left text-cobalt-700 underline" onClick={() => { onOpen(t.id); document.getElementById(`discovery-${t.id}`)?.scrollIntoView({ block: 'nearest' }) }}>{t.title}</button> <span className="text-gray-600">· {t.host} · {t.reason.toLowerCase()}</span></li>)}</ul></div>}
        {row.match_type && ['AMBIGUOUS', 'UPDATE_OF'].includes(row.match_type) && <p className="mt-2 text-gray-700">{row.match_type === 'UPDATE_OF' ? 'The pipeline matched this to a catalogue call: choose which verified changes to apply below.' : 'The pipeline holds this back from drafting until a person decides whether it is the same call.'}</p>}
      </> : <p className="flex items-center gap-1.5 text-emerald-900"><CheckCircle2 className="h-4 w-4" />No matching call in the catalogue or among the other discoveries, checked just now.</p>}
    </section>

    <section className="space-y-1.5">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Why it is here</h4>
      {row.triage_reason && <p>{row.triage_reason}</p>}
      {row.primary_resource?.title && row.primary_resource.title !== summary.title && <p className="text-gray-600">Page heading: {row.primary_resource.title}</p>}
      {row.primary_resource?.call_band && (() => { const band = CALL_BANDS[row.primary_resource!.call_band!] ?? CALL_BANDS.UNLIKELY; return <p className="flex flex-wrap items-center gap-2"><span title="Keyword reading of the page text; it does not decide anything" className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${band.tone}`}>Call score {row.primary_resource!.call_score ?? 0} · {band.label}</span>{!!row.primary_resource!.call_signals?.length && <span className="cb-hint">{row.primary_resource!.call_signals!.join(' · ')}</span>}</p> })()}
      {row.local_analysis && <details><summary className="cursor-pointer text-gray-700">Laptop suggestion · {row.local_analysis.decision.toLowerCase()} · {row.local_analysis.assessedOn}</summary><div className="mt-2 space-y-2 rounded border bg-white p-3">{row.local_analysis.details.candidates.map((c, i) => <div key={i}><strong>{c.title}</strong><blockquote className="ml-3 border-l-2 pl-2 text-gray-600">{c.titleQuote}</blockquote>{c.invitationQuote && <p>{c.invitationQuote}</p>}{c.opensOn && <p>Opens {c.opensOn} · “{c.opensQuote}”</p>}{c.closesOn && <p>Deadline {c.closesOn} · “{c.closesQuote}”</p>}</div>)}{row.local_analysis.details.multipleCalls && <p>This page lists several calls; each official call link is analysed separately.</p>}{row.local_analysis.details.needsMoreEvidence && <p>Further evidence is needed; this suggestion does not establish an open call.</p>}</div></details>}
    </section>

    {(row.field_evidence?.quality || row.stale_evidence) && <section className="space-y-1.5">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Evidence</h4>
      {row.field_evidence?.quality && <p>{row.field_evidence.quality.state === 'READY' ? 'Complete: identity, invitation and application window are quoted from the source.' : `${sentence(row.field_evidence.quality.state)}: ${row.field_evidence.quality.reasons.join('; ') || 'some details are missing'}`}</p>}
      {row.stale_evidence && <p className="text-amber-800">The source changed after extraction. Check the evidence again before drafting.</p>}
      {!!row.field_evidence?.conflicts?.length && <p className="text-amber-800">{row.field_evidence.conflicts.join('; ')}</p>}
      {!!row.field_evidence?.warnings?.length && <details><summary className="cursor-pointer text-gray-700">Fields the checker set aside ({row.field_evidence.warnings.length})</summary><p className="mt-1 text-gray-600">{row.field_evidence.warnings.join('; ')}</p></details>}
      {Object.keys(fields).length > 0 && <details><summary className="cursor-pointer font-medium">All extracted details with source quotes</summary><div className="mt-2 space-y-2">{Object.entries(fields).filter(([, f]) => f.value !== null || row.match_type === 'UPDATE_OF').map(([key, field]) => <div key={key} className="border-t pt-2">
        <label className="flex items-start gap-2">{row.match_type === 'UPDATE_OF' && field.status === 'supported' && <input type="checkbox" checked={selected.includes(key)} onChange={e => setSelected(old => e.target.checked ? [...old, key] : old.filter(k => k !== key))} />}<span><strong>{key.replace(/_/g, ' ')}:</strong> {value(field.value) ?? 'Not stated in verified evidence'}</span></label>
        {field.evidence.map((e, i) => <blockquote key={i} className="ml-4 border-l-2 pl-3 text-gray-600">{e.quote}</blockquote>)}
      </div>)}</div></details>}
    </section>}

    {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status" className="text-green-700">{notice}</p>}
    {(canOperate || canPublish) && <div className="space-y-2 border-t border-gray-200 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {canPublish && !row.funding_call && row.review_state !== 'PUBLISHED' && <button disabled={busy || Boolean(draftBlock)} title={draftBlock ?? (summary.quality ? 'Create a catalogue draft from the verified details' : 'Extract the details, then create a catalogue draft if they are complete')} className="cb-btn-primary cb-btn-sm" onClick={() => void act('draft')}>{summary.quality ? 'Draft it' : 'Extract and draft'}</button>}
        {canPublish && row.funding_call && row.match_type !== 'UPDATE_OF' && row.funding_call.catalog_status !== 'PUBLISHED' && <button disabled={busy} className="cb-btn-primary cb-btn-sm" onClick={() => void act('publish')}>Publish</button>}
        {canPublish && row.match_type === 'UPDATE_OF' && <button disabled={busy || !selected.length} className="cb-btn-primary cb-btn-sm" onClick={() => void act('accept_update')}>Apply {selected.length || ''} selected change{selected.length === 1 ? '' : 's'}</button>}
        {canOperate && <button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act('extract')}>{summary.quality ? 'Extract again' : 'Extract details'}</button>}
        {canOperate && row.review_state !== 'SNOOZED' && <button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act('snooze')}>Snooze 7 days</button>}
        {canOperate && row.review_state !== 'REJECTED' && <span className="flex items-center gap-1"><input aria-label="Reason for rejection" className="cb-input h-8 w-56 text-sm" placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} /><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act('reject')}>Reject</button></span>}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>
      {draftBlock && canPublish && !row.funding_call && <p className="text-[12px] text-gray-600">Drafting is not possible yet: {draftBlock.charAt(0).toLowerCase() + draftBlock.slice(1)}.</p>}
      {canOperate && <details className="text-[13px]"><summary className="cursor-pointer text-gray-600">More actions</summary><div className="mt-2 flex flex-wrap items-center gap-2">
        <button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act('revalidate')}>Check the source again</button>
        {scannable(row) && <input className="cb-input h-8 w-64 text-sm" aria-label="Scanned PDF pages" placeholder="Scanned PDF pages to read, e.g. 3,4 (max two)" value={ocrPages} onChange={e => setOcrPages(e.target.value)} />}
        <span className="ml-2 text-gray-600">Teach the screening:</span>
        <button disabled={busy} className="cb-btn-secondary cb-btn-xs" onClick={() => void act('label', 'RELEVANT')}>It is funding</button>
        <button disabled={busy} className="cb-btn-secondary cb-btn-xs" onClick={() => void act('label', 'IRRELEVANT')}>Not funding</button>
        <button disabled={busy} className="cb-btn-secondary cb-btn-xs" onClick={() => void act('label', 'UNSURE')}>Unsure</button>
      </div><p className="mt-1 text-gray-500">Feedback is used to measure screening; it does not move this item. Use Reject to take it off the list.</p></details>}
    </div>}
  </div>
}
