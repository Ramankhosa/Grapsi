'use client'

import { useState, useEffect, useCallback } from 'react'

interface CountryProfile {
  id: string
  countryCode: string
  name: string
  profileData: any
  version: number
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT'
  createdBy: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
  creator: {
    id: string
    name: string
    email: string
  }
  updater?: {
    id: string
    name: string
    email: string
  }
}

interface CountryProfileListProps {
  refreshTrigger: number
  onRefresh: () => void
}

export function CountryProfileList({ refreshTrigger, onRefresh }: CountryProfileListProps) {
  const [profiles, setProfiles] = useState<CountryProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [editingProfile, setEditingProfile] = useState<CountryProfile | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') {
        params.append('status', statusFilter)
      }

      const response = await fetch(`/api/super-admin/countries?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setProfiles(data.countryProfiles || [])
        setError(null)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to fetch profiles')
      }
    } catch (err) {
      setError('Failed to fetch profiles: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles, refreshTrigger])

  const handleStatusChange = async (profileId: string, newStatus: string) => {
    try {
      const response = await fetch('/api/super-admin/countries', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          countryCode: profiles.find(p => p.id === profileId)?.countryCode,
          status: newStatus
        })
      })

      if (response.ok) {
        onRefresh()
      } else {
        const errorData = await response.json()
        alert('Failed to update status: ' + (errorData.error || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to update status: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleDelete = async (countryCode: string) => {
    try {
      const response = await fetch('/api/super-admin/countries', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: new URLSearchParams({ countryCode })
      })

      if (response.ok) {
        setShowDeleteConfirm(null)
        onRefresh()
      } else {
        const errorData = await response.json()
        alert('Failed to delete profile: ' + (errorData.error || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to delete profile: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const getStatusBadge = (status: string) => {
    const badges = {
      ACTIVE: 'bg-green-100 text-green-800',
      INACTIVE: 'bg-red-100 text-red-800',
      DRAFT: 'bg-yellow-100 text-yellow-800'
    }
    return badges[status as keyof typeof badges] || 'bg-gray-100 text-gray-800'
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading country profiles...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-red-800 font-medium">{error}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header and Filters */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold mb-2">Country Profiles</h2>
          <p className="text-gray-600">
            Manage jurisdiction-specific patent drafting rules and templates.
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-gray-900">{profiles.length}</div>
          <div className="text-sm text-gray-600">Total Profiles</div>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-green-600">
            {profiles.filter(p => p.status === 'ACTIVE').length}
          </div>
          <div className="text-sm text-gray-600">Active</div>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-yellow-600">
            {profiles.filter(p => p.status === 'DRAFT').length}
          </div>
          <div className="text-sm text-gray-600">Draft</div>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-red-600">
            {profiles.filter(p => p.status === 'INACTIVE').length}
          </div>
          <div className="text-sm text-gray-600">Inactive</div>
        </div>
      </div>

      {/* Profiles Table */}
      {profiles.length === 0 ? (
        <div className="bg-white border rounded-lg p-8 text-center">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No country profiles found</h3>
          <p className="text-gray-600">
            {statusFilter === 'ALL'
              ? 'Get started by uploading your first country profile.'
              : `No profiles with status "${statusFilter}" found.`
            }
          </p>
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Country
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Version
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Updated
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {profiles.map((profile) => (
                  <tr key={profile.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {profile.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {profile.profileData?.meta?.continent || 'Unknown'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        {profile.countryCode}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={profile.status}
                        onChange={(e) => handleStatusChange(profile.id, e.target.value)}
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(profile.status)} border-0`}
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                        <option value="DRAFT">Draft</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      v{profile.version}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(profile.updatedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setEditingProfile(profile)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          View
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(profile.countryCode)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Profile Details Modal */}
      {editingProfile && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  {editingProfile.name} ({editingProfile.countryCode})
                </h3>
                <button
                  onClick={() => setEditingProfile(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Office</label>
                    <p className="text-sm text-gray-900">{editingProfile.profileData?.meta?.office || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Languages</label>
                    <p className="text-sm text-gray-900">
                      {editingProfile.profileData?.meta?.languages?.join(', ') || 'N/A'}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Application Types</label>
                  <div className="flex flex-wrap gap-2">
                    {editingProfile.profileData?.meta?.applicationTypes?.map((type: string) => (
                      <span key={type} className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                        {type}
                      </span>
                    )) || 'N/A'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sections ({editingProfile.profileData?.structure?.variants?.[0]?.sections?.length || 0})</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {editingProfile.profileData?.structure?.variants?.[0]?.sections?.map((section: any) => (
                      <div key={section.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                        <span className="text-sm font-medium">{section.label}</span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          section.required ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {section.required ? 'Required' : 'Optional'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Raw JSON</label>
                  <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto max-h-60">
                    {JSON.stringify(editingProfile.profileData, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Confirm Delete</h3>
              <p className="text-sm text-gray-600 mb-6">
                Are you sure you want to delete the country profile for &ldquo;{profiles.find(p => p.countryCode === showDeleteConfirm)?.name}&rdquo;?
                This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(showDeleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
