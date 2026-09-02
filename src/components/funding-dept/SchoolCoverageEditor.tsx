'use client'

import { useMemo, useState } from 'react'

/**
 * Who looks after which school.
 *
 * Presented school-first rather than member-first because the question people
 * actually ask is "who is chasing Engineering?", and because a school with
 * nobody against it is the failure this screen exists to make visible.
 *
 * The second column is the deputy: a standing backup who picks up the school's
 * ticklers while the primary is on leave. It is deliberately a separate column
 * rather than a second entry in the same list, so "who is answerable" and "who
 * is covering this fortnight" never blur into each other.
 */

export interface CoverageSchool {
  id: string
  name: string
  code: string | null
  memberId: string | null
  memberName: string | null
  covered: boolean
  deputyMemberId?: string | null
  deputyName?: string | null
  /** The primary is on leave right now. */
  primaryAway?: boolean
  /** On leave with no deputy — covered on paper, uncovered in practice. */
  uncoveredRightNow?: boolean
}

export interface CoverageMember {
  id: string
  name: string | null
  email: string | null
  isHead: boolean
}

interface Props {
  schools: CoverageSchool[]
  members: CoverageMember[]
  onAssign: (schoolId: string, memberId: string | null) => Promise<void>
  onAssignDeputy?: (schoolId: string, memberId: string | null) => Promise<void>
  disabled?: boolean
}

export default function SchoolCoverageEditor({
  schools,
  members,
  onAssign,
  onAssignDeputy,
  disabled,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null)

  const uncovered = useMemo(() => schools.filter((school) => !school.covered), [schools])
  const goneDark = useMemo(
    () => schools.filter((school) => school.uncoveredRightNow),
    [schools]
  )

  const handleChange = async (schoolId: string, value: string) => {
    setPendingId(schoolId)
    try {
      await onAssign(schoolId, value || null)
    } finally {
      setPendingId(null)
    }
  }

  const handleDeputyChange = async (schoolId: string, value: string) => {
    if (!onAssignDeputy) return
    setPendingId(`${schoolId}:deputy`)
    try {
      await onAssignDeputy(schoolId, value || null)
    } finally {
      setPendingId(null)
    }
  }

  if (schools.length === 0) {
    return (
      <div className="nk-panel-quiet px-5 py-8 text-center">
        <p className="nk-title">No schools yet</p>
        <p className="nk-sub mx-auto mt-1 max-w-md">
          Add your organization&apos;s schools under Faculty &amp; Organization first — coverage is
          assigned per school.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {uncovered.length > 0 ? (
        <div className="nk-panel border-amber-200 bg-amber-50/60 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-800">
            {uncovered.length} school{uncovered.length === 1 ? '' : 's'} with nobody assigned
          </p>
          <p className="nk-sub mt-0.5 text-amber-700">
            Calls closing in {uncovered.map((school) => school.name).join(', ')} have no one chasing
            them.
          </p>
        </div>
      ) : null}

      {goneDark.length > 0 ? (
        <div className="nk-panel border-red-200 bg-red-50/60 px-4 py-3">
          <p className="text-[13px] font-semibold text-red-800">
            {goneDark.length} school{goneDark.length === 1 ? '' : 's'} covered by someone on leave,
            with no deputy
          </p>
          <p className="nk-sub mt-0.5 text-red-700">
            {goneDark.map((school) => school.name).join(', ')} — nobody is receiving their reminders
            right now. Name a deputy.
          </p>
        </div>
      ) : null}

      <div className="nk-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-nickel-200 bg-nickel-50">
                <th className="nk-eyebrow px-4 py-2.5 text-left">School</th>
                <th className="nk-eyebrow px-4 py-2.5 text-left">Covered by</th>
                {onAssignDeputy ? (
                  <th className="nk-eyebrow px-4 py-2.5 text-left">Deputy</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {schools.map((school) => (
                <tr key={school.id} className="border-b border-nickel-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="text-[13.5px] font-medium text-nickel-900">{school.name}</span>
                    {school.code ? (
                      <span className="nk-mono ml-2 text-nickel-500">{school.code}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        className="nk-select max-w-xs"
                        value={school.memberId ?? ''}
                        disabled={disabled || pendingId === school.id}
                        onChange={(event) => handleChange(school.id, event.target.value)}
                      >
                        <option value="">— nobody —</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name || member.email}
                            {member.isHead ? ' (head)' : ''}
                          </option>
                        ))}
                      </select>
                      {pendingId === school.id ? (
                        <span className="nk-sub">Saving…</span>
                      ) : !school.covered ? (
                        <span className="nk-badge nk-badge-warn">uncovered</span>
                      ) : school.primaryAway ? (
                        <span className="nk-badge nk-badge-warn">on leave</span>
                      ) : null}
                    </div>
                  </td>
                  {onAssignDeputy ? (
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          className="nk-select max-w-xs"
                          value={school.deputyMemberId ?? ''}
                          disabled={disabled || pendingId === `${school.id}:deputy`}
                          onChange={(event) => handleDeputyChange(school.id, event.target.value)}
                        >
                          <option value="">— none —</option>
                          {members
                            .filter((member) => member.id !== school.memberId)
                            .map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name || member.email}
                                {member.isHead ? ' (head)' : ''}
                              </option>
                            ))}
                        </select>
                        {pendingId === `${school.id}:deputy` ? (
                          <span className="nk-sub">Saving…</span>
                        ) : school.uncoveredRightNow ? (
                          <span className="nk-badge nk-badge-danger">nobody covering</span>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
