'use client'

/**
 * How quickly each officer reacts, rather than how much is outstanding.
 *
 * The only screen where a cleared queue and an empty one look different, and the
 * only one that can see the officer who empties a queue by declaring everything
 * irrelevant. The dismissal column is deliberately plain rather than red: a
 * school really can receive mostly off-discipline calls, so the number asks a
 * question instead of making an accusation.
 */

import { useCallback, useEffect, useState } from 'react'

import FlagChips from '@/components/funding-dept/FlagChips'
import { useAuth } from '@/lib/auth-context'
import type { AccountabilityFlag } from '@/lib/fundingDept/accountabilityFlags'

interface SchoolRow {
  schoolId: string
  schoolName: string
  callsArrived: number
  medianFirstTouchDays: number | null
  neverTouched: number
  medianAllocateDays: number | null
  decided: number
  dismissed: number
  dismissedWithoutNote: number
  allocated: number
  submitted: number
  declined: number
  unanswered: number
  lapsed: number
  trend: number[]
}

interface MemberRow {
  memberId: string
  name: string | null
  email: string | null
  isHead: boolean
  isAway: boolean
  schools: SchoolRow[]
  totals: {
    callsArrived: number
    neverTouched: number
    medianFirstTouchDays: number | null
    medianAllocateDays: number | null
    decided: number
    dismissed: number
    dismissedWithoutNote: number
    allocated: number
    submitted: number
    declined: number
    unanswered: number
    lapsed: number
    conversionPct: number | null
    dismissalPct: number | null
  }
  flags: AccountabilityFlag[]
  trend: number[]
}

interface EfficiencyData {
  firstTouchTargetDays: number
  dismissalRateWarnPct: number
  trendWeeks: string[]
  members: MemberRow[]
}

