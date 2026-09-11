'use client'

/**
 * The audit trail, as a list of sentences rather than a table of columns.
 *
 * An audit row answers one question — who did what to which thing, and when — so
 * it reads better as that sentence than as six cells a reader has to reassemble.
 * The machine-readable bits (the raw action, the resource id, the address) stay
 * on the row for anybody who needs to quote them.
 *
 * One component, two pages: the tenant view and the platform view differ only in
 * whether a tenant column and filter appear, which the server tells us.
 */

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

interface Entry {
  id: string
  action: string
  actionLabel: string
  group: string
  resource: { kind: string; id: string | null }
  ip: string | null
  meta: unknown
  at: string
  actor: { id: string; name: string | null; email: string | null } | null
  tenant: { id: string; name: string } | null
}

interface GroupOption {
  key: string
  label: string
  help: string
}

interface Payload {
  scope: 'platform' | 'tenant'
  groups: string[]
  groupOptions: GroupOption[]
  defaultGroups: string[]
  entries: Entry[]
  nextCursor: string | null
}

const GROUP_TONE: Record<string, string> = {
  access: 'bg-rose-50 text-rose-700 border-rose-200',
  org: 'bg-cobalt-50 text-cobalt-700 border-cobalt-200',
  teams: 'bg-violet-50 text-violet-700 border-violet-200',
  tenancy: 'bg-amber-50 text-amber-800 border-amber-200',
  platform: 'bg-teal-50 text-teal-700 border-teal-200',
  sessions: 'bg-nickel-50 text-nickel-600 border-nickel-200',
  activity: 'bg-nickel-50 text-nickel-500 border-nickel-200',
}

/** "user:clx123" reads better as "user clx123" once the kind is known. */
function describeResource(resource: Entry['resource']) {
  if (!resource.id) return resource.kind
  return `${resource.kind.replace(/_/g, ' ')} ${resource.id}`
}

function when(value: string) {
  const at = new Date(value)
  return at.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AuditTrail({ platform = false }: { platform?: boolean }) {
  const { authFetch, isLoading: authLoading } = useAuth()

  const [data, setData] = useState<Payload | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams(extra)
      if (showAll) params.set('groups', 'all')
      if (applied) params.set('q', applied)
      return params.toString()
    },
    [showAll, applied]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await authFetch(`/api/audit?${query()}`)
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not load the audit trail.')
        return
      }
      setData(payload as Payload)
      setEntries(payload.entries)
    } catch {
      setError('Could not load the audit trail.')
    } finally {
      setLoading(false)
    }
  }, [authFetch, query])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  const loadMore = async () => {
    if (!data?.nextCursor) return
    setLoadingMore(true)
    try {
      const response = await authFetch(`/api/audit?${query({ cursor: data.nextCursor })}`)
      if (!response.ok) return
      const payload = (await response.json()) as Payload
      setEntries((current) => [...current, ...payload.entries])
      setData((current) => (current ? { ...current, nextCursor: payload.nextCursor } : payload))
    } finally {
      setLoadingMore(false)
    }
  }

  if (authLoading || loading) {
    return <p className="nk-sub mt-6">Reading the trail…</p>
  }
  if (error) {
    return <p className="nk-sub mt-6 text-red-700">{error}</p>
  }

  const shownGroups = (data?.groupOptions ?? []).filter((group) =>
    (data?.groups ?? []).includes(group.key)
  )

  return (
    <section className="nk-panel mt-6 overflow-hidden">
      <div className="nk-panel-head">
        <div>
          <h2 className="nk-title">What has been changed</h2>
          <p className="nk-sub">
            {showAll
              ? 'Everything recorded, including routine drafting and search activity.'
              : `Changes to access and structure: ${shownGroups.map((group) => group.label.toLowerCase()).join(', ')}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="nk-sub flex items-center gap-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => setShowAll(event.target.checked)}
            />
            Include product activity
          </label>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-2 border-b border-nickel-100 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied(search.trim())
        }}
      >
        <label className="block">
          <span className="nk-label">Find a thing that was changed</span>
          <input
            className="nk-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="a user id, a team id, a unit id"
          />
        </label>
        <button type="submit" className="nk-btn-secondary nk-btn-sm">
          Search
        </button>
        {applied ? (
          <button
            type="button"
            className="nk-btn-ghost nk-btn-sm"
            onClick={() => {
              setSearch('')
              setApplied('')
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {entries.length === 0 ? (
        <p className="nk-sub px-4 py-8 text-center">
          Nothing recorded{applied ? ' for that' : ' yet'}.
        </p>
      ) : (
        <ul className="divide-y divide-nickel-100">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${
                    GROUP_TONE[entry.group] || GROUP_TONE.activity
                  }`}
                >
                  {entry.group}
                </span>
                <span className="text-[14px] text-nickel-900">
                  <strong className="font-semibold">
                    {entry.actor?.name || entry.actor?.email || 'Somebody no longer on the system'}
                  </strong>{' '}
                  {entry.actionLabel}
                  {entry.resource.id || entry.resource.kind ? (
                    <>
                      {' — '}
                      <span className="nk-mono text-[12.5px]">{describeResource(entry.resource)}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <p className="nk-sub mt-0.5 text-[12px]">
                {when(entry.at)}
                {platform && entry.tenant ? ` · ${entry.tenant.name}` : ''}
                {entry.ip ? ` · from ${entry.ip}` : ''}
                <span className="nk-mono"> · {entry.action}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {data?.nextCursor ? (
        <div className="border-t border-nickel-100 px-4 py-3 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="nk-btn-secondary nk-btn-sm"
          >
            {loadingMore ? 'Loading…' : 'Show older'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
