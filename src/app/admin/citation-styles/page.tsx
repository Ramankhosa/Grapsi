'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'
import { CitationStyleList } from '@/components/admin/citation-styles/CitationStyleList'
import { CitationStyleEditor } from '@/components/admin/citation-styles/CitationStyleEditor'
import Link from 'next/link'

export default function CitationStylesAdminPage() {
  noStore()

  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [styleCount, setStyleCount] = useState(0)
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
      const response = await fetch('/api/citation-styles', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setStyleCount(data.styles?.length || 0)
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
            <span className="text-slate-900">Citation Styles</span>
          </nav>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Citation Style Management</h1>
          <p className="text-slate-600">
            Configure academic citation styles for the research writing platform. Customize formatting rules for bibliography and in-text citations.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Active Styles</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {loading ? '-' : styleCount}
            </div>
            <p className="text-sm text-slate-500 mt-1">Available for papers</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Standard Styles</h3>
            </div>
            <div className="text-lg font-bold text-slate-900">APA, IEEE, Chicago...</div>
            <p className="text-sm text-slate-500 mt-1">Pre-configured</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Customizable</h3>
            </div>
            <div className="text-lg font-bold text-emerald-600">Yes</div>
            <p className="text-sm text-slate-500 mt-1">Edit formatting rules</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-sky-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Preview</h3>
            </div>
            <div className="text-lg font-bold text-emerald-600">Live</div>
            <p className="text-sm text-slate-500 mt-1">See formatted output</p>
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
                  Citation Styles
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
                  Create New Style
                </div>
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {activeTab === 'list' && (
            <CitationStyleList
              refreshTrigger={refreshTrigger}
              onRefresh={() => setRefreshTrigger(prev => prev + 1)}
            />
          )}
          {activeTab === 'create' && (
            <CitationStyleEditor
              isNew={true}
              onSave={handleCreateSuccess}
              onCancel={() => setActiveTab('list')}
            />
          )}
        </div>

        {/* Help Section */}
        <div className="mt-8 bg-violet-50 rounded-xl p-6 border border-violet-100">
          <h3 className="text-sm font-semibold text-violet-900 mb-2">📚 About Citation Styles</h3>
          <p className="text-sm text-violet-700 mb-3">
            Citation styles define how references are formatted in academic papers. 
            Each style specifies rules for in-text citations and bibliography entries.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-violet-800 mb-1">Author-Year Styles</h4>
              <ul className="text-sm text-violet-700 space-y-1">
                <li>• APA - Social Sciences</li>
                <li>• Chicago Author-Date - Humanities</li>
                <li>• Harvard - General Academic</li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-violet-800 mb-1">Numbered Styles</h4>
              <ul className="text-sm text-violet-700 space-y-1">
                <li>• IEEE - Engineering/CS</li>
                <li>• Vancouver - Medical/Sciences</li>
                <li>• Nature - Scientific Journals</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

