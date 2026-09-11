'use client'

/**
 * Who in these schools has been sent nothing.
 *
 * The two columns that matter are the standing and the reason. "Never sent
 * anything" is work for the covering officer; "cannot be matched yet" is work for
 * an administrator, and showing them in one undifferentiated list of names would
 * send officers to chase people the system cannot route a call to. So the totals
 * strip separates them before the table does, and the filter defaults to the rows
 * somebody can actually act on.
 */

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

interface EngagementRow {
  userId: string
  name: string
  email: string | null
  employeeId: string | null
  unitName: string | null
  schoolName: string | null
  designation: string | null
  officerName: string | null
  code: 'ENGAGED' | 'DORMANT' | 'NEVER_ASSIGNED' | 'UNREACHABLE'
  unreachable: { noAreas: boolean; neverActivated: boolean }
  everAssigned: number
  assignedInWindow: number
  live: number
  submittedInWindow: number
  declinedEver: number
  lastAssignedAt: string | null
  daysSinceAssigned: number | null
}

interface EngagementData {
  dormantDays: number
  rows: EngagementRow[]
  totals: {
    faculty: number
    engaged: number
    dormant: number
    neverAssigned: number
    unreachable: number
    actionable: number
  }
  bySchool: Array<{
    schoolId: string
    schoolName: string
    officerName: string | null
    faculty: number
    neverAssigned: number
    dormant: number
    unreachable: number
    actionable: number
  }>
}

const STANDING: Record<EngagementRow['code'], { label: string; className: string }> = {
  NEVER_ASSIGNED: { label: 'Never sent anything', className: 'nk-badge nk-badge-danger' },
  DORMANT: { label: 'Nothing this period', className: 'nk-badge nk-badge-warn' },
  UNREACHABLE: { label: 'Cannot be matched yet', className: 'nk-badge' },
  ENGAGED: { label: 'Engaged', className: 'nk-badge nk-badge-ok' },
}

const FILTERS = [
  { value: 'NEVER_ASSIGNED', label: 'Never sent anything' },
  { value: 'DORMANT', label: 'Nothing this period' },
  { value: 'UNREACHABLE', label: 'Cannot be matched' },
  { value: '', label: 'Everyone' },
]

