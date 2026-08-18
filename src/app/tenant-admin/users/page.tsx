'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'

interface TeamInfo {
  id: string
  name: string
  role: string
  isLead: boolean
}

interface User {
  id: string
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  roles: string[]
  status: string
  teams: TeamInfo[]
  createdAt: string
}

/** What this admin is allowed to hand out, resolved server-side from their own roles. */
interface UserPermissions {
  canCreateUsers: boolean
  creatableRoles: string[]
  grantableAdditiveRoles: string[]
}

interface ActivationDetails {
  email: string
  link: string
  expiresAt: string
  emailSent: boolean
  emailError: string | null
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
  MEMBER: 'Member',
  CALL_ASSIGNER: 'Call Assigner',
  CALL_ADMIN: 'Call Admin',
}

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  MANAGER: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ANALYST: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  VIEWER: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  MEMBER: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  CALL_ASSIGNER: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  CALL_ADMIN: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  QUALITY_AUDITOR: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
}

/** Hierarchy slot (replaces the array); one at a time. */
const HIERARCHY_ROLES = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as const
/** Additive tags that can be mixed freely with a hierarchy role. */
const ADDITIVE_ROLES = ['CALL_ADMIN', 'CALL_ASSIGNER', 'MEMBER', 'QUALITY_AUDITOR'] as const
const ADDITIVE_ROLE_HINTS: Record<string, string> = {
  CALL_ADMIN: 'Scoped tenant admin — imports and manages funding calls, faculty roster, and org tree. Cannot change user roles.',
  CALL_ASSIGNER: 'Can assign funding calls to faculty and view assignment dashboards.',
  MEMBER: 'Basic tenant member — sees published calls, gets no admin surfaces.',
  QUALITY_AUDITOR: 'Read-only access to all reviews and reports across the tenant for quality oversight.',
}

const HIERARCHY_ROLE_HINTS: Record<string, string> = {
  ADMIN: 'Full workspace administration, including users and roles.',
  MANAGER: 'Runs work and teams; sees the user list but cannot change roles.',
  ANALYST: 'Standard working account.',
  VIEWER: 'Read-only access to the workspace.',
}

