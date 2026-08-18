'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'

interface TeamMember {
  id: string
  userId: string
  email: string
  name: string
  role: 'LEAD' | 'MEMBER'
  userRole: string
  status: string
  joinedAt: string
}

interface ServiceAccess {
  id: string
  serviceType: string
  isEnabled: boolean
  monthlyQuota: number | null
  dailyQuota: number | null
}

interface Team {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  isActive: boolean
  createdAt: string
  members: TeamMember[]
  serviceAccess: ServiceAccess[]
  _count: { members: number }
}

const SERVICE_LABELS: Record<string, string> = {
  FUNDING_INTELLIGENCE: 'Funding Intelligence',
  GRANT_REVIEW: 'Reviewer',
  FUNDING_CHAT: 'Funding Chat',
  FUNDING_DISCOVERY: 'Funding Discovery',
  GRANT_PREP: 'Grant Prep',
  GRANT_DRAFTING: 'Grant Drafting'
}

export default function TenantAdminTeamsPage() {
  const { user: authUser, token } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [newTeamIsDefault, setNewTeamIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchTeams = useCallback(async () => {
    if (!token) return
    
    try {
      setLoading(true)
      const res = await fetch('/api/tenant-admin/teams', {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (!res.ok) {
        throw new Error('Failed to fetch teams')
      }
      
      const data = await res.json()
      setTeams(data.teams || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

  const handleCreateTeam = async () => {
    if (!newTeamName.trim() || !token) return
    
    setSaving(true)
    try {
      const res = await fetch('/api/tenant-admin/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newTeamName.trim(),
          description: newTeamDescription.trim() || null,
          isDefault: newTeamIsDefault
        })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create team')
      }
      
      setShowCreateModal(false)
      setNewTeamName('')
      setNewTeamDescription('')
      setNewTeamIsDefault(false)
      fetchTeams()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create team')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm('Are you sure you want to deactivate this team?')) return
    if (!token) return
    
    try {
      const res = await fetch(`/api/tenant-admin/teams/${teamId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete team')
      }
      
      fetchTeams()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete team')
    }
  }

  const handleServiceAccessToggle = async (teamId: string, serviceType: string, currentEnabled: boolean) => {
    if (!token) return
    
    try {
      const res = await fetch(`/api/tenant-admin/teams/${teamId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'update_service_access',
          serviceType,
          isEnabled: !currentEnabled
        })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update service access')
      }
      
      fetchTeams()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update service access')
    }
  }

  const isAdmin = authUser?.roles?.some((r: string) => ['OWNER', 'ADMIN'].includes(r))

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
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Team Management
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {teams.length} team{teams.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + Create Team
          </button>
        </div>

        {/* Teams Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teams.map((team) => (
            <div 
              key={team.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow p-6"
            >
              {/* Team Header */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    {team.name}
                    {team.isDefault && (
                      <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded">
                        Default
                      </span>
                    )}
                  </h3>
                  {team.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {team.description}
                    </p>
                  )}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteTeam(team.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Delete
                  </button>
                )}
              </div>

              {/* Members */}
              <div className="mb-4">
                <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Members ({team._count.members})
                </h4>
                <div className="flex flex-wrap gap-1">
                  {team.members.slice(0, 5).map((member) => (
                    <span 
                      key={member.id}
                      className="inline-flex items-center px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                      title={member.email}
                    >
                      {member.name || member.email.split('@')[0]}
                      {member.role === 'LEAD' && (
                        <span className="ml-1 text-yellow-500">★</span>
                      )}
                    </span>
                  ))}
                  {team._count.members > 5 && (
                    <span className="text-xs text-gray-400">
                      +{team._count.members - 5} more
                    </span>
                  )}
                </div>
              </div>

              {/* Service Access */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Service Access
                </h4>
                <div className="space-y-2">
                  {Object.entries(SERVICE_LABELS).map(([key, label]) => {
                    const access = team.serviceAccess.find(sa => sa.serviceType === key)
                    const isEnabled = access?.isEnabled ?? true
                    
                    return (
                      <div 
                        key={key}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-gray-700 dark:text-gray-300">
                          {label}
                        </span>
                        <button
                          onClick={() => handleServiceAccessToggle(team.id, key, isEnabled)}
                          disabled={!isAdmin}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            isEnabled 
                              ? 'bg-green-500' 
                              : 'bg-gray-300 dark:bg-gray-600'
                          } ${!isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              isEnabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* View Details */}
              <button
                onClick={() => setSelectedTeam(team)}
                className="mt-4 w-full text-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View Details & Manage Members
              </button>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {teams.length === 0 && (
          <div className="text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No teams</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Get started by creating your first team.
            </p>
            <div className="mt-6">
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                + Create Team
              </button>
            </div>
          </div>
        )}

        {/* Create Team Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Create New Team
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Team Name *
                  </label>
                  <input
                    type="text"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Patent Team A"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={newTeamDescription}
                    onChange={(e) => setNewTeamDescription(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional description..."
                  />
                </div>
                
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newTeamIsDefault}
                    onChange={(e) => setNewTeamIsDefault(e.target.checked)}
                    className="h-4 w-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Set as default team for new users
                  </span>
                </label>
              </div>
              
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCreateModal(false)
                    setNewTeamName('')
                    setNewTeamDescription('')
                    setNewTeamIsDefault(false)
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTeam}
                  disabled={saving || !newTeamName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Team Details Modal */}
        {selectedTeam && (
          <TeamDetailsModal 
            team={selectedTeam} 
            token={token}
            onClose={() => setSelectedTeam(null)}
            onUpdate={fetchTeams}
            isAdmin={isAdmin || false}
          />
        )}
      </div>
    </div>
  )
}

// Team Details Modal Component
function TeamDetailsModal({ 
  team, 
  token, 
  onClose, 
  onUpdate,
  isAdmin 
}: { 
  team: Team
  token: string | null
  onClose: () => void
  onUpdate: () => void
  isAdmin: boolean
}) {
  const [members, setMembers] = useState<TeamMember[]>(team.members)
  const [users, setUsers] = useState<any[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Fetch all users to show add member dropdown
    const fetchUsers = async () => {
      if (!token) return
      
      try {
        const res = await fetch('/api/tenant-admin/users', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setUsers(data.users || [])
        }
      } catch (e) {
        console.error('Failed to fetch users:', e)
      }
    }
    
    fetchUsers()
  }, [token])

  const handleAddMember = async () => {
    if (!selectedUserId || !token) return
    
    setLoading(true)
    try {
      const res = await fetch(`/api/tenant-admin/teams/${team.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'add_member',
          userId: selectedUserId
        })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add member')
      }
      
      setSelectedUserId('')
      onUpdate()
      
      // Refresh local state
      const memberRes = await fetch(`/api/tenant-admin/teams/${team.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (memberRes.ok) {
        const data = await memberRes.json()
        setMembers(data.members || [])
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Remove this member from the team?')) return
    if (!token) return
    
    try {
      const res = await fetch(`/api/tenant-admin/teams/${team.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'remove_member',
          userId
        })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to remove member')
      }
      
      setMembers(prev => prev.filter(m => m.userId !== userId))
      onUpdate()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  const handleToggleLead = async (userId: string, currentRole: string) => {
    if (!token) return
    
    try {
      const res = await fetch(`/api/tenant-admin/teams/${team.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'change_member_role',
          userId,
          newRole: currentRole === 'LEAD' ? 'MEMBER' : 'LEAD'
        })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to change role')
      }
      
      setMembers(prev => prev.map(m => 
        m.userId === userId 
          ? { ...m, role: currentRole === 'LEAD' ? 'MEMBER' : 'LEAD' }
          : m
      ))
      onUpdate()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to change role')
    }
  }

  // Filter out users who are already members
  const memberUserIds = new Set(members.map(m => m.userId))
  const availableUsers = users.filter(u => !memberUserIds.has(u.id))

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            {team.name} - Team Details
          </h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>
        
        {/* Add Member */}
        {isAdmin && availableUsers.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Add Member
            </h4>
            <div className="flex gap-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select user...</option>
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name || user.email} ({user.roles[0]})
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddMember}
                disabled={!selectedUserId || loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Members List */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Members ({members.length})
          </h4>
          
          {members.map((member) => (
            <div 
              key={member.id}
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    {(member.name?.[0] || member.email[0]).toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
                    {member.name || member.email.split('@')[0]}
                    {member.role === 'LEAD' && (
                      <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded">
                        Team Lead
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {member.email} • {member.userRole}
                  </div>
                </div>
              </div>
              
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleLead(member.userId, member.role)}
                    className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    {member.role === 'LEAD' ? 'Remove Lead' : 'Make Lead'}
                  </button>
                  <button
                    onClick={() => handleRemoveMember(member.userId)}
                    className="text-xs px-2 py-1 text-red-600 hover:text-red-800 dark:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
          
          {members.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No members in this team
            </p>
          )}
        </div>
        
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

