'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'

/**
 * My schools' calls.
 *
 * The department's other screens are organised around work that already
 * exists — what I delegated, what is overdue, who is carrying what. This one is
 * organised around work that does NOT exist yet: the open calls that match a
 * school's disciplines and that nobody has been put on. That backlog was
 * previously unreadable, because the only list of untouched calls was the whole
 * tenant's catalog with no relevance filter at all.
 *
 * Two actions clear a row, and both are one click: find someone for it, or say
 * it is not this school's business.
 */

interface QueueCall {
  id: string
  title: string | null
  agency: string | null
  closeDate: string | null
  triageStatus: string
  triageNote: string | null
  liveAssignments: number
  relevanceTier: 'direct' | 'broad' | 'keyword' | 'unclassified' | 'none'
  relevanceReason: string | null
}

interface School {
  id: string
  name: string
  code: string | null
}

interface QueueData {
  schools: School[]
  school: School | null
  isUnmapped: boolean
  relevance: 'relevant' | 'all'
  state: string
  counts: { pending: number; shortlisted: number; assigned: number; dismissed: number }
  total: number
  calls: QueueCall[]
  message?: string
}

const STATES = [
  { key: 'pending', label: 'Needs somebody' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'dismissed', label: 'Not relevant' },
  { key: 'all', label: 'All' },
] as const

