'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Clock3, Loader2, RefreshCw } from 'lucide-react'

import type { IdeaAnalysisSummary } from './types'

const STATUS_STYLES: Record<IdeaAnalysisSummary['status'], string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  PROCESSING: 'bg-teal-50 text-teal-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-rose-50 text-rose-700',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export default function AnalysisHistoryList({ token, compact = false }: { token: string | null | undefined; compact?: boolean }) {
  const [runs, setRuns] = useState<IdeaAnalysisSummary[]>([])
  const [loading, setLoading] = useState(false)

  const loadRuns = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const response = await fetch('/api/idea-intelligence', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.ok) {
        const body = await response.json()
        setRuns(Array.isArray(body.runs) ? body.runs : [])
      }
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void loadRuns() }, [loadRuns])

  if (!token || (!loading && runs.length === 0)) return null

  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${compact ? 'p-4' : 'p-5 sm:p-6'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-teal-700" />
          <h2 className="text-sm font-semibold text-slate-900">Your analyses</h2>
        </div>
        <button type="button" onClick={() => void loadRuns()} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-teal-700" aria-label="Refresh analyses">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-4 divide-y divide-slate-100">
        {runs.slice(0, compact ? 3 : 5).map((run) => (
          <Link key={run.id} href={`/funding/intelligence/idea/${run.id}`} className="block py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{run.title}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(run.updatedAt)}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[run.status]}`}>{run.status}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

