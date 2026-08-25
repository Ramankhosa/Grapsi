'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, Building2, CalendarDays, Users, Zap } from 'lucide-react'

import { formatClassification } from '@/lib/patentIntelligence/searchCore'
import type { PatentSearchItem } from '@/lib/patentIntelligence/types'
import HighlightedText from './HighlightedText'
import ShortlistButton from './ShortlistButton'
import type { PatentShortlistState } from './usePatentShortlist'

const VISIBLE_CLASSIFICATIONS = 6
const VISIBLE_INVENTORS = 3

export function scorePercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.round(Math.max(0, Math.min(1, value)) * 100)
}

export function formatPatentDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export default function PatentResultCard({ item, terms, shortlist, ideaRunId, detailHref }: {
  item: PatentSearchItem
  terms: string[]
  shortlist: PatentShortlistState
  ideaRunId?: string | null
  detailHref: string
}) {
  const [expanded, setExpanded] = useState(false)
  const score = scorePercent(item.relevance?.score)
  const semantic = item.relevance?.semanticScore
  const text = item.relevance?.textScore
  const year = item.publicationYear ?? item.filingYear
  const applicants = item.applicants.map((applicant) => applicant.name)
  const hiddenInventors = Math.max(0, item.inventors.length - VISIBLE_INVENTORS)
  const hiddenClassifications = Math.max(0, item.classifications.length - VISIBLE_CLASSIFICATIONS)
  const longAbstract = (item.abstract?.length || 0) > 420

  return (
    <article className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-lg hover:shadow-teal-950/5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {item.jurisdiction ? <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-teal-800">{item.jurisdiction}</span> : null}
        {item.kind ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">Kind {item.kind}</span> : null}
        <span className="font-mono text-xs text-slate-500">{item.publicationNumber}</span>
        {year ? <span className="text-xs font-medium text-slate-500">{year}</span> : null}
        {score !== null ? (
          <span className="ml-auto flex flex-col items-end text-xs font-semibold text-teal-700">
            <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" />{score}% match</span>
            {semantic != null || text != null ? (
              <span className="text-[10px] font-normal text-slate-400">
                {semantic != null ? `semantic ${semantic.toFixed(2)}` : null}{semantic != null && text != null ? ' · ' : null}{text != null ? `text ${text.toFixed(2)}` : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <Link href={detailHref} className="mt-3 block text-lg font-semibold leading-snug text-slate-900 transition group-hover:text-teal-800 sm:text-xl">
        <HighlightedText text={item.title} terms={terms} />
      </Link>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
        {applicants.length ? <span className="flex min-w-0 items-center gap-1.5"><Building2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={applicants.join('; ')}>{applicants.slice(0, 2).join('; ')}{applicants.length > 2 ? ` +${applicants.length - 2}` : ''}</span></span> : null}
        {item.inventors.length ? <span className="flex min-w-0 items-center gap-1.5"><Users className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={item.inventors.join(', ')}>{item.inventors.slice(0, VISIBLE_INVENTORS).join(', ')}{hiddenInventors ? ` +${hiddenInventors}` : ''}</span></span> : null}
      </div>

      {item.abstract ? (
        <div className="mt-4 text-sm leading-6 text-slate-600">
          <p className={expanded ? '' : 'line-clamp-4'}><HighlightedText text={item.abstract} terms={terms} /></p>
          {longAbstract ? (
            <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-1 text-xs font-semibold text-teal-700 hover:text-teal-900">
              {expanded ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      ) : <p className="mt-4 text-sm italic text-slate-400">No abstract is available for this record.</p>}

      {item.classifications.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {item.classifications.slice(0, VISIBLE_CLASSIFICATIONS).map((classification) => (
            <span key={classification} title={classification} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600">{formatClassification(classification)}</span>
          ))}
          {hiddenClassifications ? <span className="px-1 text-[11px] text-slate-400">+{hiddenClassifications} more</span> : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {item.filingDate ? <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Filed {formatPatentDate(item.filingDate)}</span> : null}
          {item.publicationDate ? <span>Published {formatPatentDate(item.publicationDate)}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <ShortlistButton item={item} shortlist={shortlist} ideaRunId={ideaRunId} />
          <Link href={detailHref} className="inline-flex min-h-[40px] items-center gap-1 px-2 text-sm font-semibold text-teal-700 hover:text-teal-900">View details <ArrowRight className="h-4 w-4" /></Link>
        </span>
      </div>
    </article>
  )
}
