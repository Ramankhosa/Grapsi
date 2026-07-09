'use client'

import { useCallback, useEffect, useState } from 'react'

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
      PENDING: 'bg-blue-100 text-blue-800',
      ACCEPTED: 'bg-green-100 text-green-800',
      REVOKED: 'bg-red-100 text-red-800',
      EXPIRED: 'bg-yellow-100 text-yellow-800'
    }
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[effective]}`}>
        {effective}
      </span>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg mb-8">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Invite Team Members</h3>
        <p className="mt-1 text-sm text-gray-500">
          Send a personal invite link by email — no access codes to copy around. Invites expire after 14 days.
        </p>

        <form onSubmit={handleSend} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="invite_email" className="block text-sm font-medium text-gray-700">
              Email address
            </label>
            <input
              type="email"
              id="invite_email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="colleague@university.edu"
            />
          </div>
          <div className="sm:w-64">
            <label htmlFor="invite_role" className="block text-sm font-medium text-gray-700">
              Role
            </label>
            <select
              id="invite_role"
              value={role}
              onChange={e => setRole(e.target.value)}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              {ROLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={isSending || !email.trim()}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSending ? 'Sending…' : 'Send Invite'}
          </button>
        </form>

        {notice && (
          <p className={`mt-3 text-sm ${notice.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
            {notice.text}
          </p>
        )}

        <div className="mt-6">
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading invites…</p>
          ) : invites.length === 0 ? (
            <p className="text-sm text-gray-500">No invitations sent yet.</p>
          ) : (
            <ul className="divide-y divide-gray-200 border-t border-gray-200">
              {invites.map(invite => (
                <li key={invite.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{invite.email}</span>
                      {statusBadge(invite.status, invite.expires_at)}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
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
                      <button
                        onClick={() => handleResend(invite)}
                        className="inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        Resend
                      </button>
                      <button
                        onClick={() => handleRevoke(invite)}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
