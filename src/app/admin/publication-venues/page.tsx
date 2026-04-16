'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'
import { PublicationVenueList } from '@/components/admin/publication-venues/PublicationVenueList'
import { PublicationVenueEditor } from '@/components/admin/publication-venues/PublicationVenueEditor'
import Link from 'next/link'

interface VenueStats {
  total: number
  journals: number
  conferences: number
  bookPublishers: number
}

export default function PublicationVenuesAdminPage() {
  noStore()

  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [stats, setStats] = useState<VenueStats>({ total: 0, journals: 0, conferences: 0, bookPublishers: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }
  }, [user])

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/publication-venues/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setStats(data.stats || { total: 0, journals: 0, conferences: 0, bookPublishers: 0 })
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.roles?.some(role => role === 'SUPER_ADMIN')) {
      fetchStats()
    }
  }, [user, refreshTrigger, fetchStats])

  const handleCreateSuccess = () => {
    setRefreshTrigger(prev => prev + 1)
    setActiveTab('list')
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-red-600 bg-red-50 px-6 py-4 rounded-lg border border-red-200">
          Access denied. Super admin privileges required.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <nav className="text-sm text-slate-500 mb-2">
            <Link href="/dashboard" className="hover:text-indigo-600">Dashboard</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Publication Venues</span>
          </nav>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Publication Venue Management</h1>
          <p className="text-slate-600">
            Configure journals, conferences, and publishers. Venues auto-apply citation styles and formatting requirements.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Total Venues</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {loading ? '-' : stats.total}
            </div>
            <p className="text-sm text-slate-500 mt-1">All publication venues</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Journals</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {loading ? '-' : stats.journals}
            </div>
            <p className="text-sm text-slate-500 mt-1">Peer-reviewed journals</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Conferences</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {loading ? '-' : stats.conferences}
            </div>
            <p className="text-sm text-slate-500 mt-1">Academic conferences</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Publishers</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {loading ? '-' : stats.bookPublishers}
            </div>
            <p className="text-sm text-slate-500 mt-1">Book publishers</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-slate-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('list')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'list'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Publication Venues
                </div>
              </button>
              <button
                onClick={() => setActiveTab('create')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'create'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add New Venue
                </div>
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {activeTab === 'list' && (
            <PublicationVenueList
              refreshTrigger={refreshTrigger}
              onRefresh={() => setRefreshTrigger(prev => prev + 1)}
            />
          )}
          {activeTab === 'create' && (
            <PublicationVenueEditor
              isNew={true}
              onSave={handleCreateSuccess}
              onCancel={() => setActiveTab('list')}
            />
          )}
        </div>

        {/* Help Section */}
        <div className="mt-8 bg-teal-50 rounded-xl p-6 border border-teal-100">
          <h3 className="text-sm font-semibold text-teal-900 mb-2">📚 About Publication Venues</h3>
          <p className="text-sm text-teal-700 mb-3">
            Publication venues define where researchers submit their work. Configure venues to automatically apply:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white/50 rounded-lg p-3">
              <h4 className="text-sm font-medium text-teal-800 mb-1">📝 Citation Style</h4>
              <p className="text-xs text-teal-600">
                Auto-applies the venue&apos;s required citation format (APA, IEEE, etc.)
              </p>
            </div>
            <div className="bg-white/50 rounded-lg p-3">
              <h4 className="text-sm font-medium text-teal-800 mb-1">📏 Word Limits</h4>
              <p className="text-xs text-teal-600">
                Override default limits to match venue requirements
              </p>
            </div>
            <div className="bg-white/50 rounded-lg p-3">
              <h4 className="text-sm font-medium text-teal-800 mb-1">📄 Sections</h4>
              <p className="text-xs text-teal-600">
                Custom section requirements for specific venues
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

