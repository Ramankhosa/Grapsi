'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import FacultyProfileDrawer from '@/components/faculty/FacultyProfileDrawer'
import AssignDialog from '@/components/funding-dept/AssignDialog'
import AssignmentDossier from '@/components/funding-dept/AssignmentDossier'
import FollowUpPanel from '@/components/funding-dept/FollowUpPanel'
import ReassignDialog from '@/components/funding-dept/ReassignDialog'
import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useToast } from '@/components/ui/toast'

/**
 * One call, one school, everything.
 *
 * The department could already do each of these things, on three different
 * screens, with no way to see the sequence afterwards. This is the screen an
 * officer works a call from: who could do it, who is on it, what has been
 * said, and the two actions that clear a pendency — assign it, or say it is
 * not this school's business.
 */

interface Person {
  userId: string
  name: string
  department: string | null
  score: number | null
  matchTier: string | null
  matchReason: string | null
  researchAreas: string[]
  liveAssignments: number
  /** Calls handed to this person inside the tenant's period of consideration. */
  assignedInPeriod: number
  /** Proposals they submitted inside that same period. */
  submittedInPeriod: number
  candidateStatus: string | null
  assignmentId: string | null
  assignmentStatus: string | null
}

interface TimelineEvent {
  at: string
  kind: string
  title: string
  detail: string | null
  actor: string | null
  assignmentId: string | null
  refId: string
  approximate?: boolean
}

interface Assignment {
  id: string
  status: string
  deadlineAt: string | null
  declinedReason: string | null
  submittedAt: string | null
  outcome: string
  awardAmount: number | null
  awardCurrency: string | null
  assignee: { id: string; name: string | null; email: string } | null
  assignedBy: { id: string; name: string | null; email: string } | null
  passedOnFrom: { id: string; status: string; declinedReason: string | null; name: string } | null
  passedOnTo: { id: string; status: string; name: string } | null
  call: { title: string } | null
}

interface Dossier {
  schools: Array<{ id: string; name: string; code: string | null; covered: boolean }>
  school: { id: string; name: string; code: string | null }
  call: {
    id: string
    title: string
    agency: string | null
    summary: string | null
    closeDate: string | null
    url: string | null
    isDraft: boolean
  }
  relevance: { tier: string; reason: string | null; isUnmapped: boolean }
  period: { start: string; end: string; label: string; isDefault: boolean }
  triage: { status: string; note: string | null; decidedAt: string | null; decidedBy: string | null }
  queueState: string
  people: Person[]
  peopleError: string | null
  assignments: Assignment[]
  unattributedAssignments: Assignment[]
  timeline: TimelineEvent[]
  truncatedBefore: string | null
}