/** A bare inline sparkline. No chart library for eight integers. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="nk-sub text-[11.5px]">no history yet</span>
  }
  const max = Math.max(...values, 1)
  const first = values[0]
  const last = values[values.length - 1]
  const change = last - first
  return (
    <span className="inline-flex items-end gap-[2px]" title={values.join(' → ')}>
      {values.map((value, index) => (
        <span
          key={index}
          className={`inline-block w-[3px] rounded-sm ${change > 0 ? 'bg-red-400' : 'bg-cobalt-400'}`}
          style={{ height: `${Math.max(2, Math.round((value / max) * 18))}px` }}
        />
      ))}
      <span className={`ml-1 text-[11px] ${change > 0 ? 'text-red-700' : 'text-nickel-500'}`}>
        {change > 0 ? `+${change}` : change < 0 ? change : '0'}
      </span>
    </span>
  )
}

function days(value: number | null) {
  return value === null ? '—' : `${value}d`
}

export default function EfficiencyTab({ windowKey }: { windowKey: string }) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<EfficiencyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await authFetch(
        `/api/funding-dept/accountability/efficiency?window=${windowKey}`
      )
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not load the figures.')
        return
      }
      setData(payload as EfficiencyData)
    } catch {
      setError('Could not load the figures.')
    } finally {
      setLoading(false)
    }
  }, [authFetch, windowKey])

  useEffect(() => {
    void load()
  }, [load])

  const download = async () => {
    setDownloading(true)
    try {
      const response = await authFetch(
        `/api/funding-dept/accountability/efficiency?window=${windowKey}&format=csv`
      )
      if (!response.ok) return
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `officer-efficiency-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <p className="nk-sub mt-6">Measuring how long things took…</p>
  }
  if (error) {
    return <p className="nk-sub mt-6 text-red-700">{error}</p>
  }

  const members = data?.members ?? []
  const target = data?.firstTouchTargetDays ?? 3

  return (
    <section className="nk-panel mt-6 overflow-hidden">
      <div className="nk-panel-head">
        <div>
          <h2 className="nk-title">How quickly each officer reacts</h2>
          <p className="nk-sub">
            Medians, not averages, so one call left over a sabbatical cannot make an otherwise
            reasonable record look negligent. Counted over calls that arrived inside the window, so
            clearing an old backlog is not punished.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading || members.length === 0}
          className="nk-btn-secondary nk-btn-sm"
        >
          {downloading ? 'Preparing…' : 'Export CSV'}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="nk-sub px-4 py-8 text-center">
          No officers with school coverage to report on yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-nickel-200 bg-nickel-50">
                <th className="nk-eyebrow px-4 py-2.5 text-left">Officer</th>
                <th className="nk-eyebrow px-4 py-2.5 text-right" title={`Target ${target} days`}>
                  Days to first look
                </th>
                <th className="nk-eyebrow px-4 py-2.5 text-right">Days to allocate</th>
                <th className="nk-eyebrow px-4 py-2.5 text-right">Never looked at</th>
                <th className="nk-eyebrow px-4 py-2.5 text-right">Dismissed</th>
                <th className="nk-eyebrow px-4 py-2.5 text-right">Allocated</th>
                <th className="nk-eyebrow px-4 py-2.5 text-right">Went in</th>
                <th className="nk-eyebrow px-4 py-2.5 text-left">Backlog trend</th>
                <th className="nk-eyebrow px-4 py-2.5 text-left" />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const slow =
                  member.totals.medianFirstTouchDays !== null &&
                  member.totals.medianFirstTouchDays > target
                const isOpen = Boolean(open[member.memberId])
                return (
                  <tr
                    key={member.memberId}
                    className="border-b border-nickel-100 align-top last:border-0"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setOpen((current) => ({ ...current, [member.memberId]: !isOpen }))}
                        className="text-left text-[13.5px] font-medium text-cobalt-700 hover:underline"
                      >
                        {member.name || member.email || 'Unnamed'}
                      </button>
                      <p className="nk-sub text-[11.5px]">
                        {member.isHead ? 'Department head · ' : ''}
                        {member.schools.length} school{member.schools.length === 1 ? '' : 's'}
                        {member.isAway ? ' · on leave' : ''}
                      </p>
                      {member.flags.length > 0 ? (
                        <div className="mt-1.5">
                          <FlagChips flags={member.flags} />
                        </div>
                      ) : null}
                      {isOpen ? (
                        <table className="mt-3 w-full border-t border-nickel-200">
                          <tbody>
                            {member.schools.map((school) => (
                              <tr key={school.schoolId} className="border-b border-nickel-100 last:border-0">
                                <td className="py-1.5 pr-3 text-[12.5px] text-nickel-900">
                                  {school.schoolName}
                                </td>
                                <td className="nk-mono py-1.5 pr-3 text-right text-[12px]">
                                  {days(school.medianFirstTouchDays)}
                                </td>
                                <td className="nk-mono py-1.5 pr-3 text-right text-[12px]">
                                  {days(school.medianAllocateDays)}
                                </td>
                                <td className="nk-mono py-1.5 pr-3 text-right text-[12px]">
                                  {school.neverTouched}/{school.callsArrived}
                                </td>
                                <td className="nk-mono py-1.5 pr-3 text-right text-[12px]">
                                  {school.dismissed}/{school.decided}
                                </td>
                                <td className="nk-mono py-1.5 pr-3 text-right text-[12px]">
                                  {school.allocated}
                                </td>
                                <td className="nk-mono py-1.5 pr-3 text-right text-[12px]">
                                  {school.submitted}
                                </td>
                                <td className="py-1.5">
                                  <Sparkline values={school.trend} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                    </td>
                    <td
                      className={`nk-mono px-4 py-3 text-right ${slow ? 'font-semibold text-amber-700' : ''}`}
                    >
                      {days(member.totals.medianFirstTouchDays)}
                      <span className="nk-sub block text-[11px]">target {target}d</span>
                    </td>
                    <td className="nk-mono px-4 py-3 text-right">
                      {days(member.totals.medianAllocateDays)}
                    </td>
                    <td className="nk-mono px-4 py-3 text-right">
                      {member.totals.neverTouched}
                      <span className="nk-sub block text-[11px]">
                        of {member.totals.callsArrived}
                      </span>
                    </td>
                    <td className="nk-mono px-4 py-3 text-right">
                      {member.totals.dismissalPct === null ? '—' : `${member.totals.dismissalPct}%`}
                      <span className="nk-sub block text-[11px]">
                        {member.totals.dismissed} of {member.totals.decided}
                        {member.totals.dismissedWithoutNote > 0
                          ? `, ${member.totals.dismissedWithoutNote} with no note`
                          : ''}
                      </span>
                    </td>
                    <td className="nk-mono px-4 py-3 text-right">{member.totals.allocated}</td>
                    <td className="nk-mono px-4 py-3 text-right">
                      {member.totals.submitted}
                      <span className="nk-sub block text-[11px]">
                        {member.totals.conversionPct === null
                          ? '—'
                          : `${member.totals.conversionPct}%`}
                      </span>
                      {member.totals.lapsed > 0 ? (
                        <span className="block text-[11px] text-red-700">
                          {member.totals.lapsed} never applied for
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Sparkline values={member.trend} />
                      {data?.trendWeeks.length ? (
                        <span className="nk-sub block text-[11px]">
                          {data.trendWeeks.length} weeks of unallocated backlog
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {member.totals.unanswered > 0 ? (
                        <span className="nk-badge nk-badge-warn">
                          {member.totals.unanswered} unanswered
                        </span>
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
  )
}
