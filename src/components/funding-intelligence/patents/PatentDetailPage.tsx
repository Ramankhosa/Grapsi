'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Bookmark, Building2, CalendarDays, Check, ClipboardCopy, FileText, Layers, Loader2, Search, Users,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import {
  buildFindSimilarQuery,
  classificationGroupOf,
  formatClassification,
  formatPatentCitation,
  tokenizeHighlightTerms,
} from '@/lib/patentIntelligence/searchCore'
import type { PatentSearchItem } from '@/lib/patentIntelligence/types'
import HighlightedText from './HighlightedText'
import { formatPatentDate, scorePercent } from './PatentResultCard'
import ShortlistButton from './ShortlistButton'
import ShortlistDrawer from './ShortlistDrawer'
import { describePatentError, type PatentErrorCopy } from './patentErrorCopy'
import { authHeaders, usePatentShortlist } from './usePatentShortlist'

function EvidenceSection({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-2">{icon}<h2 className="text-lg font-semibold text-slate-900">{title}</h2></div>
      <div className="mt-4 text-sm leading-7 text-slate-600 sm:text-[15px]">{children}</div>
    </section>
  )
}

export default function PatentDetailPage({ publicationNumber }: { publicationNumber: string }) {
  const { token, isLoading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  const query = searchParams?.get('q')?.trim() || ''
  const runId = searchParams?.get('runId')?.trim() || null
  const contextParams = searchParams?.toString() || ''

  const [patent, setPatent] = useState<PatentSearchItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorCopy, setErrorCopy] = useState<PatentErrorCopy | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')

  const shortlist = usePatentShortlist(token)
  const terms = useMemo(() => tokenizeHighlightTerms(query), [query])
  const saved = patent ? shortlist.byKey.get(patent.publicationNumberKey) : undefined

  useEffect(() => { setNoteDraft(saved?.note || '') }, [saved?.id, saved?.note])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const response = await fetch(`/api/patent-intelligence/patents/${encodeURIComponent(publicationNumber)}`, { headers: authHeaders(token) })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setErrorCopy(describePatentError(body, response.status))
        setPatent(null)
        return
      }
      setPatent(body.patent)
      setErrorCopy(null)
    } catch {
      setErrorCopy({ code: 'NETWORK', tone: 'error', title: 'Could not load this patent.', detail: 'Check your connection and try again.' })
    } finally {
      setLoading(false)
    }
  }, [publicationNumber, token])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast])

  const copyCitation = async (style: 'plain' | 'markdown') => {
    if (!patent) return
    try {
      await navigator.clipboard.writeText(formatPatentCitation(patent, style))
      setToast(style === 'plain' ? 'Citation copied' : 'Markdown citation copied')
    } catch {
      setToast('Clipboard blocked — select the citation text below instead')
    }
  }

  const commitNote = () => {
    if (!saved) return
    const next = noteDraft.trim() ? noteDraft.trim() : null
    if (next !== (saved.note || null)) void shortlist.updateNote(saved.id, next)
  }

  const backHref = `/funding/intelligence/patents${contextParams ? `?${contextParams}` : ''}`
  const groupedClassifications = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const classification of patent?.classifications || []) {
      const group = classificationGroupOf(classification) || 'Other'
      groups.set(group, [...(groups.get(group) || []), classification])
    }
    return Array.from(groups.entries())
  }, [patent])

  if (authLoading || (loading && !patent && !errorCopy)) return <div className="flex min-h-[70vh] items-center justify-center bg-[#f6f8f7]"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>
  if (!token) return <div className="p-8 text-sm text-slate-600">Sign in to view patents.</div>
  if (errorCopy || !patent) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700"><ArrowLeft className="h-4 w-4" /> Back to patent search</Link>
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          <p className="font-semibold">{errorCopy?.title || 'Patent not found'}</p>
          <p className="mt-1">{errorCopy?.detail || 'We could not load this publication number.'}</p>
          {errorCopy?.requestId ? <p className="mt-2 font-mono text-[11px] opacity-70">Request ID: {errorCopy.requestId}</p> : null}
        </div>
      </div>
    )
  }

  const score = scorePercent(patent.relevance?.score)
  const applicants = patent.applicants
  const similarHref = `/funding/intelligence/patents?q=${encodeURIComponent(buildFindSimilarQuery(patent))}${runId ? `&runId=${encodeURIComponent(runId)}` : ''}`
  const plainCitation = formatPatentCitation(patent, 'plain')

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal-800"><ArrowLeft className="h-4 w-4" /> Back to {query ? 'results' : 'patent search'}</Link>
          <button type="button" onClick={() => setDrawerOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Bookmark className="h-4 w-4 text-teal-700" /> Shortlist <span className="rounded-full bg-teal-50 px-2 py-0.5 tabular-nums text-teal-800">{shortlist.items.length}</span></button>
        </div>
      </div>

      <section className="border-b border-teal-950/10 bg-[#0b3437] text-white">
        <div className="mx-auto max-w-7xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-teal-100/70">
            {patent.jurisdiction ? <span className="rounded-full border border-teal-100/20 bg-white/10 px-2.5 py-1 text-teal-50">{patent.jurisdiction}</span> : null}
            {patent.kind ? <span className="rounded-full border border-teal-100/20 bg-white/10 px-2.5 py-1 text-teal-50">Kind {patent.kind}</span> : null}
            <span className="font-mono text-teal-50/90">{patent.publicationNumber}</span>
            {score !== null ? <span className="ml-auto text-teal-200">{score}% match to your query</span> : null}
          </div>
          <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"><HighlightedText text={patent.title} terms={terms} /></h1>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-teal-50/75">
            {applicants.length ? <span className="flex items-center gap-2"><Building2 className="h-4 w-4" />{applicants.map((applicant) => applicant.name).join('; ')}</span> : null}
            {patent.inventors.length ? <span className="flex items-center gap-2"><Users className="h-4 w-4" />{patent.inventors.join(', ')}</span> : null}
            {patent.filingDate || patent.publicationDate ? <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />{[patent.filingDate ? `Filed ${formatPatentDate(patent.filingDate)}` : null, patent.publicationDate ? `published ${formatPatentDate(patent.publicationDate)}` : null].filter(Boolean).join(' · ')}</span> : null}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
        <div className="space-y-6">
          <EvidenceSection title="Abstract" icon={<FileText className="h-5 w-5 text-teal-700" />}>
            {patent.abstract ? <p className="whitespace-pre-line"><HighlightedText text={patent.abstract} terms={terms} /></p> : <span className="italic text-slate-400">PatentNest has no abstract for this record.</span>}
          </EvidenceSection>

          {patent.classifications.length ? (
            <EvidenceSection title="Classifications" icon={<Layers className="h-5 w-5 text-teal-700" />}>
              <div className="space-y-3">
                {groupedClassifications.map(([group, codes]) => (
                  <div key={group} className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 rounded-md bg-teal-50 px-2 py-0.5 font-mono text-xs font-semibold text-teal-800">{group}</span>
                    {codes.map((code) => <span key={code} title={code} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-600">{formatClassification(code)}</span>)}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">IPC and CPC codes as PatentNest reports them, grouped by subclass.</p>
            </EvidenceSection>
          ) : null}

          <div className="grid gap-6 md:grid-cols-2">
            <EvidenceSection title="Applicants" icon={<Building2 className="h-5 w-5 text-teal-700" />}>
              {applicants.length ? (
                <ul className="space-y-3">
                  {applicants.map((applicant, index) => (
                    <li key={`${applicant.name}-${index}`}>
                      <p className="font-semibold text-slate-800">{applicant.name}</p>
                      {applicant.address ? <p className="text-xs leading-5 text-slate-500">{applicant.address}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : <span className="text-slate-400">Not available</span>}
            </EvidenceSection>
            <EvidenceSection title="Inventors" icon={<Users className="h-5 w-5 text-teal-700" />}>
              {patent.inventors.length ? <ul className="space-y-1">{patent.inventors.map((inventor) => <li key={inventor}>{inventor}</li>)}</ul> : <span className="text-slate-400">Not available</span>}
            </EvidenceSection>
          </div>

          <EvidenceSection title="Record">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Application no.</dt><dd className="mt-1 font-mono text-sm text-slate-800">{patent.applicationNumber || '—'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Pages / claims</dt><dd className="mt-1 text-sm text-slate-800">{patent.numberOfPages ?? '—'} / {patent.numberOfClaims ?? '—'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Extraction confidence</dt><dd className="mt-1 text-sm text-slate-800">{patent.extractionConfidence != null ? `${Math.round(patent.extractionConfidence * 100)}%` : '—'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Source</dt><dd className="mt-1 text-sm text-slate-800">{patent.source?.name || 'PatentNest'}{patent.source?.document ? <span className="block text-xs text-slate-500">{patent.source.document}{patent.source.page != null ? `, p. ${patent.source.page}` : ''}</span> : null}</dd></div>
            </dl>
          </EvidenceSection>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">Use this patent</h2>
            <div className="mt-4 space-y-2">
              <ShortlistButton item={patent} shortlist={shortlist} ideaRunId={runId} size="md" className="w-full justify-center" />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void copyCitation('plain')} className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ClipboardCopy className="h-4 w-4" /> Copy citation</button>
                <button type="button" onClick={() => void copyCitation('markdown')} className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ClipboardCopy className="h-4 w-4" /> Markdown</button>
              </div>
              <Link href={similarHref} className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Search className="h-4 w-4" /> Find similar patents</Link>
            </div>
            {saved ? (
              <div className="mt-4">
                <label htmlFor="patent-note" className="text-xs font-semibold text-slate-600">Your note</label>
                <textarea
                  id="patent-note"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  onBlur={commitNote}
                  maxLength={2000}
                  rows={3}
                  placeholder="Why this patent matters for the proposal — saved with your shortlist."
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </div>
            ) : null}
            {toast ? <p role="status" className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><Check className="h-3.5 w-3.5" /> {toast}</p> : null}
            {shortlist.error ? <p className="mt-3 text-xs text-rose-700">{shortlist.error}</p> : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">Cite it right</h2>
            <p className="mt-3 text-xs leading-5 text-slate-500">The citation carries the title, applicants, publication number, filing and publication dates, classifications, and the PatentNest source — enough for a reviewer to locate the record.</p>
            <p className="mt-3 select-all rounded-xl bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-700">{plainCitation}</p>
          </section>

          {/* Phase 2 (not wired yet): "Compare with my idea" — element-wise feature
              mapping via PatentNest /api/v1/analysis, metered as a FUNDING_INTELLIGENCE
              operation because it spends scarce analysis credits. */}
        </aside>
      </div>

      <ShortlistDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} shortlist={shortlist} runId={runId} contextParams={contextParams} />
    </main>
  )
}
