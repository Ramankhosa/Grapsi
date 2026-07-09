'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Circle, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface JourneyMilestone {
  key: string
  title: string
  description: string
  href: string
  completed: boolean
}

interface JourneySnapshot {
  milestones: JourneyMilestone[]
  completedCount: number
  totalCount: number
  nextBestAction: JourneyMilestone | null
  checklistDone: boolean
  dismissedTours: string[]
}

export default function GettingStartedCard() {
  const { authFetch, user } = useAuth()
  const [journey, setJourney] = useState<JourneySnapshot | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    authFetch('/api/v1/me/journey')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data) setJourney(data)
      })
      .catch(() => {
        /* the card simply doesn't render if the journey can't load */
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, user])

  const dismiss = useCallback(() => {
    setHidden(true)
    authFetch('/api/v1/me/journey', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checklist_done: true })
    }).catch(() => {})
  }, [authFetch])

  if (!journey || journey.checklistDone || hidden) return null

  const { milestones, completedCount, totalCount, nextBestAction } = journey
  const allDone = completedCount === totalCount
  const progressPct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="mb-10 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50">
            <Sparkles className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              {allDone ? 'You are all set!' : 'Getting started'}
            </h2>
            <p className="text-xs text-slate-400">
              {completedCount} of {totalCount} steps complete
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-slate-100 sm:block">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss getting started checklist"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ul className="divide-y divide-slate-50">
        {milestones.map(milestone => {
          const isNext = nextBestAction?.key === milestone.key
          return (
            <li key={milestone.key}>
              <Link
                href={milestone.href}
                className={`group flex items-center gap-3 px-6 py-3 transition-colors hover:bg-slate-50/80 ${
                  isNext ? 'bg-violet-50/40' : ''
                }`}
              >
                {milestone.completed ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-slate-200" />
                )}
                <div className="min-w-0 flex-1">
                  <span
                    className={`text-sm font-medium ${
                      milestone.completed ? 'text-slate-400 line-through decoration-slate-200' : 'text-slate-700'
                    }`}
                  >
                    {milestone.title}
                  </span>
                  {isNext && !milestone.completed && (
                    <p className="mt-0.5 truncate text-xs text-slate-400">{milestone.description}</p>
                  )}
                </div>
                {isNext && !milestone.completed && (
                  <span className="hidden shrink-0 rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-medium text-violet-600 sm:inline">
                    Up next
                  </span>
                )}
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-200 transition-all group-hover:translate-x-0.5 group-hover:text-slate-400" />
              </Link>
            </li>
          )
        })}
      </ul>
    </motion.div>
  )
}
