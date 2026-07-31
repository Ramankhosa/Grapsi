'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, Circle, ListChecks, X } from 'lucide-react'
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
    <section className="nk-panel nk-enter mb-10 overflow-hidden">
      <div className="nk-panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`nk-tile h-9 w-9 ${allDone ? '' : 'nk-tile-live'}`}>
            <ListChecks className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="nk-title text-[14px]">
              {allDone ? 'Setup complete' : 'Finish setting up'}
            </h2>
            <p className="nk-sub text-[12.5px]">
              Each step sharpens how well the system matches you
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2.5 sm:flex">
            <span className="nk-mono text-nickel-500">
              {completedCount}/{totalCount}
            </span>
            <div className="nk-meter w-28">
              <div className="nk-meter-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss the setup checklist"
            className="flex h-8 w-8 items-center justify-center rounded-md text-nickel-500 transition
                       hover:bg-nickel-100 hover:text-nickel-700
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-cobalt-600"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <ul className="divide-y divide-nickel-100">
        {milestones.map(milestone => {
          const isNext = nextBestAction?.key === milestone.key && !milestone.completed
          return (
            <li key={milestone.key}>
              <Link
                href={milestone.href}
                className={`group flex items-center gap-3 px-5 py-3 transition duration-150 hover:bg-nickel-50
                            focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2
                            focus-visible:outline-cobalt-600 ${isNext ? 'bg-cobalt-50/50' : ''}`}
              >
                {milestone.completed ? (
                  <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-nickel-400" aria-hidden />
                ) : (
                  <Circle
                    className={`h-[18px] w-[18px] shrink-0 ${isNext ? 'text-cobalt-600' : 'text-nickel-300'}`}
                    aria-hidden
                  />
                )}

                <div className="min-w-0 flex-1">
                  <span
                    className={`text-[13.5px] ${
                      milestone.completed
                        ? 'text-nickel-500 line-through decoration-nickel-300'
                        : 'font-medium text-nickel-800'
                    }`}
                  >
                    {milestone.title}
                  </span>
                  {isNext && (
                    <p className="mt-0.5 truncate text-[12.5px] text-nickel-500">
                      {milestone.description}
                    </p>
                  )}
                </div>

                {isNext && (
                  <span className="nk-badge nk-badge-live hidden shrink-0 sm:inline-flex">
                    Up next
                  </span>
                )}
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-nickel-300 transition duration-150
                             group-hover:translate-x-0.5 group-hover:text-nickel-500"
                  aria-hidden
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
