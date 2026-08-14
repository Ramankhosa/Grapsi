'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { isFeatureEnabled } from '@/lib/feature-flags'
import InviteMembersPanel from '@/components/admin/InviteMembersPanel'
import {
  AlertTriangle,
  BarChart3,
  Ban,
  CheckCircle2,
  ChevronDown,
  Copy,
  GraduationCap,
  KeyRound,
  Loader2,
  LogOut,
  PauseCircle,
  Plus,
  Ticket,
  Users,
  X
} from 'lucide-react'

type LucideIcon = typeof Users

interface ATIToken {
  id: string
  fingerprint: string
  status: string
  expires_at: string | null
  max_uses: number | null
  usage_count: number
  plan_tier: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface SignupUser {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  roles: string[]
  created_at: string
   usage_metrics?: {
    patentsDrafted: number
    noveltySearches: number
    totalInputTokens: number
    totalOutputTokens: number
    tokensByModel: Array<{ model: string; inputTokens: number; outputTokens: number }>
    tokensByTask: Array<{ task: string; inputTokens: number; outputTokens: number }>
  }
}

interface PaperAnalytics {
  totalPapers: number
  papersThisMonth: number
  papersThisWeek: number
  averagePapersPerUser: number
  paperTypes: Array<{ type: string; count: number }>
  citationStyles: Array<{ style: string; count: number }>
  topVenues: Array<{ venue: string; count: number }>
}

interface PaperUserMetrics extends SignupUser {
  papersCount: number
  lastPaperActivity?: string
}

/** Status → badge modifier. Anything unmapped falls back to neutral nickel. */
const TOKEN_STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'nk-badge-ok',
  ISSUED: 'nk-badge-live',
  INACTIVE: '',
  SUSPENDED: 'nk-badge-warn',
  EXPIRED: 'nk-badge-warn',
  USED_UP: 'nk-badge-warn',
  REVOKED: 'nk-badge-danger'
}

/* ── One cell of a readout strip ──────────────────────────────────────────── */
function Metric({
  icon: Icon,
  label,
  value,
  caption,
  loading
}: {
  icon: LucideIcon
  label: string
  value: string | number
  caption?: string
  loading?: boolean
}) {
  return (
    // Negative offsets collapse each cell's border into its neighbour's, so the
    // strip reads as one ruled grid rather than a row of floating boxes.
    <div className="-ml-px -mt-px flex min-w-0 flex-col gap-3 border-l border-t border-nickel-200 p-5">
      <div className="flex items-center gap-2.5">
        <span className="nk-tile h-8 w-8">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="nk-eyebrow truncate">{label}</span>
      </div>
      {loading ? (
        <span className="h-7 w-16 animate-pulse rounded bg-nickel-100" aria-hidden />
      ) : (
        <span className="nk-readout">{value}</span>
      )}
      {caption && <span className="text-[12.5px] text-nickel-500">{caption}</span>}
    </div>
  )
}

