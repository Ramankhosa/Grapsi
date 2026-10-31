'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import type { ResearcherRoutingPreview as Payload } from '@/lib/fundingDept/researcherRoutingPreview'
import type { SchoolRoutingPreview } from '@/lib/fundingDept/researcherRoutingPolicy'

const field = 'rounded border border-nickel-300 bg-white px-3 py-2 text-sm'
const statuses: Record<SchoolRoutingPreview['status'], string> = {
  RESEARCHER_FIT: 'Researcher fit recorded', BORDERLINE_REVIEW: 'Borderline suggestions',
  INSTITUTIONAL_REVIEW: 'Institutional review', NO_RECORDED_FIT: 'No fit recorded',
}
const snapshotLabels = { MISSING: 'Matching not recorded', STALE: 'Saved matching is outdated',
  UNVERIFIED: 'Saved matching needs verification', RECORDED: 'Saved matching is current' }

function SchoolCard({ school }: { school: SchoolRoutingPreview }) {
  const [page, setPage] = useState(1)
  const pageSize = 10, pages = Math.max(1, Math.ceil(school.people.length / pageSize))
  return <article className="nk-panel space-y-3 p-4" aria-label={school.name}>
    <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{school.name}</h3>
      <p className="nk-sub text-sm">{school.coordinator ? `Coordinator: ${school.coordinator}` : 'No available coordinator — coverage review needed'}</p></div>
      <span className="text-sm font-medium">{school.matchingPeople} matching researchers</span></div>
    <p className="text-sm">{statuses[school.status]} · {school.strongPeople} strong · {school.borderlinePeople} below threshold</p>
    <p className="nk-sub text-sm">{school.explanation}</p>
    {school.placementConflicts > 0 && <p className="text-sm text-amber-800">{school.placementConflicts} saved matches have changed or missing placement and are excluded from this school’s count.</p>}
    <ul className="divide-y divide-nickel-100">{school.people.slice((page - 1) * pageSize, page * pageSize).map(person => <li key={person.id} className="space-y-1 py-3 text-sm">
      <p className="font-medium">{person.name} <span className="font-normal text-nickel-600">· {person.unitName || 'Department not recorded'} · {person.band === 'strong' ? 'Strong match' : 'Good match'}</span></p>
      <p>{person.reason}</p>
      <p className={person.eligibility === 'KNOWN_CONFLICT' ? 'text-amber-800' : 'text-nickel-600'}>{person.eligibility === 'KNOWN_CONFLICT' ? 'Eligibility conflict: ' : 'Eligibility review: '}{person.eligibilityNotes.join(' ')}</p>
    </li>)}</ul>
    {pages > 1 && <div className="flex items-center gap-3 text-sm"><button className="nk-btn-secondary nk-btn-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous researchers</button>
      <span>Page {page} of {pages}</span><button className="nk-btn-secondary nk-btn-xs" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next researchers</button></div>}
  </article>
}

