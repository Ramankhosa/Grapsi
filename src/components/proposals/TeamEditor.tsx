'use client'

import { useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { TEAM_ROLES, TEAM_ROLE_LABELS, type TeamRole } from '@/lib/proposals/shared'

/**
 * Who is on the application.
 *
 * The PI row is fixed: moving it would move the proposal between schools,
 * officers and dashboards, which is a real operation and not a row edit.
 * Everyone else can be internal (searched from the tenant, so they can open the
 * proposal and read the shared review) or simply named.
 */

export interface TeamMember {
  id?: string
  userId: string | null
  name: string
  email: string | null
  affiliation: string | null
  role: TeamRole | string
  isExternal: boolean
}

interface Candidate {
  id: string
  name: string | null
  email: string | null
  school?: string | null
}

export default function TeamEditor({
  proposalId,
  team,
  canEdit,
  onChanged,
}: {
  proposalId: string
  team: TeamMember[]
  canEdit: boolean
  onChanged: () => void | Promise<void>
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [rows, setRows] = useState<TeamMember[]>(team)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => setRows(team), [team])

  useEffect(() => {
    if (!canEdit || query.trim().length < 2) {
      setCandidates([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const response = await authFetch(
          `/api/tenant-admin/faculty?person=${encodeURIComponent(query.trim())}&limit=8`
        )
        const data = await response.json().catch(() => ({}))
        if (!cancelled && response.ok) {
          setCandidates(
            (data.faculty || data.profiles || []).map((row: any) => ({
              id: row.userId || row.user_id || row.id,
              name: row.name || row.displayName || null,
              email: row.email || null,
              school: row.school || null,
            }))
          )
        }
      } catch {
        if (!cancelled) setCandidates([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, canEdit, authFetch])

  function update(index: number, patch: Partial<TeamMember>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function remove(index: number) {
    setRows((current) => current.filter((_, i) => i !== index))
  }

  function addInternal(candidate: Candidate) {
    if (rows.some((row) => row.userId === candidate.id)) {
      showToast({ type: 'info', title: 'Already on the team' })
      return
    }
    setRows((current) => [
      ...current,
      {
        userId: candidate.id,
        name: candidate.name || candidate.email || 'Colleague',
        email: candidate.email,
        affiliation: null,
        role: 'CO_PI',
        isExternal: false,
      },
    ])
    setQuery('')
    setCandidates([])
  }

  function addExternal() {
    setRows((current) => [
      ...current,
      { userId: null, name: '', email: null, affiliation: null, role: 'COLLABORATOR', isExternal: true },
    ])
  }

  async function save() {
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/team`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          members: rows.map((row) => ({
            userId: row.userId,
            name: row.name,
            email: row.email,
            affiliation: row.affiliation,
            role: row.role,
            isExternal: row.isExternal,
          })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not save the team.')
      showToast({ type: 'success', title: 'Team saved' })
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not save', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) {
    return (
      <ul className="space-y-2">
        {team.map((member, index) => (
          <li key={member.id || index} className="nk-panel-quiet flex flex-wrap items-baseline gap-x-3 p-3">
            <span className="nk-title text-sm">{member.name}</span>
            <span className="nk-badge">{TEAM_ROLE_LABELS[member.role as TeamRole] || member.role}</span>
            {member.affiliation && <span className="nk-hint text-xs">{member.affiliation}</span>}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {rows.map((member, index) => {
          const isPi = member.role === 'PI'
          return (
            <li key={member.id || `${member.userId}-${index}`} className="nk-panel-quiet p-3">
              <div className="grid gap-2 sm:grid-cols-12 sm:items-center">
                <input
                  className="nk-input sm:col-span-4"
                  value={member.name}
                  placeholder="Name"
                  disabled={isPi || !member.isExternal}
                  onChange={(event) => update(index, { name: event.target.value })}
                />
                <select
                  className="nk-select sm:col-span-3"
                  value={member.role}
                  disabled={isPi}
                  onChange={(event) => update(index, { role: event.target.value as TeamRole })}
                >
                  {TEAM_ROLES.filter((role) => role !== 'PI' || isPi).map((role) => (
                    <option key={role} value={role}>
                      {TEAM_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <input
                  className="nk-input sm:col-span-4"
                  value={member.affiliation || ''}
                  placeholder={member.isExternal ? 'Institution' : 'Internal'}
                  disabled={!member.isExternal}
                  onChange={(event) => update(index, { affiliation: event.target.value })}
                />
                <div className="sm:col-span-1 sm:text-right">
                  {!isPi && (
                    <button
                      type="button"
                      className="nk-btn-ghost nk-btn-xs"
                      onClick={() => remove(index)}
                      aria-label={`Remove ${member.name || 'member'}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              {isPi && (
                <p className="nk-hint mt-2 text-xs">
                  The principal investigator is fixed. Ask the funding department to move a proposal to
                  someone else.
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="nk-panel-quiet p-3">
        <label className="nk-label">Add a colleague from your institution</label>
        <input
          className="nk-input mt-1 w-full"
          value={query}
          placeholder="Search by name, email or employee ID"
          onChange={(event) => setQuery(event.target.value)}
        />
        {searching && <p className="nk-hint mt-2 text-xs">Searching…</p>}
        {candidates.length > 0 && (
          <ul className="mt-2 space-y-1">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="nk-btn-ghost nk-btn-xs w-full justify-start text-left"
                  onClick={() => addInternal(candidate)}
                >
                  {candidate.name || candidate.email}
                  {candidate.school ? ` · ${candidate.school}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="nk-btn-secondary nk-btn-xs mt-3" onClick={addExternal}>
          Add an external collaborator
        </button>
      </div>

      <button type="button" className="nk-btn-primary nk-btn-sm" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save team'}
      </button>
    </div>
  )
}