export default function TenantAdminDashboard() {
  const { user, logout } = useAuth()
  const [tokens, setTokens] = useState<ATIToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [newToken, setNewToken] = useState({
    expires_at: '',
    max_uses: '',
    notes: ''
  })
  const [editingToken, setEditingToken] = useState<ATIToken | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [editForm, setEditForm] = useState({
    status: '',
    expires_at: '',
    max_uses: '',
    notes: ''
  })
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null)
  const [selectedTokenUsers, setSelectedTokenUsers] = useState<SignupUser[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

  // Paper analytics state
  const [paperAnalytics, setPaperAnalytics] = useState<PaperAnalytics | null>(null)
  const [paperUsers, setPaperUsers] = useState<PaperUserMetrics[]>([])
  const [isLoadingPapers, setIsLoadingPapers] = useState(false)

  useEffect(() => {
    fetchTokens()
    fetchPaperAnalytics()
  }, [])

  const fetchTokens = async () => {
    try {
      setError(null)
      const response = await fetch('/api/v1/admin/ati/list', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setTokens(data)
      } else {
        const errorData = await response.json().catch(() => ({}))
        setError(errorData.message || `Failed to load tokens (${response.status})`)
        setTokens([])
      }
    } catch (error) {
      console.error('Failed to fetch tokens:', error)
      setError('Network error: Unable to connect to server')
      setTokens([])
    } finally {
      setIsLoading(false)
    }
  }

  const fetchPaperAnalytics = async () => {
    setIsLoadingPapers(false)
  }

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)

    try {
      const response = await fetch('/api/v1/admin/ati/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          expires_at: newToken.expires_at || undefined,
          max_uses: newToken.max_uses ? parseInt(newToken.max_uses) : undefined,
          notes: newToken.notes || undefined
        })
      })

      if (response.ok) {
        const data = await response.json()
        setCreatedToken(data.token_display_once)
        setNewToken({ expires_at: '', max_uses: '', notes: '' })
        setShowCreateForm(false)
        fetchTokens()

        // Clear the displayed token after 30 seconds for security
        setTimeout(() => setCreatedToken(null), 30000)
      } else {
        const error = await response.json()
        alert(error.message || 'Failed to create token')
      }
    } catch (error) {
      console.error('Failed to create token:', error)
      alert('Failed to create token')
    } finally {
      setIsCreating(false)
    }
  }

  const handleRevokeToken = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this token? Users will no longer be able to use it.')) {
      return
    }

    try {
      const response = await fetch(`/api/v1/admin/ati/${tokenId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        fetchTokens()
      } else {
        alert('Failed to revoke token')
      }
    } catch (error) {
      console.error('Failed to revoke token:', error)
      alert('Failed to revoke token')
    }
  }

  const handleEditToken = (token: ATIToken) => {
    setEditingToken(token)
    setEditForm({
      status: token.status,
      expires_at: token.expires_at ? new Date(token.expires_at).toISOString().slice(0, 16) : '',
      max_uses: token.max_uses?.toString() || '',
      notes: token.notes || ''
    })
  }

  const handleUpdateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingToken) return

    setIsUpdating(true)

    try {
      const response = await fetch(`/api/v1/admin/ati/${editingToken.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          status: editForm.status || undefined,
          expires_at: editForm.expires_at || undefined,
          max_uses: editForm.max_uses ? parseInt(editForm.max_uses) : undefined,
          notes: editForm.notes || undefined
        })
      })

      if (response.ok) {
        setEditingToken(null)
        setEditForm({ status: '', expires_at: '', max_uses: '', notes: '' })
        fetchTokens()
      } else {
        const error = await response.json()
        alert(error.message || 'Failed to update token')
      }
    } catch (error) {
      console.error('Failed to update token:', error)
      alert('Failed to update token')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleViewUsers = async (token: ATIToken) => {
    if (selectedTokenId === token.id) {
      setSelectedTokenId(null)
      setSelectedTokenUsers([])
      setUsersError(null)
      return
    }

    setSelectedTokenId(token.id)
    setIsLoadingUsers(true)
    setUsersError(null)

    try {
      const response = await fetch(`/api/v1/admin/ati/${token.id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      const data = await response.json()

      if (response.ok) {
        setSelectedTokenUsers(data.signup_users || [])
      } else {
        setUsersError(data.message || 'Failed to load users for this token')
        setSelectedTokenUsers([])
      }
    } catch (error) {
      console.error('Failed to load token users:', error)
      setUsersError('Network error: Unable to load users for this token')
      setSelectedTokenUsers([])
    } finally {
      setIsLoadingUsers(false)
    }
  }

  const activeCount = tokens.filter(t => t.status === 'ACTIVE' || t.status === 'ISSUED').length
  const totalUsage = tokens.reduce((sum, t) => sum + t.usage_count, 0)
  const revokedCount = tokens.filter(t => t.status === 'REVOKED').length
  const suspendedCount = tokens.filter(t => t.status === 'SUSPENDED').length

  return (
    <div className="nk-ground nk-wash">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] nk-grid" aria-hidden />

      <header className="relative z-10 border-b border-nickel-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="nk-eyebrow">Workspace administration</p>
            <h1 className="mt-2 flex flex-wrap items-center gap-3 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-nickel-900">
              Access control
              {user?.ati_id && (
                <span className="nk-badge nk-badge-live translate-y-px">{user.ati_id}</span>
              )}
            </h1>
            <p className="mt-1.5 text-[13.5px] text-nickel-500">
              Invite members, issue access tokens, and see who is using them
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => (window.location.href = '/tenant-admin/analytics')}
              className="nk-btn-secondary nk-btn-sm"
            >
              <BarChart3 className="h-4 w-4 text-nickel-400" aria-hidden />
              Analytics
            </button>
            <button onClick={() => logout()} className="nk-btn-ghost nk-btn-sm">
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Load failure */}
        {error && (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-[13.5px] font-semibold text-red-900">Could not load access tokens</h2>
              <p className="mt-1 text-[13px] leading-5 text-red-800">{error}</p>
              <button onClick={fetchTokens} className="nk-btn-secondary nk-btn-sm mt-3">
                Try again
              </button>
            </div>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-400 transition hover:bg-red-100 hover:text-red-700"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {/* One-time token handoff */}
        {createdToken && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="nk-eyebrow text-amber-800">Token created — shown once</h2>
                <p className="mt-2.5 break-all rounded-md border border-amber-200 bg-white p-3 font-mono text-[12.5px] leading-5 text-nickel-900">
                  {createdToken}
                </p>
                <p className="mt-2 text-[12.5px] leading-5 text-amber-900">
                  Copy it now and share it securely with your team. It will never be displayed again.
                </p>
                <button
                  onClick={() => navigator.clipboard.writeText(createdToken)}
                  className="nk-btn-secondary nk-btn-sm mt-3"
                >
                  <Copy className="h-3.5 w-3.5 text-nickel-400" aria-hidden />
                  Copy to clipboard
                </button>
              </div>
              <button
                onClick={() => setCreatedToken(null)}
                aria-label="Dismiss token"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-amber-500 transition hover:bg-amber-100 hover:text-amber-800"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        )}

        {/* Readouts */}
        <section className="nk-panel grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            icon={CheckCircle2}
            label="Active tokens"
            value={activeCount}
            caption="Usable right now"
            loading={isLoading}
          />
          <Metric
            icon={Users}
            label="Total usage"
            value={totalUsage}
            caption="Redemptions to date"
            loading={isLoading}
          />
          <Metric
            icon={Ban}
            label="Revoked"
            value={revokedCount}
            caption="Manually withdrawn"
            loading={isLoading}
          />
          <Metric
            icon={PauseCircle}
            label="Suspended"
            value={suspendedCount}
            caption="Temporarily paused"
            loading={isLoading}
          />
          <Metric
            icon={Ticket}
            label="Total issued"
            value={tokens.length}
            caption="All time"
            loading={isLoading}
          />
        </section>

        {/* Paper analytics (when feature enabled) */}
        {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && (
          <>
            <section className="nk-panel grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-5">
              <Metric
                icon={BarChart3}
                label="Total papers"
                value={paperAnalytics?.totalPapers || 0}
                loading={isLoadingPapers}
              />
              <Metric
                icon={BarChart3}
                label="This month"
                value={paperAnalytics?.papersThisMonth || 0}
                loading={isLoadingPapers}
              />
              <Metric
                icon={BarChart3}
                label="This week"
                value={paperAnalytics?.papersThisWeek || 0}
                loading={isLoadingPapers}
              />
              <Metric
                icon={BarChart3}
                label="Avg per user"
                value={(paperAnalytics?.averagePapersPerUser || 0).toFixed(1)}
                loading={isLoadingPapers}
              />
              <Metric
                icon={BarChart3}
                label="Paper types"
                value={paperAnalytics?.paperTypes?.length || 0}
                loading={isLoadingPapers}
              />
            </section>

            {paperAnalytics && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="nk-panel overflow-hidden">
                  <div className="nk-panel-head">
                    <h2 className="nk-title text-[14px]">Paper types distribution</h2>
                  </div>
                  <div className="p-5">
                    {paperAnalytics.paperTypes?.length ? (
                      <ul className="space-y-2.5">
                        {paperAnalytics.paperTypes.slice(0, 5).map(type => (
                          <li key={type.type} className="flex items-center justify-between gap-3">
                            <span className="truncate text-[13px] text-nickel-700">{type.type}</span>
                            <span className="nk-mono shrink-0 text-nickel-900">{type.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[13px] text-nickel-500">No paper types data available</p>
                    )}
                  </div>
                </section>

                <section className="nk-panel overflow-hidden">
                  <div className="nk-panel-head">
                    <h2 className="nk-title text-[14px]">Citation styles usage</h2>
                  </div>
                  <div className="p-5">
                    {paperAnalytics.citationStyles?.length ? (
                      <ul className="space-y-2.5">
                        {paperAnalytics.citationStyles.slice(0, 5).map(style => (
                          <li key={style.style} className="flex items-center justify-between gap-3">
                            <span className="truncate text-[13px] text-nickel-700">{style.style}</span>
                            <span className="nk-mono shrink-0 text-nickel-900">{style.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[13px] text-nickel-500">No citation styles data available</p>
                    )}
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {/* How seeded people sign in — the roster + first-login path (no emails) */}
        <section className="nk-panel overflow-hidden">
          <div className="nk-panel-head">
            <div className="flex min-w-0 items-center gap-3">
              <span className="nk-tile nk-tile-live h-9 w-9">
                <KeyRound className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="nk-title text-[14px]">How your team signs in</h2>
                <p className="nk-sub text-[12.5px]">
                  Roster-seeded people activate themselves — no invitation emails to send.
                </p>
              </div>
            </div>
          </div>
          <div className="p-5 text-[13px] text-nickel-700">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Upload your roster in{' '}
                <a
                  href="/tenant-admin/faculty"
                  className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800"
                >
                  Faculty &amp; Organization
                </a>
                , including an <strong>Employee ID</strong> for everyone.
              </li>
              <li>
                Tell your team to open{' '}
                <code className="rounded bg-nickel-100 px-1 py-0.5 text-[12px]">/set-password</code> and enter
                their <strong>work email + Employee ID</strong>.
              </li>
              <li>They choose a password and are signed in — done.</li>
            </ol>
            <p className="mt-3 text-[12px] text-nickel-500">
              Anyone without an Employee ID can’t self-activate; the Faculty list flags them as “No ID”.
              Prefer email invitations for one-off external people — use the panel below.
            </p>
            <a href="/tenant-admin/faculty" className="nk-btn-primary nk-btn-sm mt-4 inline-flex">
              <GraduationCap className="h-4 w-4" aria-hidden />
              Upload / manage faculty roster
            </a>
          </div>
        </section>

        {/* Invite members (email invites — the default way to add people) */}
        <InviteMembersPanel />

        {/* Issue a token */}
        <section className="nk-panel overflow-hidden">
          <div className="nk-panel-head">
            <div className="min-w-0">
              <h2 className="nk-title text-[14px]">Access codes</h2>
              <p className="nk-sub text-[12.5px]">
                For bulk onboarding — a shared code people redeem at signup
              </p>
            </div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              aria-expanded={showCreateForm}
              className={showCreateForm ? 'nk-btn-secondary nk-btn-sm' : 'nk-btn-primary nk-btn-sm'}
            >
              {showCreateForm ? (
                <>
                  <X className="h-4 w-4" aria-hidden />
                  Cancel
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" aria-hidden />
                  Generate code
                </>
              )}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateToken} className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="expires_at" className="nk-label mb-1.5">
                    Expires <span className="font-normal text-nickel-500">(optional)</span>
                  </label>
                  <input
                    type="datetime-local"
                    id="expires_at"
                    value={newToken.expires_at}
                    onChange={e => setNewToken(prev => ({ ...prev, expires_at: e.target.value }))}
                    className="nk-input"
                  />
                </div>
                <div>
                  <label htmlFor="max_uses" className="nk-label mb-1.5">
                    Max uses <span className="font-normal text-nickel-500">(optional)</span>
                  </label>
                  <input
                    type="number"
                    id="max_uses"
                    value={newToken.max_uses}
                    onChange={e => setNewToken(prev => ({ ...prev, max_uses: e.target.value }))}
                    className="nk-input"
                    placeholder="Unlimited"
                    min="1"
                  />
                </div>
                <div>
                  <label htmlFor="notes" className="nk-label mb-1.5">
                    Notes <span className="font-normal text-nickel-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    id="notes"
                    value={newToken.notes}
                    onChange={e => setNewToken(prev => ({ ...prev, notes: e.target.value }))}
                    className="nk-input"
                    placeholder="Purpose or recipient"
                  />
                </div>
              </div>
              <div className="nk-rule flex justify-end gap-2.5 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false)
                    setNewToken({ expires_at: '', max_uses: '', notes: '' })
                  }}
                  className="nk-btn-secondary nk-btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isCreating} className="nk-btn-primary nk-btn-sm">
                  {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  {isCreating ? 'Generating…' : 'Generate code'}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Edit a token */}
        {editingToken && (
          <section className="nk-panel overflow-hidden">
            <div className="nk-panel-head">
              <div className="flex min-w-0 items-center gap-3">
                <span className="nk-tile nk-tile-live h-9 w-9">
                  <KeyRound className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="nk-title text-[14px]">Edit access code</h2>
                  <p className="nk-mono truncate text-nickel-500">{editingToken.fingerprint}</p>
                </div>
              </div>
              <button onClick={() => setEditingToken(null)} className="nk-btn-ghost nk-btn-sm">
                <X className="h-4 w-4" aria-hidden />
                Cancel
              </button>
            </div>

            <form onSubmit={handleUpdateToken} className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="edit_status" className="nk-label mb-1.5">Status</label>
                  <select
                    id="edit_status"
                    value={editForm.status}
                    onChange={e => setEditForm(prev => ({ ...prev, status: e.target.value }))}
                    className="nk-select"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="SUSPENDED">Suspended</option>
                    <option value="ISSUED">Issued</option>
                    <option value="REVOKED">Revoked</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="USED_UP">Used Up</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit_expires_at" className="nk-label mb-1.5">
                    Expires <span className="font-normal text-nickel-500">(optional)</span>
                  </label>
                  <input
                    type="datetime-local"
                    id="edit_expires_at"
                    value={editForm.expires_at}
                    onChange={e => setEditForm(prev => ({ ...prev, expires_at: e.target.value }))}
                    className="nk-input"
                  />
                </div>
                <div>
                  <label htmlFor="edit_max_uses" className="nk-label mb-1.5">
                    Max uses <span className="font-normal text-nickel-500">(optional)</span>
                  </label>
                  <input
                    type="number"
                    id="edit_max_uses"
                    value={editForm.max_uses}
                    onChange={e => setEditForm(prev => ({ ...prev, max_uses: e.target.value }))}
                    className="nk-input"
                    placeholder="Unlimited"
                    min="1"
                  />
                </div>
                <div>
                  <label htmlFor="edit_notes" className="nk-label mb-1.5">
                    Notes <span className="font-normal text-nickel-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    id="edit_notes"
                    value={editForm.notes}
                    onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                    className="nk-input"
                    placeholder="Purpose or recipient"
                  />
                </div>
              </div>
              <div className="nk-rule flex justify-end gap-2.5 pt-4">
                <button type="button" onClick={() => setEditingToken(null)} className="nk-btn-secondary nk-btn-sm">
                  Cancel
                </button>
                <button type="submit" disabled={isUpdating} className="nk-btn-primary nk-btn-sm">
                  {isUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  {isUpdating ? 'Updating…' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Token list */}
        <section className="nk-panel overflow-hidden">
          <div className="nk-panel-head">
            <div className="flex min-w-0 items-center gap-3">
              <span className="nk-tile h-9 w-9">
                <Ticket className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="nk-title text-[14px]">Issued access codes</h2>
                <p className="nk-sub text-[12.5px]">Every code created for this workspace</p>
              </div>
            </div>
          </div>

          {isLoading ? (
            // Skeletons match the row layout so nothing shifts when data lands.
            <ul className="divide-y divide-nickel-100" aria-label="Loading access codes">
              {[0, 1, 2].map(i => (
                <li key={i} className="space-y-2 px-5 py-4">
                  <span className="block h-3.5 w-32 animate-pulse rounded bg-nickel-100" />
                  <span className="block h-3 w-64 animate-pulse rounded bg-nickel-100" />
                </li>
              ))}
            </ul>
          ) : tokens.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <span className="nk-tile mx-auto h-12 w-12">
                <Ticket className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="nk-title mt-4 text-[14px]">No access codes yet</h3>
              <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-5 text-nickel-500">
                Email invites above are the easier path for most teams. Generate a code when you need
                to onboard a whole cohort at once.
              </p>
              <button onClick={() => setShowCreateForm(true)} className="nk-btn-primary mt-5">
                <Plus className="h-4 w-4" aria-hidden />
                Generate code
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-nickel-100">
              {tokens.map(token => {
                const isOpen = selectedTokenId === token.id
                const usagePct =
                  token.max_uses && token.max_uses > 0
                    ? Math.min(100, Math.round((token.usage_count / token.max_uses) * 100))
                    : null

                return (
                  <li key={token.id} className="px-5 py-4 transition-colors hover:bg-nickel-50">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="nk-mono font-semibold text-nickel-900">{token.fingerprint}</span>
                          <span className={`nk-badge ${TOKEN_STATUS_BADGE[token.status] ?? ''}`}>
                            {token.status.replace(/_/g, ' ')}
                          </span>
                          {token.plan_tier && <span className="nk-badge">{token.plan_tier}</span>}
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-nickel-500">
                          <span>
                            <span className="nk-mono text-nickel-700">{token.usage_count}</span>
                            {token.max_uses ? (
                              <>
                                /<span className="nk-mono text-nickel-700">{token.max_uses}</span> uses
                              </>
                            ) : (
                              ' uses'
                            )}
                          </span>
                          <span className="text-nickel-300" aria-hidden>·</span>
                          <span>created {new Date(token.created_at).toLocaleDateString()}</span>
                          {token.expires_at && (
                            <>
                              <span className="text-nickel-300" aria-hidden>·</span>
                              <span>expires {new Date(token.expires_at).toLocaleDateString()}</span>
                            </>
                          )}
                        </div>

                        {usagePct !== null && (
                          <div className="nk-meter mt-2.5 max-w-[220px]">
                            <div className="nk-meter-fill" style={{ width: `${usagePct}%` }} />
                          </div>
                        )}

                        {token.notes && (
                          <p className="mt-2 truncate text-[12.5px] text-nickel-500">{token.notes}</p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button onClick={() => handleEditToken(token)} className="nk-btn-secondary nk-btn-xs">
                          Edit
                        </button>
                        <button
                          onClick={() => handleViewUsers(token)}
                          aria-expanded={isOpen}
                          className="nk-btn-secondary nk-btn-xs"
                        >
                          Users
                          <ChevronDown
                            className={`h-3 w-3 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                            aria-hidden
                          />
                        </button>
                        {(token.status === 'ISSUED' || token.status === 'ACTIVE') && (
                          <button onClick={() => handleRevokeToken(token.id)} className="nk-btn-danger nk-btn-xs">
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="nk-panel-quiet mt-3 p-4">
                        <h3 className="nk-eyebrow mb-2.5">Joined with this code</h3>
                        {isLoadingUsers ? (
                          <p className="text-[12.5px] text-nickel-500">Loading members…</p>
                        ) : usersError ? (
                          <p className="text-[12.5px] text-red-700">{usersError}</p>
                        ) : selectedTokenUsers.length === 0 ? (
                          <p className="text-[12.5px] text-nickel-500">
                            Nobody has redeemed this code yet.
                          </p>
                        ) : (
                          <ul className="divide-y divide-nickel-200">
                            {selectedTokenUsers.map(member => {
                              const name = [member.first_name, member.last_name]
                                .filter(Boolean)
                                .join(' ')
                                .trim()
                              const m = member.usage_metrics
                              return (
                                <li
                                  key={member.id}
                                  className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-[13px] font-medium text-nickel-800">
                                      {name || member.email}
                                    </div>
                                    <div className="truncate text-[12px] text-nickel-500">{member.email}</div>
                                    {m && (
                                      <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px] text-nickel-500">
                                        <span>
                                          Patents <span className="nk-mono text-nickel-600">{m.patentsDrafted}</span>
                                        </span>
                                        <span>
                                          Novelty <span className="nk-mono text-nickel-600">{m.noveltySearches}</span>
                                        </span>
                                        <span>
                                          Tokens in/out{' '}
                                          <span className="nk-mono text-nickel-600">
                                            {m.totalInputTokens}/{m.totalOutputTokens}
                                          </span>
                                        </span>
                                      </div>
                                    )}
                                    {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && 'papersCount' in member && (
                                      <div className="mt-1 text-[11.5px] text-nickel-500">
                                        Papers{' '}
                                        <span className="nk-mono text-nickel-600">
                                          {(member as PaperUserMetrics).papersCount}
                                        </span>
                                        {(member as PaperUserMetrics).lastPaperActivity && (
                                          <>
                                            {' · last '}
                                            {new Date(
                                              (member as PaperUserMetrics).lastPaperActivity!
                                            ).toLocaleDateString()}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <span className="nk-mono shrink-0 text-nickel-500">
                                    {new Date(member.created_at).toLocaleDateString()}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
