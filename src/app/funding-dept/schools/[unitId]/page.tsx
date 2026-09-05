'use client'

import Link from 'next/link'

import ProposalStatusChip from '@/components/proposals/ProposalStatusChip'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import SummaryCards from '@/components/funding-dept/SummaryCards'

/**
 * One school's desk.
 *
 * Everything here is scoped to the school rather than to the person looking at
 * it, so a call the head or a colleague assigned into this school shows up
 * alongside your own — which is the whole point. The assigner is named on every
 * row for the same reason.
 */

interface SchoolFaculty {
  userId: string
  name: string
  email: string
  employeeId: string | null
  department: string | null
  designation: string | null
  liveAssignments: number
  lastAssignedAt: string | null
}

interface SchoolAssignment {
  id: string
  status: string
  deadlineAt: string | null
  respondedAt: string | null
  assignee: { id: string; name: string } | null
  assignedBy: { id: string; name: string; isMe: boolean } | null
  call: { id: string; title: string; agency: string | null; closeDate: string | null } | null
}

interface ContactEntry {
  id: string
  kind: string
  note: string
  happenedAt: string
  author: string | null
  facultyName: string | null
  callTitle: string | null
}

interface SchoolProposal {
  id: string
  title: string
  status: string
  agencyName: string
  reviewCutoffAt: string | null
  versionNo: number
  reviewStatus: string
  pi: { id: string; name: string | null }
}

interface OpenCall {
  id: string
  title: string | null
  agencyName: string | null
  closesAt: string | null
}

