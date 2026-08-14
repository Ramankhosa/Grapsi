'use client'

import { useMemo, useState } from 'react'

/**
 * Who looks after which school.
 *
 * Presented school-first rather than member-first because the question people
 * actually ask is "who is chasing Engineering?", and because a school with
 * nobody against it is the failure this screen exists to make visible. One
 * select per school also makes the one-member-per-school rule self-evident:
 * there is physically nowhere to put a second name.
 */

export interface CoverageSchool {
  id: string
  name: string
  code: string | null
  memberId: string | null
  memberName: string | null
  covered: boolean
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
  disabled?: boolean
}

export default function SchoolCoverageEditor({ schools, members, onAssign, disabled }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null)

  const uncovered = useMemo(() => schools.filter((school) => !school.covered), [schools])

  const handleChange = async (schoolId: string, value: string) => {
    setPendingId(schoolId)
    try {
      await onAssign(schoolId, value || null)
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

      <div className="nk-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-nickel-200 bg-nickel-50">
                <th className="nk-eyebrow px-4 py-2.5 text-left">School</th>
                <th className="nk-eyebrow px-4 py-2.5 text-left">Covered by</th>
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
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