function shortDate(value: string | null) {
  if (!value) return 'never'
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

function unreachableWhy(row: EngagementRow) {
  const parts: string[] = []
  if (row.unreachable.noAreas) parts.push('no research areas saved')
  if (row.unreachable.neverActivated) parts.push('account never activated')
  return parts.join(', ')
}

export default function FacultyEngagementTab({ windowKey }: { windowKey: string }) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<EngagementData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Defaults to the rows an officer owns, not to everyone: a list that opens on
  // two hundred engaged names buries the four that need a phone call.
  const [standing, setStanding] = useState('NEVER_ASSIGNED')
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ window: windowKey })
      if (standing) params.set('standing', standing)
      const response = await authFetch(`/api/funding-dept/accountability/faculty?${params}`)
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not load the roster.')
        return
      }
      setData(payload as EngagementData)
    } catch {
      setError('Could not load the roster.')
    } finally {
      setLoading(false)
    }
  }, [authFetch, windowKey, standing])

  useEffect(() => {
    void load()
  }, [load])

  const download = async () => {
    setDownloading(true)
    try {
      const params = new URLSearchParams({ window: windowKey, format: 'csv' })
      if (standing) params.set('standing', standing)
      const response = await authFetch(`/api/funding-dept/accountability/faculty?${params}`)
      if (!response.ok) return
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `faculty-engagement-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <p className="nk-sub mt-6">Reading the roster…</p>
  }
  if (error) {
    return <p className="nk-sub mt-6 text-red-700">{error}</p>
  }

  const totals = data?.totals
  const rows = data?.rows ?? []

  return (
    <>
      <section className="nk-panel mt-6 overflow-hidden">
        <div className="nk-panel-head">
          <div>
            <h2 className="nk-title">Faculty the department has not reached</h2>
            <p className="nk-sub">
              Counted across the whole roster, whatever the filter below shows. Somebody who cannot
              be matched is a data gap for an administrator to close, not a chase for an officer —
              which is why the two are separated.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading || rows.length === 0}
            className="nk-btn-secondary nk-btn-sm"
          >
            {downloading ? 'Preparing…' : 'Export CSV'}
          </button>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-nickel-200 bg-nickel-50 px-4 py-2.5">
          <span className="nk-sub text-[12px]">
            <span className="nk-mono font-semibold text-red-700">{totals?.neverAssigned ?? 0}</span>{' '}
            never sent anything
          </span>
          <span className="nk-sub text-[12px]">
            <span className="nk-mono font-semibold text-amber-700">{totals?.dormant ?? 0}</span>{' '}
            nothing this period
          </span>
          <span className="nk-sub text-[12px]">
            <span className="nk-mono font-semibold text-nickel-900">{totals?.unreachable ?? 0}</span>{' '}
            cannot be matched yet
          </span>
          <span className="nk-sub text-[12px]">
            <span className="nk-mono font-semibold text-nickel-900">{totals?.engaged ?? 0}</span>{' '}
            engaged, of {totals?.faculty ?? 0} in all
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-nickel-100 px-4 py-2.5">
          <span className="nk-eyebrow">Showing</span>
          {FILTERS.map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              onClick={() => setStanding(option.value)}
              className={
                standing === option.value ? 'nk-btn-primary nk-btn-xs' : 'nk-btn-secondary nk-btn-xs'
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="nk-sub px-4 py-8 text-center">
            Nobody in these schools falls into that group.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  {['Name', 'School', 'Standing', 'Ever sent', 'Live', 'Last sent', 'Covering officer'].map(
                    (heading, index) => (
                      <th
                        key={heading}
                        className={`nk-eyebrow px-4 py-2.5 ${index === 3 || index === 4 ? 'text-right' : 'text-left'}`}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} className="border-b border-nickel-100 last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-[13.5px] font-medium text-nickel-900">{row.name}</p>
                      <p className="nk-sub text-[11.5px]">
                        {row.email}
                        {row.employeeId ? ` · ${row.employeeId}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] text-nickel-900">{row.schoolName || '—'}</p>
                      {row.unitName && row.unitName !== row.schoolName ? (
                        <p className="nk-sub text-[11.5px]">{row.unitName}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={STANDING[row.code].className}>{STANDING[row.code].label}</span>
                      {row.code === 'UNREACHABLE' ? (
                        <p className="nk-sub mt-1 text-[11.5px]">{unreachableWhy(row)}</p>
                      ) : null}
                    </td>
                    <td className="nk-mono px-4 py-3 text-right">{row.everAssigned}</td>
                    <td className="nk-mono px-4 py-3 text-right">{row.live}</td>
                    <td className="nk-sub px-4 py-3 text-[12.5px]">
                      {shortDate(row.lastAssignedAt)}
                      {row.daysSinceAssigned !== null ? (
                        <span className="block text-[11px]">{row.daysSinceAssigned}d ago</span>
                      ) : null}
                    </td>
                    <td className="nk-sub px-4 py-3 text-[12.5px]">{row.officerName || 'nobody'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(data?.bySchool.length ?? 0) > 0 ? (
        <section className="nk-panel mt-6 overflow-hidden">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">By school</h2>
              <p className="nk-sub">
                Worst first by the number an officer can act on, so a school with a long
                unreachable list does not outrank one with real neglect.
              </p>
            </div>
          </div>
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-nickel-200 bg-nickel-50">
                {['School', 'Officer', 'Faculty', 'Never sent', 'Dormant', 'Unreachable'].map(
                  (heading, index) => (
                    <th
                      key={heading}
                      className={`nk-eyebrow px-4 py-2.5 ${index < 2 ? 'text-left' : 'text-right'}`}
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {data?.bySchool.map((row) => (
                <tr key={row.schoolId} className="border-b border-nickel-100 last:border-0">
                  <td className="px-4 py-3 text-[13.5px] text-nickel-900">{row.schoolName}</td>
                  <td className="nk-sub px-4 py-3 text-[12.5px]">{row.officerName || 'nobody'}</td>
                  <td className="nk-mono px-4 py-3 text-right">{row.faculty}</td>
                  <td className="nk-mono px-4 py-3 text-right text-red-700">{row.neverAssigned}</td>
                  <td className="nk-mono px-4 py-3 text-right text-amber-700">{row.dormant}</td>
                  <td className="nk-mono px-4 py-3 text-right">{row.unreachable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  )
}