interface SchoolData {
  school: { id: string; name: string; code: string | null }
  coveredBy: { id: string; name: string; isMe: boolean } | null
  summary: { active: number; submitted: number; missed: number; declined: number; total: number }
  openCalls: OpenCall[]
  proposals: SchoolProposal[]
  faculty: SchoolFaculty[]
  assignments: SchoolAssignment[]
  recentContact: ContactEntry[]
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ASSIGNED: { label: 'Awaiting reply', className: 'nk-badge nk-badge-warn' },
  ACCEPTED: { label: 'Accepted', className: 'nk-badge nk-badge-live' },
  IN_PROGRESS: { label: 'In progress', className: 'nk-badge nk-badge-live' },
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', {
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

export default function SchoolWorkspacePage() {
  const params = useParams<{ unitId: string }>()
  const unitId = params?.unitId as string
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()

  const [data, setData] = useState<SchoolData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!unitId) return
    setLoading(true)
    try {
      const response = await authFetch(`/api/funding-dept/schools/${unitId}`)
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not load this school.')
        return
      }
      setData(payload)
      setError(null)
    } catch {
      setError('Could not load this school.')
    } finally {
      setLoading(false)
    }
  }, [authFetch, unitId])

  useEffect(() => {
    if (authLoading || meLoading) return
    void load()
  }, [authLoading, meLoading, load])

  if (authLoading || meLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading this school…</p>
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">School</h1>
          <p className="nk-sub mt-2">{error || 'Nothing to show.'}</p>
          <Link href="/funding-dept" className="nk-btn-secondary nk-btn-sm mt-4">
            Back to the department
          </Link>
        </div>
      </main>
    )
  }

  const stats = [
    { label: 'Active', value: data.summary.active, hint: 'live in this school', tone: 'live' as const },
    { label: 'Overdue', value: data.summary.missed, hint: 'past the internal deadline', tone: 'danger' as const },
    { label: 'Declined', value: data.summary.declined, hint: 'need a new home', tone: 'warn' as const },
    { label: 'Submitted', value: data.summary.submitted, hint: 'applications recorded' },
  ]

  const idleFaculty = data.faculty.filter((person) => person.liveAssignments === 0)

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-64" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Funding department · School</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            {data.school.name}
          </h1>
          <p className="nk-sub mt-1">
            Everything live in this school, whoever assigned it.
            {data.coveredBy
              ? data.coveredBy.isMe
                ? ' You cover it.'
                : ` Covered by ${data.coveredBy.name}.`
              : ' Nobody covers this school yet.'}
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <SummaryCards stats={stats} />

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/researcher-matching?school=${encodeURIComponent(data.school.id)}`}
            className="nk-btn-primary nk-btn-sm"
          >
            Match a call to this school
          </Link>
          <Link
            href={`/funding-dept/faculty?school=${encodeURIComponent(data.school.id)}`}
            className="nk-btn-secondary nk-btn-sm"
          >
            Faculty roster
          </Link>
          <Link href="/funding-dept/chase" className="nk-btn-secondary nk-btn-sm">
            Chase queue
          </Link>
          <Link href="/funding-dept" className="nk-btn-secondary nk-btn-sm ml-auto">
            Back to my worklist
          </Link>
        </div>

        <section className="nk-panel mt-6">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Live in this school</h2>
              <p className="nk-sub">Every open assignment, and who handed it out</p>
            </div>
            <span className="nk-badge">{data.assignments.length}</span>
          </div>
          {data.assignments.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="nk-sub">Nothing is live in this school right now.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-nickel-200 bg-nickel-50">
                    {['Call', 'Faculty', 'Assigned by', 'Deadline', 'State'].map((heading) => (
                      <th key={heading} className="nk-eyebrow px-4 py-2.5 text-left">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.assignments.map((row) => {
                    const badge = STATUS_LABEL[row.status] || {
                      label: row.status,
                      className: 'nk-badge',
                    }
                    const left = daysUntil(row.deadlineAt)
                    return (
                      <tr key={row.id} className="border-b border-nickel-100 last:border-0">
                        <td className="px-4 py-3">
                          {row.call ? (
                            <Link
                              href={`/funding-dept/calls/${row.call.id}?school=${unitId}`}
                              className="text-[13.5px] font-medium text-cobalt-700 hover:underline"
                            >
                              {row.call.title || 'Untitled call'}
                            </Link>
                          ) : (
                            <p className="text-[13.5px] font-medium text-nickel-900">Untitled call</p>
                          )}
                          <p className="nk-sub mt-0.5">{row.call?.agency || 'Unknown agency'}</p>
                        </td>
                        <td className="nk-sub px-4 py-3">{row.assignee?.name || '—'}</td>
                        <td className="nk-sub px-4 py-3">
                          {row.assignedBy?.isMe ? 'You' : row.assignedBy?.name || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <p className="nk-sub">{formatDate(row.deadlineAt)}</p>
                          {left !== null ? (
                            <p
                              className={
                                left < 0
                                  ? 'text-[12px] font-medium text-red-700'
                                  : left <= 7
                                    ? 'text-[12px] font-medium text-amber-700'
                                    : 'nk-sub text-[12px]'
                              }
                            >
                              {left < 0 ? `${Math.abs(left)} days over` : `${left} days left`}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className={badge.className}>{badge.label}</span>
                          {row.status === 'ASSIGNED' && !row.respondedAt ? (
                            <p className="nk-sub mt-1 text-[11.5px]">No answer yet</p>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Who has capacity</h2>
                <p className="nk-sub">{idleFaculty.length} of {data.faculty.length} carrying nothing</p>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data.faculty.length === 0 ? (
                <p className="nk-sub px-5 py-8 text-center">
                  No faculty are placed in this school yet.
                </p>
              ) : (
                <ul>
                  {data.faculty.map((person) => (
                    <li
                      key={person.userId}
                      className="flex items-start justify-between gap-3 border-b border-nickel-100 px-5 py-3 last:border-0"
                    >
                      <div>
                        <p className="text-[13.5px] font-medium text-nickel-900">{person.name}</p>
                        <p className="nk-sub mt-0.5">
                          {[person.department, person.designation].filter(Boolean).join(' · ') ||
                            person.email}
                        </p>
                      </div>
                      <span
                        className={
                          person.liveAssignments > 0
                            ? 'nk-badge nk-badge-live tabular-nums'
                            : 'nk-badge tabular-nums'
                        }
                        title={
                          person.lastAssignedAt
                            ? `Last assigned ${formatDate(person.lastAssignedAt)}`
                            : 'Never assigned a call'
                        }
                      >
                        {person.liveAssignments}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Needs somebody</h2>
                <p className="nk-sub">
                  Calls in this school&rsquo;s disciplines that nobody here has been put on
                </p>
              </div>
              {data.openCalls.length > 0 ? (
                <span className="nk-badge nk-badge-warn">{data.openCalls.length}</span>
              ) : null}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data.openCalls.length === 0 ? (
                <p className="nk-sub px-5 py-8 text-center">
                  Nothing closing soon is unassigned here.
                </p>
              ) : (
                <ul>
                  {data.openCalls.map((call) => (
                    <li key={call.id} className="border-b border-nickel-100 px-5 py-3 last:border-0">
                      <p className="text-[13.5px] font-medium text-nickel-900">
                        {call.title || 'Untitled call'}
                      </p>
                      <p className="nk-sub mt-0.5">
                        {call.agencyName || 'Unknown agency'} · closes {formatDate(call.closesAt)}
                      </p>
                      <Link
                        href={`/funding-dept/calls/${call.id}?school=${unitId}`}
                        className="nk-btn-secondary nk-btn-sm mt-2"
                      >
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/*
          What this school has in front of the desk right now. Sits above the
          contact log because it is the work; the log is the trail behind it.
        */}
        {data.proposals.length > 0 ? (
          <section className="nk-panel mt-4">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Proposals in hand</h2>
                <p className="nk-sub">Applications from this school the department is processing</p>
              </div>
              <span className="nk-badge">{data.proposals.length}</span>
            </div>
            <div className="px-5 py-4">
              <ul className="divide-y divide-hairline">
                {data.proposals.map((proposal) => (
                  <li key={proposal.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <Link
                      href={`/funding-dept/proposals/${proposal.id}`}
                      className="min-w-0 flex-1 text-[13px] font-medium text-cobalt-700 hover:underline"
                    >
                      {proposal.title}
                    </Link>
                    <span className="nk-sub text-[12px]">{proposal.pi.name}</span>
                    <ProposalStatusChip status={proposal.status} />
                    <span className="nk-sub text-[11px]">
                      {proposal.versionNo > 0 ? `v${proposal.versionNo}` : 'no draft'}
                      {proposal.reviewStatus === 'REVIEWED' ? ' · review not sent' : ''}
                      {proposal.reviewStatus === 'NONE' && proposal.versionNo > 0
                        ? ' · not reviewed'
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="nk-panel mt-4">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Recent contact</h2>
              <p className="nk-sub">The last things anyone logged against this school</p>
            </div>
          </div>
          <div className="px-5 py-4">
            {data.recentContact.length === 0 ? (
              <p className="nk-sub">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.recentContact.map((entry) => (
                  <li key={entry.id} className="border-b border-nickel-100 pb-3 last:border-0 last:pb-0">
                    <p className="text-[13.5px] text-nickel-900">
                      <span className="font-medium">{entry.facultyName || 'Unknown'}</span>
                      <span className="nk-sub"> · {entry.callTitle || 'Untitled call'}</span>
                    </p>
                    <p className="nk-sub mt-0.5">{entry.note}</p>
                    <p className="nk-sub mt-1 text-[11.5px]">
                      {entry.kind.toLowerCase()} · {entry.author || 'Unknown'} ·{' '}
                      {formatDate(entry.happenedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
