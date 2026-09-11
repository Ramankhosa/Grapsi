'use client'

/**
 * The sponsored-research office, as the organization sees it.
 *
 * An administrator could already reach every one of these numbers — through a
 * menu entry, on a page built for the department head, phrased for somebody who
 * works there. What they did not have was a destination: a single screen that
 * says how the office is doing and hands them the four spreadsheets a governing
 * body asks for.
 *
 * Deliberately a summary with links, not a fifth report. It calls the same four
 * endpoints the department page does, so an administrator and a head reading the
 * same week can never be looking at two different sets of numbers.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import type { AccountabilityFlag } from '@/lib/fundingDept/accountabilityFlags'

interface Summary {
  window: string
  untouchedPending: number
  pending: number
  goneQuiet: number
  overdueUnchased: number
  submitted: number
  flaggedMembers: number
  uncoveredSchools: number
  backlogCalls: number
  closingSoon: number
  oldestDays: number
  facultyNeverAssigned: number
  facultyUnreachable: number
  facultyTotal: number
  worstMembers: Array<{ name: string; score: number; flags: AccountabilityFlag[] }>
  worstSchools: Array<{ name: string; officer: string | null; untouched: number; oldest: number }>
}

const EXPORTS = [
  { key: 'backlog', file: 'unallocated-calls', label: 'Unallocated calls' },
  { key: 'faculty', file: 'faculty-engagement', label: 'Faculty engagement' },
  { key: 'efficiency', file: 'officer-efficiency', label: 'Officer efficiency' },
]

export default function DsrAccountabilityPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [matrixRes, backlogRes, facultyRes] = await Promise.all([
        authFetch('/api/funding-dept/accountability?window=reporting'),
        authFetch('/api/funding-dept/accountability/backlog?window=reporting'),
        authFetch('/api/funding-dept/accountability/faculty?window=reporting&standing='),
      ])
      if (!matrixRes.ok) {
        setDenied(true)
        return
      }
      const matrix = await matrixRes.json()
      const backlog = backlogRes.ok ? await backlogRes.json() : { calls: [], totals: {} }
      const faculty = facultyRes.ok ? await facultyRes.json() : { totals: {}, bySchool: [] }

      // The worst schools come from the backlog list rather than the grid,
      // because "oldest" is a property of a call and the grid only holds counts.
      const bySchool = new Map<string, { name: string; officer: string | null; untouched: number; oldest: number }>()
      for (const call of backlog.calls ?? []) {
        const existing = bySchool.get(call.schoolId)
        if (existing) {
          existing.untouched += 1
          existing.oldest = Math.max(existing.oldest, call.daysWaiting)
        } else {
          bySchool.set(call.schoolId, {
            name: call.schoolName,
            officer: call.officer?.name ?? null,
            untouched: 1,
            oldest: call.daysWaiting,
          })
        }
      }

      setSummary({
        window: matrix.window?.label ?? 'this period',
        untouchedPending: matrix.totals?.untouchedPending ?? 0,
        pending: matrix.totals?.pending ?? 0,
        goneQuiet: matrix.totals?.goneQuiet ?? 0,
        overdueUnchased: matrix.totals?.overdueUnchased ?? 0,
        submitted: matrix.totals?.submittedInWindow ?? 0,
        flaggedMembers: matrix.totals?.flaggedMembers ?? 0,
        uncoveredSchools: matrix.totals?.uncovered ?? 0,
        backlogCalls: backlog.totals?.calls ?? 0,
        closingSoon: backlog.totals?.closingSoon ?? 0,
        oldestDays: backlog.totals?.oldestDays ?? 0,
        facultyNeverAssigned: faculty.totals?.neverAssigned ?? 0,
        facultyUnreachable: faculty.totals?.unreachable ?? 0,
        facultyTotal: faculty.totals?.faculty ?? 0,
        worstMembers: (matrix.members ?? [])
          .filter((member: any) => member.score > 0)
          .slice(0, 5)
          .map((member: any) => ({
            name: member.name || member.email || 'Unnamed',
            score: member.score,
            flags: member.flags,
          })),
        worstSchools: Array.from(bySchool.values())
          .sort((left, right) => right.untouched - left.untouched || right.oldest - left.oldest)
          .slice(0, 5),
      })
      setDenied(false)
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  // authFetch and a blob, not a plain link: auth is Bearer-only here.
  const download = async (key: string, file: string) => {
    setBusy(key)
    try {
      const response = await authFetch(
        `/api/funding-dept/accountability/${key}?window=reporting&format=csv`
      )
      if (!response.ok) return
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${file}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(null)
    }
  }

  if (authLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Reading the department…</p>
        </div>
      </main>
    )
  }

  if (denied) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Sponsored research oversight</h1>
          <p className="nk-sub mx-auto mt-2 max-w-md">
            This is for administrators and the funding department head.
          </p>
        </div>
      </main>
    )
  }

  const cards = [
    {
      label: 'Calls nobody has taken up',
      value: summary?.backlogCalls ?? 0,
      hint: `${summary?.closingSoon ?? 0} close within a fortnight · longest wait ${summary?.oldestDays ?? 0} days`,
      tone: (summary?.backlogCalls ?? 0) > 0 ? 'warn' : 'ok',
      href: '/funding-dept/accountability?tab=backlog',
    },
    {
      label: 'Officers with something outstanding',
      value: summary?.flaggedMembers ?? 0,
      hint: `${summary?.goneQuiet ?? 0} ${summary?.goneQuiet === 1 ? 'allocation' : 'allocations'} gone quiet · ${summary?.overdueUnchased ?? 0} past deadline unchased`,
      tone: (summary?.flaggedMembers ?? 0) > 0 ? 'warn' : 'ok',
      href: '/funding-dept/accountability',
    },
    {
      label: 'Faculty never sent anything',
      value: summary?.facultyNeverAssigned ?? 0,
      hint: `of ${summary?.facultyTotal ?? 0} · ${summary?.facultyUnreachable ?? 0} more cannot be matched yet`,
      tone: (summary?.facultyNeverAssigned ?? 0) > 0 ? 'warn' : 'ok',
      href: '/funding-dept/accountability?tab=faculty',
    },
    {
      label: 'Schools nobody covers',
      value: summary?.uncoveredSchools ?? 0,
      hint:
        (summary?.uncoveredSchools ?? 0) > 0
          ? 'nothing is being chased in these at all'
          : 'every school has an officer',
      tone: (summary?.uncoveredSchools ?? 0) > 0 ? 'danger' : 'ok',
      href: '/tenant-admin/funding-dept',
    },
  ]

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Sponsored research oversight
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            How the funding department is doing, over {summary?.window}. Every figure here opens the
            list behind it, and the same numbers are what the department head sees.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="nk-panel block p-4 transition hover:border-cobalt-300"
            >
              <p className="nk-eyebrow">{card.label}</p>
              <p
                className={`nk-mono mt-1 text-[28px] font-semibold ${
                  card.tone === 'danger'
                    ? 'text-red-700'
                    : card.tone === 'warn'
                      ? 'text-amber-700'
                      : 'text-nickel-900'
                }`}
              >
                {card.value}
              </p>
              <p className="nk-sub mt-1 text-[11.5px]">{card.hint}</p>
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="nk-panel overflow-hidden">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Officers with the most outstanding</h2>
                <p className="nk-sub">
                  Ranked by the weight of what is waiting, not by a judgement. Anyone on leave is
                  excluded from the ranking rather than penalised for it.
                </p>
              </div>
            </div>
            {summary?.worstMembers.length ? (
              <ul className="divide-y divide-nickel-100">
                {summary.worstMembers.map((member) => (
                  <li key={member.name} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13.5px] font-medium text-nickel-900">{member.name}</span>
                      <span className="nk-mono text-[12px] text-nickel-500">{member.score}</span>
                    </div>
                    <ul className="nk-sub mt-1 space-y-0.5 text-[12px]">
                      {member.flags.slice(0, 3).map((flag) => (
                        <li key={flag.code}>{flag.label}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nk-sub px-4 py-8 text-center">Nothing outstanding against anyone.</p>
            )}
          </section>

          <section className="nk-panel overflow-hidden">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Schools with the most waiting</h2>
                <p className="nk-sub">Relevant calls with nobody on them, oldest first.</p>
              </div>
            </div>
            {summary?.worstSchools.length ? (
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-nickel-200 bg-nickel-50">
                    {['School', 'Officer', 'Waiting', 'Oldest'].map((heading, index) => (
                      <th
                        key={heading}
                        className={`nk-eyebrow px-4 py-2.5 ${index < 2 ? 'text-left' : 'text-right'}`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.worstSchools.map((school) => (
                    <tr key={school.name} className="border-b border-nickel-100 last:border-0">
                      <td className="px-4 py-3 text-[13.5px] text-nickel-900">{school.name}</td>
                      <td className="nk-sub px-4 py-3 text-[12.5px]">{school.officer || 'nobody'}</td>
                      <td className="nk-mono px-4 py-3 text-right">{school.untouched}</td>
                      <td className="nk-mono px-4 py-3 text-right">{school.oldest}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="nk-sub px-4 py-8 text-center">Nothing is sitting unallocated.</p>
            )}
          </section>
        </div>

        <section className="nk-panel mt-6">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Take it away</h2>
              <p className="nk-sub">
                The spreadsheets a governing body or an audit asks for, as they stand right now.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-4">
            {EXPORTS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => void download(entry.key, entry.file)}
                disabled={busy !== null}
                className="nk-btn-secondary nk-btn-sm"
              >
                {busy === entry.key ? 'Preparing…' : `${entry.label} CSV`}
              </button>
            ))}
            <Link href="/tenant-admin/funding-dept" className="nk-btn-secondary nk-btn-sm">
              Staffing &amp; thresholds
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}
