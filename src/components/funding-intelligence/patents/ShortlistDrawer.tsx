'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Check, ClipboardCopy, Download, Loader2, StickyNote, Trash2, X } from 'lucide-react'

import type { PatentShortlistItemDto } from '@/lib/patentIntelligence/types'
import type { PatentShortlistState } from './usePatentShortlist'

function formatSavedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function detailHref(item: PatentShortlistItemDto, contextParams: string) {
  const base = `/funding/intelligence/patents/${encodeURIComponent(item.publicationNumber)}`
  return contextParams ? `${base}?${contextParams}` : base
}

function ShortlistRow({ item, shortlist, contextParams }: { item: PatentShortlistItemDto; shortlist: PatentShortlistState; contextParams: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.note || '')
  const pending = shortlist.pendingKeys.has(item.publicationNumberKey)
  const applicants = item.record.applicants.map((applicant) => applicant.name).join('; ')

  const commitNote = () => {
    const next = draft.trim() ? draft.trim() : null
    setEditing(false)
    if (next !== (item.note || null)) void shortlist.updateNote(item.id, next)
  }

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={detailHref(item, contextParams)} className="block text-sm font-semibold leading-5 text-slate-900 hover:text-teal-800">{item.record.title}</Link>
          <p className="mt-1 text-xs text-slate-500">
            <span className="font-mono">{item.publicationNumber}</span>
            {item.record.jurisdiction ? ` · ${item.record.jurisdiction}` : ''}
            {applicants ? ` · ${applicants}` : ''}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Saved {formatSavedAt(item.createdAt)}{item.ideaRunId ? ' · linked to an idea analysis' : ''}</p>
        </div>
        <button
          type="button"
          onClick={() => void shortlist.remove(item.id)}
          disabled={pending}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait"
          aria-label={`Remove ${item.record.title} from shortlist`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>

      {editing ? (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`note-${item.id}`}>Note</label>
          <textarea
            id={`note-${item.id}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitNote}
            onKeyDown={(event) => { if (event.key === 'Escape') { setDraft(item.note || ''); setEditing(false) } }}
            maxLength={2000}
            rows={2}
            autoFocus
            placeholder="Why this patent matters for the proposal…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-2 inline-flex items-center gap-1.5 text-left text-xs text-slate-600 hover:text-teal-800">
          <StickyNote className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {item.note ? <span className="line-clamp-2">{item.note}</span> : <span className="text-slate-400">Add a note</span>}
        </button>
      )}
    </li>
  )
}

/**
 * Slide-over with every saved patent. Lives on the search and detail pages
 * rather than on its own route: it is the working set used while searching.
 */
export default function ShortlistDrawer({ open, onClose, shortlist, runId, contextParams = '' }: {
  open: boolean
  onClose: () => void
  shortlist: PatentShortlistState
  runId?: string | null
  /** Current search URL params, so detail links open with the "back to results" context. */
  contextParams?: string
}) {
  const [onlyThisRun, setOnlyThisRun] = useState(Boolean(runId))
  const [toast, setToast] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'md' | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setOnlyThisRun(Boolean(runId)) }, [runId])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])')
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, open])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(timer)
  }, [toast])

  const visible = useMemo(
    () => (runId && onlyThisRun ? shortlist.items.filter((item) => item.ideaRunId === runId) : shortlist.items),
    [onlyThisRun, runId, shortlist.items],
  )

  if (!open) return null

  const copyAll = async () => {
    const ok = await shortlist.copyMarkdown(visible)
    if (ok) setToast(`Copied ${visible.length} citation${visible.length === 1 ? '' : 's'} as Markdown`)
  }
  const download = async (format: 'csv' | 'md') => {
    setExporting(format)
    await shortlist.exportAs(format, { runId: runId && onlyThisRun ? runId : null })
    setExporting(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close shortlist" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="shortlist-drawer-title" className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Patent search</p>
            <h2 id="shortlist-drawer-title" className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900"><Bookmark className="h-5 w-5 text-teal-700" /> Your shortlist ({visible.length})</h2>
            <p className="mt-1 text-xs text-slate-500">Saved patents stay here across searches. Export when you write the prior-art or IP section.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 sm:px-6">
          <button type="button" onClick={() => void copyAll()} disabled={!visible.length} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300"><ClipboardCopy className="h-4 w-4" /> Copy all as Markdown</button>
          <button type="button" onClick={() => void download('csv')} disabled={!visible.length || exporting !== null} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{exporting === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV</button>
          <button type="button" onClick={() => void download('md')} disabled={!visible.length || exporting !== null} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{exporting === 'md' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Markdown</button>
          {runId ? (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={onlyThisRun} onChange={(event) => setOnlyThisRun(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600" />
              Only this analysis
            </label>
          ) : null}
        </div>

        {shortlist.error ? <p className="mx-5 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 sm:mx-6">{shortlist.error}</p> : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {shortlist.loading && !shortlist.items.length ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading your shortlist…</div>
          ) : visible.length ? (
            <ul className="divide-y divide-slate-100">
              {visible.map((item) => <ShortlistRow key={item.id} item={item} shortlist={shortlist} contextParams={contextParams} />)}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <Bookmark className="mx-auto h-8 w-8 text-slate-300" />
              <h3 className="mt-3 font-semibold text-slate-900">Nothing saved yet</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                {runId && onlyThisRun && shortlist.items.length
                  ? 'No patents are linked to this analysis yet — untick “Only this analysis” to see everything you have saved.'
                  : 'Shortlist a patent from the results or its detail page; export here when you write the prior-art section.'}
              </p>
            </div>
          )}
        </div>

        {toast ? (
          <div role="status" className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg"><Check className="h-4 w-4 text-emerald-300" /> {toast}</div>
        ) : null}
      </div>
    </div>
  )
}