export default function ResearcherRoutingPreview() {
  const { authFetch } = useAuth()
  const [data, setData] = useState<Payload | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [callId, setCallId] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const [schoolFilter, setSchoolFilter] = useState('review')
  useEffect(() => {
    let live = true
    setLoading(true); setData(null); setError('')
    const params = new URLSearchParams({ page: String(page) })
    if (query) params.set('search', query)
    if (callId) params.set('callId', callId)
    authFetch(`/api/funding-dept/routing-preview?${params}`).then(async response => {
      const body = await response.json()
      if (!response.ok) throw Error(body.error || 'Could not load routing preview.')
      if (live) setData(body)
    }).catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [authFetch, callId, page, query, revision])
  const schools = data?.schools.filter(s => schoolFilter === 'all' || (schoolFilter === 'fit' ? s.matchingPeople > 0 : s.status !== 'NO_RECORDED_FIT' || s.placementConflicts > 0)) || []
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Researcher routing preview</h1>
      <Link className="nk-btn-secondary nk-btn-sm" href="/funding-dept/reports">Back to reports</Link></div>
    <div className="rounded border border-cobalt-200 bg-cobalt-50 p-4 text-sm"><strong>Preview only — live routing is unchanged.</strong>
      <p className="mt-1">Review how saved individual matches could reach schools. This screen creates no responsibility, allocation or notification. Final calibration will use the combined faculty roster.</p></div>
    <form className="nk-panel flex flex-wrap items-end gap-3 p-4" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setCallId(''); setPage(1) }}>
      <label className="w-full min-w-0 text-sm sm:flex-1">Find an open, released call<input aria-label="Find a call" className={`${field} mt-1 block w-full`} value={search} onChange={e => setSearch(e.target.value)} maxLength={200} placeholder="Call title" /></label>
      <button className="nk-btn-primary nk-btn-sm" type="submit">Search calls</button><button className="nk-btn-secondary nk-btn-sm" type="button" onClick={() => setRevision(v => v + 1)}>Refresh preview</button>
    </form>
    {loading && <p role="status" className="nk-sub">Loading saved results…</p>}
    {error && <p role="alert" className="rounded border border-red-200 p-3 text-red-700">{error}</p>}
    {data && <>
      <section className="nk-panel space-y-3 p-4" aria-label="Faculty readiness"><h2 className="font-semibold">Faculty readiness</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[
          ['Active profiles', data.coverage.profiles], ['Missing placement', data.coverage.unplaced], ['Placement corrections', data.coverage.invalidPlacement],
          ['Missing research index', data.coverage.missingEmbedding], ['Missing research description', data.coverage.missingResearch],
        ].map(([label, value]) => <div key={label} className="rounded bg-nickel-50 p-3"><p className="text-xs text-nickel-600">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}</div>
        <p className="nk-sub text-sm">{data.coverageNote} Issue counts may overlap.</p>
        {!!data.issues.length && <details><summary className="cursor-pointer text-sm">Profiles needing attention — first {data.issues.length}</summary>
          <ul className="mt-2 space-y-1 text-sm">{data.issues.map(p => <li key={p.id}>{p.name} · {p.issue}</li>)}</ul>
          <Link className="mt-2 inline-block text-sm text-cobalt-700 underline" href="/tenant-admin/faculty">Review faculty data</Link></details>}
      </section>
      <section className="nk-panel space-y-3 p-4"><label className="block text-sm">Open calls ({data.totalCalls})<select aria-label="Choose call" className={`${field} mt-1 block w-full max-w-full`} value={data.call?.id || ''} onChange={e => setCallId(e.target.value)}>
        {!data.calls.length && <option value="">No open calls found</option>}
        {data.call && !data.calls.some(c => c.id === data.call!.id) && <option value={data.call.id}>{data.call.title}</option>}
        {data.calls.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select></label>
        <div className="flex flex-wrap items-center gap-3 text-sm"><button className="nk-btn-secondary nk-btn-xs" disabled={page <= 1} onClick={() => { setCallId(''); setPage(p => p - 1) }}>Previous calls</button>
          <span>Page {page} of {Math.max(1, Math.ceil(data.totalCalls / data.pageSize))}</span><button className="nk-btn-secondary nk-btn-xs" disabled={page * data.pageSize >= data.totalCalls} onClick={() => { setCallId(''); setPage(p => p + 1) }}>Next calls</button></div>
        <p className="nk-sub text-xs">Imported catalogue calls appear here after release to the funding department. Refresh reads saved results; it does not run matching.</p>
      </section>
      {data.call && <>
        <section className="space-y-2" aria-label="Saved matching status"><h2 className="text-lg font-semibold">{data.call.title}</h2>
          <p className={data.snapshotStatus === 'RECORDED' ? 'text-sm text-nickel-700' : 'text-sm text-amber-800'}>{snapshotLabels[data.snapshotStatus]}{data.snapshot ? ` · ${new Date(data.snapshot.refreshedAt).toLocaleString()}` : ''}</p>
          <p className="nk-sub text-sm">{data.snapshotStatus === 'RECORDED' ? 'Counts below describe saved research relevance. Complete evidence coverage and eligibility still require validation.' : 'Treat the saved results below as provisional. Missing or outdated matching is not a successful zero-match result.'} Match width: {data.width.toLowerCase()}.</p>
        </section>
        <label className="block text-sm">Show schools<select className={`${field} ml-2 max-w-full`} value={schoolFilter} onChange={e => setSchoolFilter(e.target.value)}>
          <option value="review">Matches and review cases</option><option value="fit">Recorded researcher matches</option><option value="all">All schools</option></select></label>
        {schools.map(s => <SchoolCard key={`${data.call!.id}:${revision}:${s.id}`} school={s} />)}
        {!schools.length && <p className="nk-sub">No saved routes match this filter. Review all schools and the faculty readiness gaps; this is not proof of no relevant researchers.</p>}
      </>}
    </>}
  </div>
}