const KIND_LABEL: Record<string, string> = {
  TRIAGE: 'Decision',
  SHORTLISTED: 'Shortlisted',
  APPROACHED: 'Approached',
  PASSED_OVER: 'Passed over',
  CANDIDATE_DECLINED: 'Declined informally',
  ASSIGNED: 'Assigned',
  PASSED_ON: 'Passed on',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  SUBMITTED: 'Submitted',
  COMPLETED: 'Completed',
  OUTCOME: 'Outcome',
  CANCELLED: 'Cancelled',
  FOLLOW_UP: 'Contact',
  REMINDER_SENT: 'Reminder',
  DOCUMENT: 'Document',
  MILESTONE: 'Milestone',
  NUDGE: 'Auto-nudge',
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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

export default function CallDossierPage({ params }: { params: { callId: string } }) {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()
  const { showToast } = useToast()

  const [data, setData] = useState<Dossier | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [schoolId, setSchoolId] = useState('')
  const [assignTarget, setAssignTarget] = useState<Person | null>(null)
  const [profileTarget, setProfileTarget] = useState<Person | null>(null)
  const [reassignTarget, setReassignTarget] = useState<Assignment | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (unitId: string) => {
      setLoading(true)
      try {
        const query = unitId ? `?orgUnitId=${encodeURIComponent(unitId)}` : ''
        const response = await authFetch(`/api/funding-dept/calls/${params.callId}/dossier${query}`)
        const payload = await response.json()
        if (!response.ok) {
          setError(payload.error || 'Could not load this call.')
          return
        }
        setData(payload)
        if (!unitId && payload.school?.id) setSchoolId(payload.school.id)
        setError(null)
      } catch {
        setError('Could not load this call.')
      } finally {
        setLoading(false)
      }
    },
    [authFetch, params.callId]
  )

  useEffect(() => {
    if (authLoading || meLoading) return
    if (!me.isMember && !me.canAdminister) {
      setLoading(false)
      return
    }
    // The school comes from the URL on first load so a link from the queue or
    // a notification opens on the right one.
    const fromUrl = new URLSearchParams(window.location.search).get('school') || ''
    void load(schoolId || fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, meLoading, me.isMember, me.canAdminister, schoolId])

  const setTriage = async (status: string) => {
    if (!data) return
    let note: string | null = null
    if (status === 'NOT_RELEVANT') {
      // The server requires a reason; ask for it here rather than bouncing a 400.
      note = window.prompt('Why is this call not relevant to this school?')?.trim() || null
      if (!note) return
    }
    setBusy(true)
    try {
      const response = await authFetch('/api/funding-dept/queue/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fundingCallId: data.call.id,
          orgUnitId: data.school.id,
          status,
          note,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: payload.error || 'Could not update this call.' })
        return
      }
      await load(data.school.id)
    } finally {
      setBusy(false)
    }
  }

  const setCandidate = async (person: Person, status: string) => {
    if (!data) return
    setBusy(true)
    try {
      const response = await authFetch(
        `/api/funding-dept/calls/${data.call.id}/candidates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: person.userId,
            status,
            matchScore: person.score ?? undefined,
            matchTier: person.matchTier ?? undefined,
          }),
        }
      )
      const payload = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: payload.error || 'Could not update the shortlist.' })
        return
      }
      await load(data.school.id)
    } finally {
      setBusy(false)
    }
  }

  const patchAssignment = async (id: string, body: Record<string, unknown>, label: string) => {
    setBusy(true)
    try {
      const response = await authFetch(`/api/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: payload.error || `Could not ${label}.` })
        return
      }
      await load(data?.school.id || '')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || meLoading || (loading && !data)) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading…</p>
        </div>
      </main>
    )
  }

  if (!me.isMember && !me.canAdminister) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h1 className="nk-title">Call dossier</h1>
          <p className="nk-sub mt-2">
            This view is for funding-department members. Ask your department head to add you.
          </p>
        </div>
      </main>
    )
  }

  if (error && !data) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">{error}</p>
          <Link href="/funding-dept/queue" className="nk-btn-secondary nk-btn-sm mt-4 inline-block">
            Back to my schools&rsquo; calls
          </Link>
        </div>
      </main>
    )
  }

  if (!data) return null

  const days = daysUntil(data.call.closeDate)

  return (
    <main className="nk-ground nk-wash">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/funding-dept/queue" className="nk-sub hover:underline">
          ← My schools&rsquo; calls
        </Link>

        {/* Header */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="nk-eyebrow">{data.school.name}</p>
            <h1 className="nk-title">{data.call.title}</h1>
            <p className="nk-sub mt-1">
              {data.call.agency || 'Agency not recorded'} · closes {formatDate(data.call.closeDate)}
              {days !== null &&
                ` (${days < 0 ? 'passed' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`})`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {data.relevance.reason && (
                <span className="nk-badge nk-badge-ok">{data.relevance.reason}</span>
              )}
              {data.triage.status === 'NOT_RELEVANT' && (
                <span className="nk-badge">Not relevant to this school</span>
              )}
              {data.triage.status === 'SHORTLISTED' && (
                <span className="nk-badge nk-badge-ok">Shortlisted</span>
              )}
              {data.triage.status === 'RELEVANT' && (
                <span className="nk-badge nk-badge-ok">Pulled into this school</span>
              )}
              {data.call.isDraft && <span className="nk-badge nk-badge-warn">Draft</span>}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {data.schools.length > 1 && (
              <select
                className="nk-select"
                value={data.school.id}
                onChange={(event) => setSchoolId(event.target.value)}
              >
                {data.schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                    {school.covered ? '' : ' (not yours)'}
                  </option>
                ))}
              </select>
            )}
            <div className="flex flex-wrap gap-2">
              {/* When the classifier put this call elsewhere, the school's own
                  judgement wins — for this school only. */}
              {data.relevance.tier === 'none' && data.triage.status !== 'RELEVANT' && (
                <button
                  className="nk-btn-secondary nk-btn-sm"
                  disabled={busy}
                  onClick={() => void setTriage('RELEVANT')}
                >
                  Belongs to this school
                </button>
              )}
              {data.triage.status !== 'SHORTLISTED' && data.triage.status !== 'NOT_RELEVANT' && (
                <button
                  className="nk-btn-secondary nk-btn-sm"
                  disabled={busy}
                  onClick={() => void setTriage('SHORTLISTED')}
                >
                  Shortlist
                </button>
              )}
              {data.triage.status === 'NOT_RELEVANT' ? (
                <button
                  className="nk-btn-secondary nk-btn-sm"
                  disabled={busy}
                  onClick={() => void setTriage('NEW')}
                >
                  Restore
                </button>
              ) : (
                <button
                  className="nk-btn-secondary nk-btn-sm"
                  disabled={busy}
                  onClick={() => void setTriage('NOT_RELEVANT')}
                >
                  Not relevant
                </button>
              )}
              <Link href={`/funding/calls/${data.call.id}`} className="nk-btn-secondary nk-btn-sm">
                Call record
              </Link>
            </div>
          </div>
        </div>

        {data.relevance.isUnmapped && (
          <div className="nk-panel nk-panel-quiet mt-4 p-3">
            <p className="text-sm">
              <strong>{data.school.name}</strong> has no research areas mapped, so relevance cannot
              be judged.{' '}
              <Link href="/tenant-admin/faculty" className="underline">
                Map its disciplines
              </Link>
              .
            </p>
          </div>
        )}

        {data.triage.note && (
          <p className="nk-sub mt-3">
            Latest decision: {data.triage.note}
            {data.triage.decidedBy ? ` — ${data.triage.decidedBy}` : ''}
          </p>
        )}

        {/* People */}
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="nk-title text-lg">Best matches in {data.school.name}</h2>
            <p className="nk-sub">
              Ranked against this call · track record over{' '}
              <strong>{data.period.label}</strong> ({formatDate(data.period.start)} –{' '}
              {formatDate(data.period.end)})
              {data.period.isDefault && (
                <>
                  {' '}
                  ·{' '}
                  <Link href="/tenant-admin/funding-dept" className="underline">
                    set your period
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="nk-panel mt-3">
            {data.peopleError ? (
              <p className="nk-sub p-4">{data.peopleError}</p>
            ) : data.people.length === 0 ? (
              <p className="nk-sub p-4">
                Nobody in this school matched this call.{' '}
                <Link
                  href={`/researcher-matching?callId=${encodeURIComponent(data.call.id)}`}
                  className="underline"
                >
                  Search more widely
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.people.map((person, index) => (
                  <li key={person.userId} className="flex flex-wrap items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="nk-sub tabular-nums">#{index + 1}</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {person.name}
                        </span>
                        {person.matchTier && (
                          <span
                            className={
                              person.matchTier === 'strong'
                                ? 'nk-badge nk-badge-ok'
                                : 'nk-badge'
                            }
                          >
                            {person.matchTier}
                          </span>
                        )}
                        {person.assignmentStatus && (
                          <span className="nk-badge nk-badge-live">
                            {person.assignmentStatus.toLowerCase()}
                          </span>
                        )}
                        {!person.assignmentStatus && person.candidateStatus && (
                          <span className="nk-badge">{person.candidateStatus.toLowerCase()}</span>
                        )}
                        {person.liveAssignments > 0 && (
                          <span className="nk-sub">
                            carrying {person.liveAssignments}
                          </span>
                        )}
                      </div>
                      <p className="nk-sub mt-0.5">
                        {person.department || 'Department not recorded'}
                        {person.matchReason ? ` · ${person.matchReason}` : ''}
                      </p>
                      {/* Load and output over the tenant's stated window, so an
                          officer weighs "best match" against "already busy" and
                          "actually submits" before adding to someone's pile. */}
                      <p className="nk-sub mt-1 tabular-nums">
                        In {data.period.label}: {person.assignedInPeriod}{' '}
                        {person.assignedInPeriod === 1 ? 'call' : 'calls'} assigned ·{' '}
                        {person.submittedInPeriod}{' '}
                        {person.submittedInPeriod === 1 ? 'proposal' : 'proposals'} submitted
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {/* Before the actions on purpose: the officer deciding
                          whether to assign wants the person's publications and
                          Scholar page first, not after. */}
                      <button
                        className="nk-btn-secondary nk-btn-sm"
                        onClick={() => setProfileTarget(person)}
                      >
                        Profile
                      </button>
                      {!person.assignmentId && (
                        <button
                          className="nk-btn-primary nk-btn-sm"
                          onClick={() => setAssignTarget(person)}
                        >
                          Assign
                        </button>
                      )}
                      {!person.assignmentId && person.candidateStatus !== 'SHORTLISTED' && (
                        <button
                          className="nk-btn-secondary nk-btn-sm"
                          disabled={busy}
                          onClick={() => void setCandidate(person, 'SHORTLISTED')}
                        >
                          Shortlist
                        </button>
                      )}
                      {!person.assignmentId && (
                        <button
                          className="nk-btn-secondary nk-btn-sm"
                          disabled={busy}
                          onClick={() => void setCandidate(person, 'PASSED_OVER')}
                        >
                          Pass over
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Assignments */}
        <section className="mt-8">
          <h2 className="nk-title text-lg">Assignments in {data.school.name}</h2>
          {data.assignments.length === 0 ? (
            <p className="nk-sub mt-2">
              Nobody is on this call in {data.school.name} yet.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.assignments.map((assignment) => (
                <div key={assignment.id} className="nk-panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {assignment.assignee?.name || assignment.assignee?.email}
                        </span>
                        <span className="nk-badge">{assignment.status.toLowerCase()}</span>
                        {assignment.outcome !== 'PENDING' && (
                          <span className="nk-badge nk-badge-ok">
                            {assignment.outcome.toLowerCase()}
                          </span>
                        )}
                      </div>
                      <p className="nk-sub mt-1">
                        Due {formatDate(assignment.deadlineAt)}
                        {assignment.assignedBy?.name
                          ? ` · assigned by ${assignment.assignedBy.name}`
                          : ''}
                      </p>
                      {assignment.passedOnFrom && (
                        <p className="nk-sub mt-0.5">
                          Passed on from {assignment.passedOnFrom.name}
                          {assignment.passedOnFrom.declinedReason
                            ? ` — declined: ${assignment.passedOnFrom.declinedReason}`
                            : ''}
                        </p>
                      )}
                      {assignment.declinedReason && (
                        <p className="nk-sub mt-0.5">Declined: {assignment.declinedReason}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {assignment.status === 'DECLINED' && (
                        <button
                          className="nk-btn-secondary nk-btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void patchAssignment(assignment.id, { status: 'ASSIGNED' }, 'ask again')
                          }
                        >
                          Ask again
                        </button>
                      )}
                      <button
                        className="nk-btn-secondary nk-btn-sm"
                        onClick={() => setReassignTarget(assignment)}
                      >
                        Pass on
                      </button>
                      <button
                        className="nk-btn-secondary nk-btn-sm"
                        onClick={() =>
                          setExpanded(expanded === assignment.id ? null : assignment.id)
                        }
                      >
                        {expanded === assignment.id ? 'Hide detail' : 'Detail'}
                      </button>
                    </div>
                  </div>

                  {expanded === assignment.id && (
                    <div className="mt-4 space-y-4 border-t border-gray-100 pt-4 dark:border-gray-700">
                      <FollowUpPanel assignmentId={assignment.id} onLogged={() => void load(data.school.id)} />
                      <AssignmentDossier assignmentId={assignment.id} outcome={assignment.outcome} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {data.unattributedAssignments.length > 0 && (
            <div className="nk-panel nk-panel-quiet mt-3 p-4">
              <p className="nk-eyebrow">Not placed in any school</p>
              <p className="nk-sub mt-1">
                These people have no department on their profile, so they belong to no school&rsquo;s
                numbers. Placing them in the org structure fixes it.
              </p>
              <ul className="mt-2 space-y-1">
                {data.unattributedAssignments.map((assignment) => (
                  <li key={assignment.id} className="text-sm">
                    {assignment.assignee?.name || assignment.assignee?.email} ·{' '}
                    {assignment.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* History */}
        <section className="mt-8">
          <h2 className="nk-title text-lg">History</h2>
          <p className="nk-sub mt-1">
            Everything that happened on this call in {data.school.name}. Only the department sees it.
          </p>

          <div className="mt-3">
            <FollowUpPanel
              target={{ callId: data.call.id, orgUnitId: data.school.id }}
              onLogged={() => void load(data.school.id)}
              formOnly
            />
          </div>

          {data.timeline.length === 0 ? (
            <p className="nk-sub mt-4">Nothing recorded yet.</p>
          ) : (
            <ol className="mt-4 space-y-2">
              {data.timeline.map((event) => (
                <li key={event.refId} className="nk-panel px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="nk-badge">{KIND_LABEL[event.kind] || event.kind}</span>
                    <span className="nk-sub">
                      {formatWhen(event.at)}
                      {event.approximate ? ' (approx.)' : ''}
                    </span>
                    {event.actor && <span className="nk-sub">· {event.actor}</span>}
                  </div>
                  <p className="mt-2 text-[13.5px] leading-6 text-nickel-800">{event.title}</p>
                  {event.detail && <p className="nk-sub mt-1">{event.detail}</p>}
                </li>
              ))}
            </ol>
          )}

          {data.truncatedBefore && (
            <p className="nk-sub mt-3">
              Older than {formatDate(data.truncatedBefore)} is not shown — this call has more
              history than one page holds.
            </p>
          )}
        </section>
      </div>

      {profileTarget && (
        <FacultyProfileDrawer
          userId={profileTarget.userId}
          fallbackName={profileTarget.name}
          fallbackHint={profileTarget.department}
          onClose={() => setProfileTarget(null)}
        >
          {!profileTarget.assignmentId && (
            <button
              className="nk-btn-primary"
              onClick={() => {
                const target = profileTarget
                setProfileTarget(null)
                setAssignTarget(target)
              }}
            >
              Assign this call
            </button>
          )}
        </FacultyProfileDrawer>
      )}

      {assignTarget && (
        <AssignDialog
          callId={data.call.id}
          callTitle={data.call.title}
          callCloseDate={data.call.closeDate}
          person={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => {
            setAssignTarget(null)
            void load(data.school.id)
          }}
        />
      )}

      {reassignTarget && (
        <ReassignDialog
          assignment={{
            id: reassignTarget.id,
            status: reassignTarget.status,
            deadlineAt: reassignTarget.deadlineAt,
            declinedReason: reassignTarget.declinedReason,
            call: { title: data.call.title },
            assignee: reassignTarget.assignee
              ? {
                  name: reassignTarget.assignee.name || reassignTarget.assignee.email,
                  email: reassignTarget.assignee.email,
                }
              : null,
          }}
          onClose={() => setReassignTarget(null)}
          onDone={(message) => {
            setReassignTarget(null)
            showToast({ type: 'success', title: message })
            void load(data.school.id)
          }}
        />
      )}
    </main>
  )
}
