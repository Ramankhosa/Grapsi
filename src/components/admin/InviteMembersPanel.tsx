'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, MailPlus, TriangleAlert } from 'lucide-react'

interface TenantInvite {
  id: string
  email: string
  role: string
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
  expires_at: string
  accepted_at: string | null
  created_at: string
  invited_by: string | null
}

const ROLE_OPTIONS = [
  { value: 'ANALYST', label: 'Analyst — standard member' },
  { value: 'MANAGER', label: 'Manager — manages teams' },
  { value: 'ADMIN', label: 'Admin — full workspace admin' }
]

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
}

export default function InviteMembersPanel() {
  const [invites, setInvites] = useState<TenantInvite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('ANALYST')
  const [isSending, setIsSending] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const fetchInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/invites', { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setInvites(data.invites || [])
      }
    } catch (err) {
      console.error('Failed to load invites:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSending(true)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ invites: [{ email: email.trim(), role }] })
      })
      const data = await res.json()
      if (res.ok && data.sent > 0) {
        setNotice({ kind: 'ok', text: `Invitation sent to ${email.trim()}` })
        setEmail('')
        fetchInvites()
      } else {
        const firstError = data.results?.[0]?.error || data.message || 'Failed to send invite'
        setNotice({ kind: 'error', text: firstError })
      }
    } catch (err) {
      console.error('Failed to send invite:', err)
      setNotice({ kind: 'error', text: 'Network error: unable to send invite' })
    } finally {
      setIsSending(false)
    }
  }

  const handleResend = async (invite: TenantInvite) => {
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/invites/${invite.id}`, {
        method: 'POST',
        headers: authHeaders()
      })
      if (res.ok) {
        setNotice({ kind: 'ok', text: `Invitation re-sent to ${invite.email}` })
      } else {
        const data = await res.json().catch(() => ({}))
        setNotice({ kind: 'error', text: data.message || 'Failed to resend invite' })
      }
    } catch {
      setNotice({ kind: 'error', text: 'Network error: unable to resend invite' })
    }
  }

  const handleRevoke = async (invite: TenantInvite) => {
    if (!confirm(`Revoke the invitation for ${invite.email}? Their invite link will stop working.`)) return
    try {
      const res = await fetch(`/api/v1/admin/invites/${invite.id}`, {
        method: 'DELETE',
        headers: authHeaders()
      })
      if (res.ok) fetchInvites()
    } catch (err) {
      console.error('Failed to revoke invite:', err)
    }
  }

  const statusBadge = (status: TenantInvite['status'], expiresAt: string) => {
    const expired = status === 'PENDING' && new Date(expiresAt) < new Date()
    const effective = expired ? 'EXPIRED' : status
    const styles: Record<string, string> = {
      PENDING: 'nk-badge-live',
      ACCEPTED: 'nk-badge-ok',
      REVOKED: 'nk-badge-danger',
      EXPIRED: 'nk-badge-warn'
    }
    return <span className={`nk-badge ${styles[effective] ?? ''}`}>{effective}</span>
  }

  return (
    <section className="nk-panel overflow-hidden">
      <div className="nk-panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="nk-tile nk-tile-live h-9 w-9">
            <MailPlus className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="nk-title text-[14px]">Invite team members</h2>
            <p className="nk-sub text-[12.5px]">
              A personal invite link by email — no codes to pass around. Expires after 14 days.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5">
        <form onSubmit={handleSend} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="invite_email" className="nk-label mb-1.5">
              Email address
            </label>
            <input
              type="email"
              id="invite_email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="nk-input"
              placeholder="colleague@university.edu"
            />
          </div>
          <div className="sm:w-64">
            <label htmlFor="invite_role" className="nk-label mb-1.5">
              Role
            </label>
            <select
              id="invite_role"
              value={role}
              onChange={e => setRole(e.target.value)}
              className="nk-select"
            >
              {ROLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={isSending || !email.trim()} className="nk-btn-primary">
            {isSending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {isSending ? 'Sending…' : 'Send invite'}
          </button>
        </form>

        {notice && (
          <p
            role="status"
            className={`mt-3 flex items-center gap-2 text-[13px] ${
              notice.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {notice.kind === 'ok' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {notice.text}
          </p>
        )}
      </div>

      {isLoading ? (
        <ul className="nk-rule divide-y divide-nickel-100" aria-label="Loading invitations">
          {[0, 1].map(i => (
            <li key={i} className="space-y-2 px-5 py-3">
              <span className="block h-3.5 w-48 animate-pulse rounded bg-nickel-100" />
              <span className="block h-3 w-32 animate-pulse rounded bg-nickel-100" />
            </li>
          ))}
        </ul>
      ) : invites.length === 0 ? (
        <p className="nk-rule px-5 py-4 text-[13px] text-nickel-500">
          No invitations sent yet.
        </p>
      ) : (
        <ul className="nk-rule divide-y divide-nickel-100">
          {invites.map(invite => (
            <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-nickel-900">{invite.email}</span>
                  {statusBadge(invite.status, invite.expires_at)}
                </div>
                <div className="mt-0.5 text-[12px] text-nickel-500">
                  {invite.role.charAt(0) + invite.role.slice(1).toLowerCase()}
                  {invite.invited_by ? ` · invited by ${invite.invited_by}` : ''}
                  {invite.status === 'PENDING'
                    ? ` · expires ${new Date(invite.expires_at).toLocaleDateString()}`
                    : invite.accepted_at
                      ? ` · joined ${new Date(invite.accepted_at).toLocaleDateString()}`
                      : ''}
                </div>
              </div>
              {invite.status === 'PENDING' && new Date(invite.expires_at) > new Date() && (
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => handleResend(invite)} className="nk-btn-secondary nk-btn-xs">
                    Resend
                  </button>
                  <button onClick={() => handleRevoke(invite)} className="nk-btn-danger nk-btn-xs">
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
