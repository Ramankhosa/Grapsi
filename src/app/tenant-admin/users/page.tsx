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

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer'
}

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  MANAGER: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ANALYST: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  VIEWER: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

export default function TenantAdminUsersPage() {
  const { user: authUser, token } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [tenant, setTenant] = useState<{ id: string; name: string; type: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [newRole, setNewRole] = useState<string>('')
  const [saving, setSaving] = useState(false)

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleRoleChange = async () => {
    if (!selectedUser || !newRole || !token) return
    
    setSaving(true)
    try {
      const res = await fetch(`/api/tenant-admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'change_role', newRole })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to change role')
      }
      
      setShowRoleModal(false)
      setSelectedUser(null)
      setNewRole('')
      fetchUsers()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to change role')
    } finally {
      setSaving(false)
    }
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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            User Management
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {tenant?.name} • {users.length} users
          </p>
        </div>

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
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${ROLE_COLORS[user.roles[0]] || ROLE_COLORS.VIEWER}`}>
                      {ROLE_LABELS[user.roles[0]] || user.roles[0]}
                    </span>
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
                          onClick={() => {
                            setSelectedUser(user)
                            setNewRole(user.roles[0])
                            setShowRoleModal(true)
                          }}
                          className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Change Role
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

        {/* Role Change Modal */}
        {showRoleModal && selectedUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Change Role for {selectedUser.name || selectedUser.email}
              </h3>
              
              <div className="space-y-2 mb-6">
                {['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'].map((role) => (
                  <label 
                    key={role}
                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                      newRole === role 
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={role}
                      checked={newRole === role}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="h-4 w-4 text-blue-600"
                    />
                    <span className="ml-3">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {ROLE_LABELS[role]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowRoleModal(false)
                    setSelectedUser(null)
                    setNewRole('')
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRoleChange}
                  disabled={saving || newRole === selectedUser.roles[0]}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