function formatDate(value: string | null) {
  if (!value) return 'No deadline'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function daysUntil(value: string | null) {
  if (!value) return null
  const due = new Date(value)
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

/** Weaker evidence reads as weaker, so an officer can trust the strong rows faster. */
function tierBadge(tier: QueueCall['relevanceTier']) {
  switch (tier) {
    case 'direct':
      return { className: 'nk-badge nk-badge-ok', label: 'Direct match' }
    case 'broad':
      return { className: 'nk-badge', label: 'Related area' }
    case 'keyword':
      return { className: 'nk-badge', label: 'Keyword' }
    case 'unclassified':
      return { className: 'nk-badge nk-badge-warn', label: 'Unclassified' }
    default:
      return null
  }
}

export default function FundingDeptQueuePage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()

  const [data, setData] = useState<QueueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyCallId, setBusyCallId] = useState<string | null>(null)

  const [schoolId, setSchoolId] = useState('')
  const [state, setState] = useState<string>('pending')
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(
    async (nextSchoolId: string, nextState: string, nextShowAll: boolean) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          state: nextState,
          relevance: nextShowAll ? 'all' : 'relevant',
        })
        if (nextSchoolId) params.set('orgUnitId', nextSchoolId)

        const response = await authFetch(`/api/funding-dept/queue?${params.toString()}`)
        const payload = await response.json()
        if (!response.ok) {
          setError(payload.error || 'Could not load your queue.')
          return
        }
        setData(payload)
        // The server picks a default school when none was asked for; adopt it so
        // the selector and the next request agree.
        if (!nextSchoolId && payload.school?.id) setSchoolId(payload.school.id)
        setError(null)
      } catch {
        setError('Could not load your queue.')
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (authLoading || meLoading) return
    if (!me.isMember && !me.canAdminister) {
      setLoading(false)
      return
    }
    void load(schoolId, state, showAll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, meLoading, me.isMember, me.canAdminister, schoolId, state, showAll])

  const setTriage = async (callId: string, status: string) => {
    if (!data?.school) return
    // Writing a call off needs a reason on the record — the server requires it,
    // and "why did we pass on this" is what a head asks six months later.
    let note: string | null = null
    if (status === 'NOT_RELEVANT') {
      note = window.prompt('Why is this call not relevant to this school?')?.trim() || null
      if (!note) return
    }
    setBusyCallId(callId)
    try {
      const response = await authFetch('/api/funding-dept/queue/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fundingCallId: callId,
          orgUnitId: data.school.id,
          status,
          note,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not update this call.')
        return
      }
      await load(schoolId, state, showAll)
    } catch {
      setError('Could not update this call.')
    } finally {
      setBusyCallId(null)
    }
  }

  if (authLoading || meLoading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading&hellip;</p>
        </div>
      </main>
    )
  }

  if (!me.isMember && !me.canAdminister) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h1 className="nk-title">My schools&rsquo; calls</h1>
          <p className="nk-sub mt-2">
            This queue is for funding-department members. Ask your department head to add you.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="nk-ground nk-wash">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <p className="nk-eyebrow">Funding department</p>
        <h1 className="nk-title">My schools&rsquo; calls</h1>
        <p className="nk-sub mt-1">
          Open calls matching the disciplines of the schools you cover. Clear a row by finding
          someone for it, or by marking it not relevant.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {data?.message && (
          <div className="nk-panel mt-6 p-4">
            <p className="nk-sub">{data.message}</p>
          </div>
        )}

        {data && data.schools.length > 0 && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <label className="nk-label" htmlFor="school">
                School
              </label>
              <select
                id="school"
                className="nk-select"
                value={schoolId}
                onChange={event => setSchoolId(event.target.value)}
              >
                {data.schools.map(school => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>

              <label className="ml-auto flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={event => setShowAll(event.target.checked)}
                />
                <span className="nk-sub">Show every open call, not just this school&rsquo;s</span>
              </label>
            </div>

            {data.isUnmapped && !showAll && (
              <div className="nk-panel nk-panel-quiet mt-4 p-4">
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  <strong>{data.school?.name}</strong> has no research areas mapped yet, so this is
                  the whole open catalog rather than a filtered list.{' '}
                  <Link href="/tenant-admin/faculty" className="underline">
                    Map its disciplines
                  </Link>{' '}
                  to narrow it.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              {STATES.map(tab => {
                const count =
                  tab.key === 'all'
                    ? null
                    : data.counts[tab.key as keyof QueueData['counts']] ?? 0
                return (
                  <button
                    key={tab.key}
                    onClick={() => setState(tab.key)}
                    className={
                      state === tab.key ? 'nk-btn-sm nk-btn-primary' : 'nk-btn-sm nk-btn-secondary'
                    }
                  >
                    {tab.label}
                    {count !== null && ` (${count})`}
                  </button>
                )
              })}
            </div>

            <div className="nk-panel mt-4">
              <div className="nk-panel-head flex items-center justify-between">
                <span>
                  {data.total} call{data.total === 1 ? '' : 's'}
                </span>
              </div>

              {loading ? (
                <p className="nk-sub p-4">Loading calls&hellip;</p>
              ) : data.calls.length === 0 ? (
                <p className="nk-sub p-4">
                  {state === 'pending'
                    ? 'Nothing pending for this school. Every relevant open call has somebody on it or has been cleared.'
                    : 'Nothing here.'}
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.calls.map(call => {
                    const days = daysUntil(call.closeDate)
                    const badge = tierBadge(call.relevanceTier)
                    return (
                      <li key={call.id} className="flex flex-wrap items-start gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/funding-dept/calls/${call.id}?school=${data.school?.id ?? ''}`}
                              className="text-sm font-medium text-gray-900 hover:underline dark:text-white"
                            >
                              {call.title || 'Untitled call'}
                            </Link>
                            {badge && <span className={badge.className}>{badge.label}</span>}
                            {call.liveAssignments > 0 && (
                              <span className="nk-badge nk-badge-live">
                                {call.liveAssignments} assigned
                              </span>
                            )}
                            {call.triageStatus === 'NOT_RELEVANT' && (
                              <span className="nk-badge">Not relevant</span>
                            )}
                            {call.triageStatus === 'SHORTLISTED' && (
                              <span className="nk-badge nk-badge-ok">Shortlisted</span>
                            )}
                          </div>
                          <p className="nk-sub mt-1">
                            {call.agency || 'Agency not recorded'} &middot; closes{' '}
                            {formatDate(call.closeDate)}
                            {days !== null &&
                              ` (${days < 0 ? 'passed' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`})`}
                          </p>
                          {call.relevanceReason && (
                            <p className="nk-sub mt-0.5 text-xs">{call.relevanceReason}</p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Link
                            href={`/funding-dept/calls/${call.id}?school=${data.school?.id ?? ''}`}
                            className="nk-btn-sm nk-btn-primary"
                          >
                            Open
                          </Link>
                          {call.triageStatus !== 'SHORTLISTED' && (
                            <button
                              onClick={() => void setTriage(call.id, 'SHORTLISTED')}
                              disabled={busyCallId === call.id}
                              className="nk-btn-sm nk-btn-secondary"
                            >
                              Shortlist
                            </button>
                          )}
                          {call.triageStatus === 'NOT_RELEVANT' ? (
                            <button
                              onClick={() => void setTriage(call.id, 'NEW')}
                              disabled={busyCallId === call.id}
                              className="nk-btn-sm nk-btn-secondary"
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              onClick={() => void setTriage(call.id, 'NOT_RELEVANT')}
                              disabled={busyCallId === call.id}
                              className="nk-btn-sm nk-btn-secondary"
                            >
                              Not relevant
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
