'use client'

import { ExternalLink, ShieldCheck, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

/** The preset that grants `funding.operations.write` — the operator level. */
const OPERATOR_ROLE = 'FUNDING_OPERATIONS_MANAGER'
/** Publishers can operate too; shown as access, but granted from Team Roles. */
const PUBLISHER_ROLE = 'FUNDING_PUBLISHER'

type PlatformUser = {
  id: string
  email: string
  name: string | null
  status: string
  roles: string[]
  tenantName: string | null
  assignedRoleCodes: string[]
}

/**
 * Who can work the funding watch list, managed in place.
 *
 * This reuses the platform team-role endpoints rather than storing access of
 * its own — Team Roles stays the single source of truth, and this panel is
 * just the funding-shaped view of it. Assignment is a full replace server-side,
 * so granting merges into the user's existing roles instead of clobbering them.
 */
export default function MonitorOperators({ authedFetch }: { authedFetch: AuthedFetch }) {
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await authedFetch('/api/super-admin/team-roles/users')
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? 'Only a super admin can manage who operates source monitoring.'
            : 'Could not load platform users.'
        )
      }
      const data = await response.json()
      setUsers(data.users ?? [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load platform users.')
    } finally {
      setLoading(false)
    }
  }, [authedFetch])

  useEffect(() => {
    void load()
  }, [load])

  function accessOf(user: PlatformUser): 'operator' | 'implicit' | 'none' {
    if (
      user.assignedRoleCodes.includes(OPERATOR_ROLE) ||
      user.assignedRoleCodes.includes(PUBLISHER_ROLE)
    ) {
      return 'operator'
    }
    // Super admins can always operate, with or without an explicit role row.
    if (user.roles.includes('SUPER_ADMIN')) return 'implicit'
    return 'none'
  }

  async function setOperator(user: PlatformUser, grant: boolean) {
    setBusyUserId(user.id)
    setError(null)
    setNotice(null)
    try {
      // Merge, never replace: the endpoint overwrites the whole role set, so
      // sending only this role would silently strip a user's other roles.
      const next = new Set(user.assignedRoleCodes)
      if (grant) next.add(OPERATOR_ROLE)
      else {
        next.delete(OPERATOR_ROLE)
        next.delete(PUBLISHER_ROLE)
      }

      const response = await authedFetch(`/api/super-admin/team-roles/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ roleCodes: Array.from(next) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not update access')

      setNotice(
        grant
          ? `${user.name || user.email} can now manage funding sources.`
          : `Removed source-monitoring access from ${user.name || user.email}.`
      )
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update access')
    } finally {
      setBusyUserId(null)
    }
  }

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? users.filter(
        (user) =>
          user.email.toLowerCase().includes(needle) ||
          (user.name ?? '').toLowerCase().includes(needle)
      )
    : users

  const operators = visible.filter((user) => accessOf(user) !== 'none')
  const others = visible.filter((user) => accessOf(user) === 'none')

  if (loading) {
    return <p className="cb-hint">Loading operators…</p>
  }

  function row(user: PlatformUser) {
    const access = accessOf(user)
    return (
      <div
        key={user.id}
        className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-0"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{user.name || user.email}</span>
            {access === 'operator' && (
              <span className="cb-badge-cobalt">
                <ShieldCheck className="h-3 w-3" /> Operator
              </span>
            )}
            {access === 'implicit' && <span className="cb-badge">Super admin — always has access</span>}
            {user.status !== 'ACTIVE' && <span className="cb-badge">{user.status}</span>}
          </div>
          <div className="text-[12px] text-muted">
            {user.email}
            {user.tenantName ? ` · ${user.tenantName}` : ''}
          </div>
        </div>
        {access === 'implicit' ? (
          <span className="text-[12px] text-muted">Comes with the super-admin role</span>
        ) : access === 'operator' ? (
          <button
            className="cb-btn-danger cb-btn-sm"
            disabled={busyUserId === user.id}
            onClick={() => setOperator(user, false)}
          >
            {busyUserId === user.id ? 'Removing…' : 'Remove access'}
          </button>
        ) : (
          <button
            className="cb-btn-secondary cb-btn-sm"
            disabled={busyUserId === user.id}
            onClick={() => setOperator(user, true)}
          >
            <UserPlus className="h-3.5 w-3.5" />
            {busyUserId === user.id ? 'Granting…' : 'Make operator'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="cb-card p-5">
        <p className="cb-title">Who can manage funding sources</p>
        <p className="cb-hint mt-1">
          Operators add and edit watched pages, run checks, and confirm finds into the funding
          catalog. Granting access here assigns the <strong>Funding Operations Manager</strong>{' '}
          platform role, the same one Team Roles manages — this is just the funding-shaped view
          of it.
        </p>
        <p className="cb-hint mt-2">
          Only platform users appear below. To bring in someone new, create their account first
          in{' '}
          <a
            className="inline-flex items-center gap-0.5 text-cobalt-700 hover:underline"
            href="/super-admin/users"
          >
            Users &amp; Roles <ExternalLink className="h-3 w-3" />
          </a>
          , then make them an operator here.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-cobalt-100 bg-cobalt-50 p-3 text-[13px] text-cobalt-700">
          {notice}
        </div>
      )}

      <input
        className="cb-input"
        placeholder="Search platform users by name or email"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="cb-card">
        <p className="cb-eyebrow border-b border-hairline px-4 py-2.5">
          Current access — {operators.length}
        </p>
        {operators.length === 0 ? (
          <p className="cb-hint p-4">Nobody yet. Grant access below.</p>
        ) : (
          operators.map(row)
        )}
      </div>

      <div className="cb-card">
        <p className="cb-eyebrow border-b border-hairline px-4 py-2.5">
          Other platform users — {others.length}
        </p>
        {others.length === 0 ? (
          <p className="cb-hint p-4">
            No other platform users. Create one in Users &amp; Roles first.
          </p>
        ) : (
          others.map(row)
        )}
      </div>
    </div>
  )
}
