'use client'

import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'

import type { PatentSearchItem } from '@/lib/patentIntelligence/types'
import type { PatentShortlistState } from './usePatentShortlist'

export default function ShortlistButton({ item, shortlist, ideaRunId, size = 'sm', className = '' }: {
  item: PatentSearchItem
  shortlist: PatentShortlistState
  ideaRunId?: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const saved = shortlist.byKey.has(item.publicationNumberKey)
  const pending = shortlist.pendingKeys.has(item.publicationNumberKey)
  const sizing = size === 'md' ? 'px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs'
  const tone = saved
    ? 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800'
    : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:text-teal-800'
  return (
    <button
      type="button"
      aria-pressed={saved}
      disabled={pending}
      onClick={() => void shortlist.toggle(item, { ideaRunId })}
      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border font-semibold transition disabled:cursor-wait disabled:opacity-70 ${sizing} ${tone} ${className}`}
      title={saved ? 'Remove from shortlist' : 'Save to shortlist'}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      {saved ? 'Shortlisted' : 'Shortlist'}
    </button>
  )
}
