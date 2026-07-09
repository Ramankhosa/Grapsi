'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'

interface ATIToken {
  id: string
  fingerprint: string
  status: string
  expires_at: string | null
  max_uses: number | null
  usage_count: number
  plan_tier: string | null
  notes: string | null
  kind?: 'STANDARD' | 'MANAGED' | 'EVENT'
  member_access_hours?: number | null
  access_ends_at?: string | null
  event_label?: string | null
  created_at: string
  updated_at: string
  tenant: {
    id: string
    name: string
    ati_id: string
  }
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

interface TenantOption {
  id: string
  name: string
  ati_id: string
  status: string
}

export default function SuperAdminATIDashboard() {
  const { user, logout } = useAuth()
  const [tokens, setTokens] = useState<ATIToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingToken, setEditingToken] = useState<ATIToken | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [revealingToken, setRevealingToken] = useState<ATIToken | null>(null)
  const [revealedToken, setRevealedToken] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    status: '',
    expires_at: '',
    max_uses: '',
    plan_tier: '',
    notes: ''
  })
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null)
  const [selectedTokenUsers, setSelectedTokenUsers] = useState<SignupUser[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [createForm, setCreateForm] = useState({
    tenant_mode: 'existing' as 'existing' | 'new',
    tenant_id: '',
    new_tenant_name: '',
    new_tenant_ati_id: '',
    expires_at: '',
    max_uses: '',
    plan_tier: '',
    notes: '',
    assigned_role: 'ANALYST',
    assigned_team_id: '',
    kind: 'STANDARD',
    member_access_hours: '',
    access_ends_at: '',
    event_label: '',
    entitlement_plan_code: '',
    entitlement_expires_at: ''
  })

  useEffect(() => {
    fetchTokens()
    fetchTenants()
  }, [])

  const fetchTenants = async () => {
    try {
      const response = await fetch('/api/v1/platform/tenants', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (response.ok) {
        setTenants(await response.json())
      }
    } catch (error) {
      console.error('Failed to fetch tenants:', error)
    }
  }

  const fetchTokens = async () => {
    try {
      setError(null)
      const response = await fetch('/api/v1/platform/ati', {
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

  const handleEditToken = (token: ATIToken) => {
    setEditingToken(token)
    setEditForm({
      status: token.status,
      expires_at: token.expires_at ? new Date(token.expires_at).toISOString().slice(0, 16) : '',
      max_uses: token.max_uses?.toString() || '',
      plan_tier: token.plan_tier || '',
      notes: token.notes || ''
    })
  }

  const handleUpdateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingToken) return

    setIsUpdating(true)

    try {
      const response = await fetch(`/api/v1/platform/ati/${editingToken.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          status: editForm.status || undefined,
          expires_at: editForm.expires_at || undefined,
          max_uses: editForm.max_uses ? parseInt(editForm.max_uses) : undefined,
          plan_tier: editForm.plan_tier || undefined,
          notes: editForm.notes || undefined
        })
      })

      if (response.ok) {
        setEditingToken(null)
        setEditForm({ status: '', expires_at: '', max_uses: '', plan_tier: '', notes: '' })
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

  const handleRevokeToken = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this token? Users will no longer be able to use it.')) {
      return
    }

    try {
      const response = await fetch(`/api/v1/platform/ati/${tokenId}`, {
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
      const response = await fetch(`/api/v1/platform/ati/${token.id}`, {
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

  const handleRevealToken = async (token: ATIToken) => {
    if (!confirm(`Are you sure you want to reveal the raw token for ${token.fingerprint}? This action will be logged for security purposes.`)) {
      return
    }

    setRevealingToken(token)
    setRevealedToken(null)
    setRevealError(null)

    try {
      const response = await fetch(`/api/v1/platform/ati/${token.id}/reveal`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      const data = await response.json()

      if (response.ok) {
        setRevealedToken(data.token)
      } else {
        setRevealError(data.message || 'Failed to reveal token')
      }
    } catch (error) {
      console.error('Failed to reveal token:', error)
      setRevealError('Network error: Failed to reveal token')
    } finally {
      setRevealingToken(null)
    }
  }

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)

    try {
      // Resolve the tenant: either an existing one or create a fresh one inline
      // (typical for workshops/events and new customer organizations)
      let tenantId = createForm.tenant_id
      if (createForm.tenant_mode === 'new') {
        const name = createForm.new_tenant_name.trim()
        if (!name) {
          throw new Error('Enter a name for the new tenant')
        }
        const atiId = (createForm.new_tenant_ati_id || name).toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (!atiId) {
          throw new Error('Tenant ID must contain letters or numbers')
        }
        const tenantResponse = await fetch('/api/v1/platform/tenants', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            name,
            atiId,
            generateInitialToken: false // the token below is the one we hand out
          })
        })
        const tenantData = await tenantResponse.json()
        if (!tenantResponse.ok) {
          throw new Error(tenantData.message || 'Failed to create tenant')
        }
        tenantId = tenantData.id
        fetchTenants()
      }

      if (!tenantId) {
        throw new Error('Select a tenant or create a new one')
      }

      if (createForm.entitlement_plan_code) {
        const entitlementResponse = await fetch('/api/v1/platform/entitlements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            plan_code: createForm.entitlement_plan_code,
            expires_at: createForm.entitlement_expires_at
              ? new Date(createForm.entitlement_expires_at).toISOString()
              : undefined,
            notes: createForm.notes || undefined
          })
        })
        const entitlementData = await entitlementResponse.json()
        if (!entitlementResponse.ok) {
          throw new Error(entitlementData.message || 'Failed to grant tenant entitlement')
        }
      }

      const response = await fetch('/api/v1/platform/ati', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          expires_at: createForm.expires_at ? new Date(createForm.expires_at).toISOString() : undefined,
          max_uses: createForm.max_uses ? parseInt(createForm.max_uses) : undefined,
          plan_tier: createForm.plan_tier || undefined,
          notes: createForm.notes || undefined,
          assigned_role: createForm.assigned_role || undefined,
          assigned_team_id: createForm.assigned_team_id || undefined,
          kind: createForm.kind,
          member_access_hours: createForm.kind === 'EVENT' && createForm.member_access_hours
            ? parseInt(createForm.member_access_hours)
            : undefined,
          access_ends_at: createForm.kind === 'EVENT' && createForm.access_ends_at
            ? new Date(createForm.access_ends_at).toISOString()
            : undefined,
          event_label: createForm.kind === 'EVENT' ? createForm.event_label || undefined : undefined
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create token')
      }

      setRevealedToken(data.token_display_once)
      setCreatedInviteLink(data.invite_link || null)
      setCreateForm({
        tenant_mode: 'existing',
        tenant_id: '',
        new_tenant_name: '',
        new_tenant_ati_id: '',
        expires_at: '',
        max_uses: '',
        plan_tier: '',
        notes: '',
        assigned_role: 'ANALYST',
        assigned_team_id: '',
        kind: 'STANDARD',
        member_access_hours: '',
        access_ends_at: '',
        event_label: '',
        entitlement_plan_code: '',
        entitlement_expires_at: ''
      })
      fetchTokens()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create token')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Super Admin ATI Management</h1>
              <p className="text-gray-600">Manage ATI tokens across all tenants</p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">Role: {user?.roles?.join(', ') || 'None'}</span>
              <button
                onClick={() => logout()}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Error Display */}
        {error && (
          <div className="mb-8 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-red-800">
                  Error Loading ATI Tokens
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                  <button
                    onClick={fetchTokens}
                    className="mt-2 inline-flex items-center px-3 py-1 border border-red-300 text-sm font-medium rounded-md text-red-800 bg-red-100 hover:bg-red-200"
                  >
                    Try Again
                  </button>
                </div>
              </div>
              <div className="ml-auto pl-3">
                <button
                  onClick={() => setError(null)}
                  className="inline-flex rounded-md p-1.5 text-red-400 hover:bg-red-100"
                >
                  <span className="sr-only">Dismiss</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white shadow rounded-lg mb-8">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Create Access Token</h3>
            <p className="mt-1 text-sm text-gray-500">
              An access token lets people sign up into a tenant. Pick who it&apos;s for, what kind of access it grants, and share the link.
            </p>
            <form onSubmit={handleCreateToken} className="mt-5 space-y-6">
              {/* Step 1: Token kind */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">1. What kind of access?</label>
                <select
                  value={createForm.kind}
                  onChange={(e) => {
                    const kind = e.target.value
                    setCreateForm(prev => ({
                      ...prev,
                      kind,
                      // Managed groups never assign admin-capable roles
                      assigned_role:
                        kind !== 'STANDARD' && !['ANALYST', 'VIEWER'].includes(prev.assigned_role)
                          ? 'ANALYST'
                          : prev.assigned_role
                    }))
                  }}
                  className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                >
                  <option value="STANDARD">Standard — an organization that manages itself (first user becomes owner)</option>
                  <option value="MANAGED">Managed — a group you administer from here (members can&apos;t become admins)</option>
                  <option value="EVENT">Event — workshop or demo access that expires automatically</option>
                </select>
              </div>

              {/* Step 2: Tenant */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">2. Which tenant do signups join?</label>
                <div className="flex gap-4 mb-2">
                  <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="tenant_mode"
                      checked={createForm.tenant_mode === 'existing'}
                      onChange={() => setCreateForm(prev => ({ ...prev, tenant_mode: 'existing' }))}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    Existing tenant
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="tenant_mode"
                      checked={createForm.tenant_mode === 'new'}
                      onChange={() => setCreateForm(prev => ({ ...prev, tenant_mode: 'new' }))}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    Create a new tenant
                  </label>
                </div>
                {createForm.tenant_mode === 'existing' ? (
                  <select
                    required
                    value={createForm.tenant_id}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, tenant_id: e.target.value }))}
                    className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                  >
                    <option value="">Select tenant…</option>
                    {tenants.filter(tenant => tenant.status === 'ACTIVE').map(tenant => (
                      <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.ati_id})</option>
                    ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Tenant name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. LPU AI Grants Workshop"
                        value={createForm.new_tenant_name}
                        onChange={(e) => {
                          const name = e.target.value
                          setCreateForm(prev => ({
                            ...prev,
                            new_tenant_name: name,
                            new_tenant_ati_id: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
                          }))
                        }}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Tenant ID (uppercase letters/numbers)</label>
                      <input
                        type="text"
                        placeholder="Auto-generated from name"
                        value={createForm.new_tenant_ati_id}
                        onChange={(e) =>
                          setCreateForm(prev => ({
                            ...prev,
                            new_tenant_ati_id: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                          }))
                        }
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Step 3: Event settings (EVENT only) */}
              {createForm.kind === 'EVENT' && (
                <div className="rounded-md border border-purple-200 bg-purple-50/50 p-4">
                  <label className="block text-sm font-semibold text-gray-800 mb-3">3. Event settings</label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Event name</label>
                      <input
                        type="text"
                        placeholder="e.g. AI Grants Workshop"
                        value={createForm.event_label}
                        onChange={(e) => setCreateForm(prev => ({ ...prev, event_label: e.target.value }))}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Access hours per participant</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="24 if empty"
                        value={createForm.member_access_hours}
                        onChange={(e) => setCreateForm(prev => ({ ...prev, member_access_hours: e.target.value }))}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">All access ends at (optional)</label>
                      <input
                        type="datetime-local"
                        value={createForm.access_ends_at}
                        onChange={(e) => setCreateForm(prev => ({ ...prev, access_ends_at: e.target.value }))}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Each participant&apos;s access ends at whichever comes first: their personal window or the hard cutoff.
                  </p>
                </div>
              )}

              {/* Step 4: Signup rules */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-3">
                  {createForm.kind === 'EVENT' ? '4' : '3'}. Signup rules
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Role for new signups</label>
                    <select
                      value={createForm.assigned_role}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, assigned_role: e.target.value }))}
                      className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                    >
                      {createForm.kind === 'STANDARD' ? (
                        <>
                          <option value="ADMIN">Admin</option>
                          <option value="MANAGER">Manager</option>
                          <option value="ANALYST">Analyst</option>
                        </>
                      ) : (
                        <>
                          <option value="ANALYST">Analyst</option>
                          <option value="VIEWER">Viewer</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Max signups</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Unlimited if empty"
                      value={createForm.max_uses}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, max_uses: e.target.value }))}
                      className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Signup link valid until (optional)</label>
                    <input
                      type="datetime-local"
                      value={createForm.expires_at}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, expires_at: e.target.value }))}
                      className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Advanced options (collapsed by default) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(prev => !prev)}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {showAdvanced ? '▾ Hide advanced options' : '▸ Advanced options (entitlement plan, team, notes)'}
                </button>
                {showAdvanced && (
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Entitlement plan code (optional)</label>
                      <input
                        type="text"
                        placeholder="Grants this plan to the tenant"
                        value={createForm.entitlement_plan_code}
                        onChange={(e) => setCreateForm(prev => ({ ...prev, entitlement_plan_code: e.target.value }))}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Entitlement expires (optional)</label>
                      <input
                        type="datetime-local"
                        value={createForm.entitlement_expires_at}
                        onChange={(e) => setCreateForm(prev => ({ ...prev, entitlement_expires_at: e.target.value }))}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Auto-assign team ID (optional)</label>
                      <input
                        type="text"
                        placeholder="Signups join this team"
                        value={createForm.assigned_team_id}
                        onChange={(e) => setCreateForm(prev => ({ ...prev, assigned_team_id: e.target.value }))}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
                      <input
                        type="text"
                        placeholder="Purpose or recipient"
                        value={createForm.notes}
                        onChange={(e) => setCreateForm(prev => ({ ...prev, notes: e.target.value }))}
                        className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end border-t border-gray-100 pt-4">
                <button
                  type="submit"
                  disabled={isCreating}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isCreating
                    ? 'Creating…'
                    : createForm.tenant_mode === 'new'
                      ? 'Create Tenant & Token'
                      : 'Create Token'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5 mb-8">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">A</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.filter(t => t.status === 'ACTIVE' || t.status === 'ISSUED').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">U</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Usage</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.reduce((sum, t) => sum + t.usage_count, 0)}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">S</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Suspended Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.filter(t => t.status === 'SUSPENDED').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">R</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Revoked Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {tokens.filter(t => t.status === 'REVOKED').length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">T</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Tokens</dt>
                    <dd className="text-lg font-medium text-gray-900">{tokens.length}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Edit Token Section */}
        {editingToken && (
          <div className="bg-white shadow rounded-lg mb-8">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Edit ATI Token: {editingToken.fingerprint}
                </h3>
                <button
                  onClick={() => setEditingToken(null)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>

              <div className="mb-4 p-4 bg-gray-50 rounded-md">
                <h4 className="text-sm font-medium text-gray-900 mb-2">Tenant Information</h4>
                <p className="text-sm text-gray-600">
                  <strong>Tenant:</strong> {editingToken.tenant.name} ({editingToken.tenant.ati_id})
                </p>
              </div>

              <form onSubmit={handleUpdateToken} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="edit_status" className="block text-sm font-medium text-gray-700">
                      Status
                    </label>
                    <select
                      id="edit_status"
                      value={editForm.status}
                      onChange={(e) => setEditForm(prev => ({ ...prev, status: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
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
                    <label htmlFor="edit_expires_at" className="block text-sm font-medium text-gray-700">
                      Expiration Date (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      id="edit_expires_at"
                      value={editForm.expires_at}
                      onChange={(e) => setEditForm(prev => ({ ...prev, expires_at: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="edit_max_uses" className="block text-sm font-medium text-gray-700">
                      Max Uses (Optional)
                    </label>
                    <input
                      type="number"
                      id="edit_max_uses"
                      value={editForm.max_uses}
                      onChange={(e) => setEditForm(prev => ({ ...prev, max_uses: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="Unlimited if empty"
                      min="1"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit_plan_tier" className="block text-sm font-medium text-gray-700">
                      Plan Tier (Optional)
                    </label>
                    <select
                      id="edit_plan_tier"
                      value={editForm.plan_tier}
                      onChange={(e) => setEditForm(prev => ({ ...prev, plan_tier: e.target.value }))}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                      <option value="">Select tier</option>
                      <option value="BASIC">Basic</option>
                      <option value="PRO">Pro</option>
                      <option value="ENTERPRISE">Enterprise</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="edit_notes" className="block text-sm font-medium text-gray-700">
                    Notes (Optional)
                  </label>
                  <input
                    type="text"
                    id="edit_notes"
                    value={editForm.notes}
                    onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="Purpose or recipient"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setEditingToken(null)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isUpdating ? 'Updating...' : 'Update Token'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tokens List */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Global ATI Token Management</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Manage access tokens across all tenants in the system
            </p>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading tokens...</p>
            </div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-500">
                <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h3 className="mt-2 text-sm font-medium text-gray-900">No tokens found</h3>
              <p className="mt-1 text-sm text-gray-500">No ATI tokens exist in the system yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {tokens.map((token) => (
                <li key={token.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-gray-900 font-mono">
                            {token.fingerprint}
                          </h4>
                          <div className="mt-1 flex items-center space-x-4 text-xs text-gray-500">
                            <span>Status: {token.status}</span>
                            <span>Tenant: {token.tenant.name} ({token.tenant.ati_id})</span>
                            {token.max_uses && (
                              <span>Usage: {token.usage_count}/{token.max_uses}</span>
                            )}
                            {token.plan_tier && (
                              <span>Tier: {token.plan_tier}</span>
                            )}
                            {token.kind && token.kind !== 'STANDARD' && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
                                token.kind === 'EVENT' ? 'bg-purple-100 text-purple-800' : 'bg-cyan-100 text-cyan-800'
                              }`}>
                                {token.kind}
                              </span>
                            )}
                          </div>
                          {token.kind === 'EVENT' && (
                            <div className="mt-1 text-xs text-gray-500">
                              {token.event_label ? `Event: ${token.event_label}` : 'Event access'}
                              {token.member_access_hours ? ` · ${token.member_access_hours}h per member` : ''}
                              {token.access_ends_at ? ` · ends ${new Date(token.access_ends_at).toLocaleString()}` : ''}
                            </div>
                          )}
                          {token.expires_at && (
                            <div className="mt-1 text-xs text-gray-500">
                              Expires: {new Date(token.expires_at).toLocaleString()}
                            </div>
                          )}
                          {token.notes && (
                            <div className="mt-1 text-xs text-gray-500">
                              Notes: {token.notes}
                            </div>
                          )}
                        </div>
                        <div className="ml-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            token.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : token.status === 'INACTIVE'
                              ? 'bg-gray-100 text-gray-800'
                              : token.status === 'SUSPENDED'
                              ? 'bg-orange-100 text-orange-800'
                              : token.status === 'ISSUED'
                              ? 'bg-blue-100 text-blue-800'
                              : token.status === 'REVOKED'
                              ? 'bg-red-100 text-red-800'
                              : token.status === 'EXPIRED'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {token.status}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        Created {new Date(token.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleViewUsers(token)}
                        className="inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        Users
                      </button>
                      <button
                        onClick={() => handleEditToken(token)}
                        className="inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      {token.tenant.ati_id !== 'PLATFORM' && (
                        <button
                          onClick={() => handleRevealToken(token)}
                          disabled={revealingToken?.id === token.id}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md text-white bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50"
                        >
                          {revealingToken?.id === token.id ? 'Revealing...' : 'Reveal Token'}
                        </button>
                      )}
                      {(token.status === 'ISSUED' || token.status === 'ACTIVE') && (
                        <button
                          onClick={() => handleRevokeToken(token.id)}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedTokenId === token.id && (
                    <div className="mt-3 border-t border-gray-200 pt-3">
                      <h5 className="text-xs font-semibold text-gray-700 mb-2">Users joined using this token</h5>
                      {isLoadingUsers ? (
                        <p className="text-xs text-gray-500">Loading users...</p>
                      ) : usersError ? (
                        <p className="text-xs text-red-600">{usersError}</p>
                      ) : selectedTokenUsers.length === 0 ? (
                        <p className="text-xs text-gray-500">No users have joined using this token yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {selectedTokenUsers.map(user => {
                            const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
                            const m = user.usage_metrics
                            return (
                              <li key={user.id} className="text-xs text-gray-700 flex justify-between">
                                <div>
                                  <div>
                                    {name || user.email} ({user.email})
                                  </div>
                                  {m && (
                                    <div className="text-[10px] text-gray-500 mt-0.5">
                                      Patents: {m.patentsDrafted} · Novelty: {m.noveltySearches} · Tokens (in/out): {m.totalInputTokens}/{m.totalOutputTokens}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right text-gray-500">
                                  <div>{new Date(user.created_at).toLocaleDateString()}</div>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {/* Reveal Token Modal */}
      {revealedToken && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Token Revealed</h3>
                <button
                  onClick={() => setRevealedToken(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Raw ATI Token
                </label>
                <div className="bg-gray-50 p-3 rounded-md border font-mono text-sm break-all">
                  {revealedToken}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(revealedToken)}
                  className="mt-2 inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Copy Token
                </button>
              </div>

              {createdInviteLink && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Signup Invite Link
                  </label>
                  <div className="bg-gray-50 p-3 rounded-md border font-mono text-xs break-all">
                    {createdInviteLink}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Share this link (or turn it into a QR code) — the access code is pre-filled for participants.
                  </p>
                  <button
                    onClick={() => navigator.clipboard.writeText(createdInviteLink)}
                    className="mt-2 inline-flex items-center px-3 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Copy Invite Link
                  </button>
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h4 className="text-sm font-medium text-yellow-800">
                      Security Notice
                    </h4>
                    <div className="mt-2 text-sm text-yellow-700">
                      <p>This token revelation has been logged for security auditing. The tenant should copy this token now and store it securely.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setRevealedToken(null)
                    setCreatedInviteLink(null)
                  }}
                  className="px-4 py-2 bg-gray-500 text-white text-sm font-medium rounded-md hover:bg-gray-600"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reveal Error Modal */}
      {revealError && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-red-900">Reveal Token Failed</h3>
                <button
                  onClick={() => setRevealError(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-700">{revealError}</p>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setRevealError(null)}
                  className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-md hover:bg-red-600"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
