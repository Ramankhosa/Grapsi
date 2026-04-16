'use client'

import { useState, useEffect } from 'react'
import { CountryProfileList } from '@/components/super-admin/country-profiles/CountryProfileList'
import { CountryProfileUpload } from '@/components/super-admin/country-profiles/CountryProfileUpload'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'

export default function SuperAdminCountriesPage() {
  // Prevent static generation
  noStore()

  const { user, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<'list' | 'upload'>('list')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    if (!user) {
      // Redirect to login if not authenticated
      window.location.href = '/login'
      return
    }

    if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
      // Redirect to appropriate dashboard if not super admin
      window.location.href = '/dashboard'
      return
    }
  }, [user])

  const handleUploadSuccess = () => {
    setRefreshTrigger(prev => prev + 1)
    setActiveTab('list')
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Access denied. Super admin privileges required.</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Country Profile Management</h1>
        <p className="text-gray-600">
          Manage jurisdiction-aware country profiles for patent drafting, validation, and export.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('list')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'list'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Country Profiles
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'upload'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Upload New Profile
            </button>
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow">
        {activeTab === 'list' && (
          <CountryProfileList
            refreshTrigger={refreshTrigger}
            onRefresh={() => setRefreshTrigger(prev => prev + 1)}
          />
        )}
        {activeTab === 'upload' && (
          <CountryProfileUpload onUploadSuccess={handleUploadSuccess} />
        )}
      </div>

      {/* Quick Stats */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Active Profiles</h3>
          <div className="text-2xl font-bold text-green-600">0</div>
          <p className="text-sm text-gray-500 mt-1">
            Ready for drafting
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Draft Profiles</h3>
          <div className="text-2xl font-bold text-yellow-600">0</div>
          <p className="text-sm text-gray-500 mt-1">
            Under development
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Jurisdictions</h3>
          <div className="text-2xl font-bold text-blue-600">0</div>
          <p className="text-sm text-gray-500 mt-1">
            Total countries covered
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Last Updated</h3>
          <div className="text-2xl font-bold text-gray-900">-</div>
          <p className="text-sm text-gray-500 mt-1">
            Most recent profile
          </p>
        </div>
      </div>
    </div>
  )
}