export default function TenantAdminUsersPage() {
  const { user: authUser, token } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [tenant, setTenant] = useState<{ id: string; name: string; type: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [hierarchyRole, setHierarchyRole] = useState<string>('')
  const [additiveRoles, setAdditiveRoles] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<UserPermissions>({
    canCreateUsers: false,
    creatableRoles: [],
    grantableAdditiveRoles: [],
  })

  // Add-user form
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createEmail, setCreateEmail] = useState('')
  const [createFirstName, setCreateFirstName] = useState('')
  const [createLastName, setCreateLastName] = useState('')
  const [createRole, setCreateRole] = useState('')
  const [createTags, setCreateTags] = useState<string[]>([])
  const [createSendEmail, setCreateSendEmail] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [activation, setActivation] = useState<ActivationDetails | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchUsers = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      const res = await fetch('/api/tenant-admin/users', {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) {
        throw new Error('Failed to fetch users')
      }

      const data = await res.json()
      setUsers(data.users || [])
      setTenant(data.tenant)
      if (data.permissions) setPermissions(data.permissions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const patchUser = async (body: any) => {
    const res = await fetch(`/api/tenant-admin/users/${selectedUser!.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Request failed')
    }
    return res.json()
  }

  const handleRoleChange = async () => {
    if (!selectedUser || !token) return
    setSaving(true)
    setSaveError(null)
    try {
      const currentHierarchy = selectedUser.roles.find(r =>
        (HIERARCHY_ROLES as readonly string[]).includes(r)
      ) || ''
      const currentAdditive = new Set(
        selectedUser.roles.filter(r => (ADDITIVE_ROLES as readonly string[]).includes(r))
      )
      const nextAdditive = new Set(additiveRoles)

      // Hierarchy slot: only fire change_role if it actually changed.
      if (hierarchyRole && hierarchyRole !== currentHierarchy) {
        await patchUser({ action: 'change_role', newRole: hierarchyRole })
      }

      // Additive tags: diff and issue add/remove for each delta.
      for (const role of ADDITIVE_ROLES) {
        const had = currentAdditive.has(role)
        const wants = nextAdditive.has(role)
        if (had === wants) continue
        await patchUser({ action: wants ? 'add_role' : 'remove_role', role })
      }

      setShowRoleModal(false)
      setSelectedUser(null)
      setHierarchyRole('')
      setAdditiveRoles([])
      fetchUsers()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update roles')
    } finally {
      setSaving(false)
    }
  }

  const openRoleModal = (targetUser: User) => {
    setSelectedUser(targetUser)
    const currentHierarchy = targetUser.roles.find(r =>
      (HIERARCHY_ROLES as readonly string[]).includes(r)
    ) || ''
    setHierarchyRole(currentHierarchy)
    setAdditiveRoles(
      targetUser.roles.filter(r => (ADDITIVE_ROLES as readonly string[]).includes(r))
    )
    setSaveError(null)
    setShowRoleModal(true)
  }

  const toggleAdditive = (role: string) => {
    setAdditiveRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }

  const handleStatusChange = async (userId: string, newStatus: string) => {
    if (!token) return
    
    try {
      const res = await fetch(`/api/tenant-admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'change_status', status: newStatus })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to change status')
      }
      
      fetchUsers()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to change status')
    }
  }

  const resetCreateForm = () => {
    setCreateEmail('')
    setCreateFirstName('')
    setCreateLastName('')
    setCreateRole(permissions.creatableRoles.includes('ANALYST') ? 'ANALYST' : permissions.creatableRoles[0] || '')
    setCreateTags([])
    setCreateSendEmail(true)
    setCreateError(null)
  }

  const openCreateModal = () => {
    resetCreateForm()
    setActivation(null)
    setShowCreateModal(true)
  }

  const handleCreateUser = async () => {
    if (!token) return
    if (!createRole) {
      setCreateError('Pick a role')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/tenant-admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: createEmail.trim(),
          firstName: createFirstName.trim() || undefined,
          lastName: createLastName.trim() || undefined,
          role: createRole,
          additiveRoles: createTags,
          sendActivationEmail: createSendEmail,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user')
      }

      setShowCreateModal(false)
      resetCreateForm()
      setActivation({
        email: data.user.email,
        link: data.activationLink,
        expiresAt: data.activationExpiresAt,
        emailSent: Boolean(data.activationEmailSent),
        emailError: data.activationEmailError || null,
      })
      setCopied(false)
      fetchUsers()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  const copyActivationLink = async () => {
    if (!activation) return
    try {
      await navigator.clipboard.writeText(activation.link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const canModifyUser = (targetUser: User) => {
    if (!authUser) return false
    const actorRoles = authUser.roles || []
    const targetRole = targetUser.roles[0] || 'VIEWER'
    
    // Cannot modify OWNER unless you're also OWNER
    if (targetRole === 'OWNER' && !actorRoles.includes('OWNER')) return false
    
    // OWNER can modify everyone except other OWNERs
    if (actorRoles.includes('OWNER')) return targetRole !== 'OWNER' || targetUser.id !== authUser.user_id
    
    // ADMIN can modify MANAGER, ANALYST, VIEWER
    if (actorRoles.includes('ADMIN')) {
      return ['MANAGER', 'ANALYST', 'VIEWER'].includes(targetRole)
    }
    
    return false
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-red-600 dark:text-red-400">{error}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              User Management
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {tenant?.name} • {users.length} users
            </p>
          </div>
          {permissions.canCreateUsers && (
            <button
              onClick={openCreateModal}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add user
            </button>
          )}
        </div>

        {/* Activation link for the account just created — shown so the admin can
            deliver it even when the email does not arrive. */}
        {activation && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                  Activation link for {activation.email}
                </div>
                <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
                  {activation.emailSent
                    ? 'Emailed to them. Share this link too if the message does not arrive — it sets their password.'
                    : 'Send this link to them — it is how they set their password.'}{' '}
                  Expires {new Date(activation.expiresAt).toLocaleString()}.
                </p>
                {activation.emailError && (
                  <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">
                    The account was created, but the email failed: {activation.emailError}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyActivationLink}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  onClick={() => setActivation(null)}
                  className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:border-blue-400 dark:text-blue-300"
                >
                  Hide
                </button>
              </div>
            </div>
            <code className="mt-3 block break-all rounded border border-blue-200 bg-white px-3 py-2 font-mono text-xs text-gray-700 dark:border-blue-800 dark:bg-gray-800 dark:text-gray-300">
              {activation.link}
            </code>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Teams
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                          {(user.firstName?.[0] || user.email[0]).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unnamed'}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(user.roles.length === 0 ? ['MEMBER'] : user.roles).map(role => (
                        <span
                          key={role}
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${ROLE_COLORS[role] || ROLE_COLORS.VIEWER}`}
                        >
                          {ROLE_LABELS[role] || role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.teams.length === 0 ? (
                        <span className="text-xs text-gray-400">No teams</span>
                      ) : (
                        user.teams.map((team) => (
                          <span 
                            key={team.id}
                            className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                          >
                            {team.name}
                            {team.isLead && (
                              <span className="ml-1 text-yellow-500">★</span>
                            )}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      user.status === 'ACTIVE' 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {canModifyUser(user) && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openRoleModal(user)}
                          className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Edit Roles
                        </button>
                        <button
                          onClick={() => handleStatusChange(
                            user.id, 
                            user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
                          )}
                          className={user.status === 'ACTIVE' 
                            ? 'text-red-600 hover:text-red-900 dark:text-red-400' 
                            : 'text-green-600 hover:text-green-900 dark:text-green-400'
                          }
                        >
                          {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add User Modal — creates the account immediately, no password set by the admin */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Add a user</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                The account is created straight away with no password. They set their own through the activation link,
                which you can email or hand over yourself.
              </p>

              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Email</span>
                  <input
                    type="email"
                    value={createEmail}
                    onChange={e => setCreateEmail(e.target.value)}
                    placeholder="person@university.edu"
                    className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">First name</span>
                    <input
                      value={createFirstName}
                      onChange={e => setCreateFirstName(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Last name</span>
                    <input
                      value={createLastName}
                      onChange={e => setCreateLastName(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">Role</p>
                <div className="space-y-2">
                  {permissions.creatableRoles.map(role => (
                    <label
                      key={role}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        createRole === role
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="createRole"
                        value={role}
                        checked={createRole === role}
                        onChange={e => setCreateRole(e.target.value)}
                        className="mt-1 h-4 w-4 text-blue-600"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">
                          {ROLE_LABELS[role] || role}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {HIERARCHY_ROLE_HINTS[role]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {permissions.grantableAdditiveRoles.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">Additive tags</p>
                  <div className="space-y-2">
                    {permissions.grantableAdditiveRoles.map(role => (
                      <label
                        key={role}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          createTags.includes(role)
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={createTags.includes(role)}
                          onChange={() =>
                            setCreateTags(prev =>
                              prev.includes(role) ? prev.filter(tag => tag !== role) : [...prev, role]
                            )
                          }
                          className="mt-1 h-4 w-4 text-indigo-600"
                        />
                        <span>
                          <span className="block text-sm font-medium text-gray-900 dark:text-white">
                            {ROLE_LABELS[role] || role}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {ADDITIVE_ROLE_HINTS[role]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <label className="mt-5 flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <input
                  type="checkbox"
                  checked={createSendEmail}
                  onChange={e => setCreateSendEmail(e.target.checked)}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Email them the activation link now
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    The link is shown to you either way, so you can deliver it yourself.
                  </span>
                </span>
              </label>

              {createError && (
                <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {createError}
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowCreateModal(false)
                    resetCreateForm()
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateUser}
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create user'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Role Editor Modal — hierarchy slot + additive tags */}
        {showRoleModal && selectedUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                Edit roles for {selectedUser.name || selectedUser.email}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Pick one hierarchy role. Add any number of tags on top — a user can be a Member and a
                Call Assigner at the same time.
              </p>

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                  Hierarchy role
                </p>
                <div className="space-y-2">
                  {HIERARCHY_ROLES.map(role => (
                    <label
                      key={role}
                      className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                        hierarchyRole === role
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="hierarchyRole"
                        value={role}
                        checked={hierarchyRole === role}
                        onChange={e => setHierarchyRole(e.target.value)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <span className="ml-3 text-sm font-medium text-gray-900 dark:text-white">
                        {ROLE_LABELS[role]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                  Additive tags
                </p>
                <div className="space-y-2">
                  {ADDITIVE_ROLES.map(role => (
                    <label
                      key={role}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        additiveRoles.includes(role)
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={additiveRoles.includes(role)}
                        onChange={() => toggleAdditive(role)}
                        className="mt-1 h-4 w-4 text-indigo-600"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">
                          {ROLE_LABELS[role]}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {ADDITIVE_ROLE_HINTS[role]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {saveError && (
                <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {saveError}
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowRoleModal(false)
                    setSelectedUser(null)
                    setHierarchyRole('')
                    setAdditiveRoles([])
                    setSaveError(null)
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRoleChange}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

