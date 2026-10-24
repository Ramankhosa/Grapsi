'use client'
import { useCallback, useEffect, useState } from 'react'
interface Site { id: string; host: string; status: string; origin: string; related_hosts: string[]; attachment_hosts: string[]; sources: unknown[]; frontier: Array<{ id: string; url: string }>; _count: { resources: number } }
export default function MonitorSites({ authedFetch, canApprove }: { authedFetch: (path: string, init?: RequestInit) => Promise<Response>; canApprove: boolean }) {
  const [sites, setSites] = useState<Site[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggested, setSuggested] = useState(false)
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [seedCursor, setSeedCursor] = useState<string | null>(null)
  const [funderQuery, setFunderQuery] = useState('')
  const [funders, setFunders] = useState<Array<{ id: string; name: string; country_code: string | null }>>([])
  useEffect(() => { const timer = setTimeout(() => { void authedFetch(`/api/funding/monitor/sites?funders=${encodeURIComponent(funderQuery)}`).then(r => r.ok ? r.json() : null).then(data => { if (data) setFunders(data.funders) }).catch(() => undefined) }, 300); return () => clearTimeout(timer) }, [authedFetch, funderQuery])
  const load = useCallback(async (after?: string) => {
    try { const r = await authedFetch(`/api/funding/monitor/sites?search=${encodeURIComponent(search)}${suggested ? '&status=SUGGESTED' : ''}${after ? `&cursor=${encodeURIComponent(after)}` : ''}`); const d = await r.json(); if (!r.ok) throw new Error(d.message ?? 'Could not load sites'); setSites(old => after ? [...old, ...d.sites] : d.sites); setCursor(d.next) } catch (e) { setError(e instanceof Error ? e.message : 'Could not load sites') }
  }, [authedFetch, suggested, search])
  useEffect(() => { void load() }, [load])
  async function act(action: string, ids = selected, extras: Record<string, unknown> = {}) {
    setBusy(true); setError('')
    try { const r = await authedFetch('/api/funding/monitor/sites', { method: 'POST', body: JSON.stringify({ action, ids, ...extras }) }); const d = await r.json(); if (!r.ok) throw new Error(d.message ?? 'Site action failed'); if (action === 'seed') { setSeedCursor(d.next); setSuggested(true) } setSelected([]); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Site action failed') } finally { setBusy(false) }
  }
  return <section className="space-y-4"><p className="cb-hint">Approved sites can be explored from a single starting page. Catalog suggestions stay inactive until a super admin approves them. Exploration is bounded; Evidence shows what was actually checked.</p>
    <div className="flex flex-wrap gap-2"><button className="cb-btn-secondary cb-btn-sm" onClick={() => setSuggested(!suggested)}>{suggested ? 'Show all sites' : 'Suggested sites'}</button>{canApprove && <><button disabled={busy || !selected.length} className="cb-btn-primary cb-btn-sm" onClick={() => void act('activate')}>Approve selected</button><button disabled={busy || !selected.length} className="cb-btn-secondary cb-btn-sm" onClick={() => void act('pause')}>Pause selected</button><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act('seed', [], seedCursor ? { cursor: seedCursor } : {})}>{seedCursor ? 'Read next catalog batch' : 'Suggest sites from catalog'}</button></>}</div>
    {canApprove && <input className="rounded border px-2 py-1 text-sm" placeholder="Find a funder by name" aria-label="Find a funder" value={funderQuery} onChange={e => setFunderQuery(e.target.value)} />}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <input className="rounded border px-2 py-1 text-sm" aria-label="Find sites" placeholder="Find sites by host" value={search} onChange={e => setSearch(e.target.value)} />
    {sites.map(site => <article key={site.id} className="rounded-lg border bg-white p-4 space-y-2"><div className="flex gap-3 items-center">{canApprove && <input type="checkbox" aria-label={`Select ${site.host}`} checked={selected.includes(site.id)} onChange={e => setSelected(old => e.target.checked ? [...old, site.id] : old.filter(id => id !== site.id))} />}<strong>{site.host}</strong><span className="cb-badge">{site.status.toLowerCase()}</span></div><p className="cb-hint">{site.sources.length} watch points · {site._count.resources} observed pages or documents</p>
      {canApprove && <><button className="cb-btn-secondary cb-btn-sm" disabled={busy || site.status !== 'ACTIVE'} onClick={() => void act('discover', [site.id])}>Explore site</button><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void act('configure', [site.id], { relatedHosts: String(data.get('related') ?? '').split(',').map(s => s.trim()).filter(Boolean), attachmentHosts: String(data.get('attachments') ?? '').split(',').map(s => s.trim()).filter(Boolean), ...(data.get('funder') ? { funderId: String(data.get('funder')) } : {}), confirmWebsite: data.get('website') === 'on' }) }}><input className="rounded border px-2 text-sm" name="related" aria-label="Approved related hosts" placeholder="Related hosts, comma separated" defaultValue={site.related_hosts.join(', ')} /><input className="rounded border px-2 text-sm" name="attachments" aria-label="Approved document hosts" placeholder="Document hosts, comma separated" defaultValue={site.attachment_hosts.join(', ')} /><select className="rounded border px-2 text-sm" name="funder" aria-label="Confirm associated funder"><option value="">Confirm a funder (optional)</option>{funders.map(f => <option key={f.id} value={f.id}>{f.name}{f.country_code ? ` (${f.country_code})` : ''}</option>)}</select><label className="text-sm"><input type="checkbox" name="website" /> I confirm this is the selected funder's official website</label><button disabled={busy} className="cb-btn-secondary cb-btn-sm">Save scope</button></form></>}
      {canApprove && site.frontier.map(feed => <div key={feed.id} className="text-sm"><span>{feed.url} </span><button disabled={busy} className="cb-btn-secondary cb-btn-sm" onClick={() => void act('approve_feed', [site.id], { feedId: feed.id })}>Approve feed as an additional watch point</button></div>)}
    </article>)}
    {cursor && <button className="cb-btn-secondary cb-btn-sm" onClick={() => void load(cursor)}>Load more sites</button>}
    {!sites.length && <p className="cb-hint">No sites in this view yet.</p>}
  </section>
}
