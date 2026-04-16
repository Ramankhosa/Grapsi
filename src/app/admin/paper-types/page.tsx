'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'
import { PaperTypeList } from '@/components/admin/paper-types/PaperTypeList'
import { PaperTypeEditor } from '@/components/admin/paper-types/PaperTypeEditor'
import Link from 'next/link'

interface PaperTypeUsageStats {
  code: string
  name: string
  sessionCount: number
}

export default function PaperTypesAdminPage() {
  noStore()

  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [usageStats, setUsageStats] = useState<PaperTypeUsageStats[]>([])
  const [statsLoading, setStatsLoading] = useState(true)

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

  const fetchUsageStats = useCallback(async () => {
    try {
      setStatsLoading(true)
      const response = await fetch('/api/admin/paper-types/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setUsageStats(data.stats || [])
      }
    } catch (err) {
      console.error('Failed to fetch usage stats:', err)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.roles?.some(role => role === 'SUPER_ADMIN')) {
      fetchUsageStats()
    }
  }, [user, refreshTrigger, fetchUsageStats])

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

  const totalPapers = usageStats.reduce((sum, s) => sum + s.sessionCount, 0)
  const activePaperTypes = usageStats.length
  const mostUsedType = usageStats.sort((a, b) => b.sessionCount - a.sessionCount)[0]

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <nav className="text-sm text-slate-500 mb-2">
            <Link href="/dashboard" className="hover:text-indigo-600">Dashboard</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Paper Types</span>
          </nav>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Paper Type Management</h1>
          <p className="text-slate-600">
            Configure and manage academic paper types for the research writing platform. Add new paper types without code deployment.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Active Types</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {statsLoading ? '-' : activePaperTypes}
            </div>
            <p className="text-sm text-slate-500 mt-1">Available for selection</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Total Papers</h3>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {statsLoading ? '-' : totalPapers}
            </div>
            <p className="text-sm text-slate-500 mt-1">Papers created</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Most Popular</h3>
            </div>
            <div className="text-lg font-bold text-slate-900 truncate">
              {statsLoading ? '-' : (mostUsedType?.name || 'N/A')}
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {statsLoading ? '-' : (mostUsedType ? `${mostUsedType.sessionCount} papers` : 'No data')}
            </p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-sky-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-slate-600">Extensibility</h3>
            </div>
            <div className="text-lg font-bold text-emerald-600">Enabled</div>
            <p className="text-sm text-slate-500 mt-1">No code needed</p>
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
                  Paper Types
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
                  Create New Type
                </div>
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {activeTab === 'list' && (
            <PaperTypeList
              refreshTrigger={refreshTrigger}
              onRefresh={() => setRefreshTrigger(prev => prev + 1)}
            />
          )}
          {activeTab === 'create' && (
            <PaperTypeEditor
              isNew={true}
              onSave={handleCreateSuccess}
              onCancel={() => setActiveTab('list')}
            />
          )}
        </div>

        {/* Help Section */}
        <div className="mt-8 bg-indigo-50 rounded-xl p-6 border border-indigo-100">
          <h3 className="text-sm font-semibold text-indigo-900 mb-2">💡 About Paper Types</h3>
          <p className="text-sm text-indigo-700 mb-3">
            Paper types define the structure and requirements for different kinds of academic papers. 
            Each type specifies required sections, optional sections, word limits, and citation requirements.
          </p>
          <ul className="text-sm text-indigo-700 space-y-1">
            <li>• <strong>Required sections</strong> must be completed before export</li>
            <li>• <strong>Optional sections</strong> can be added by users as needed</li>
            <li>• <strong>Word limits</strong> guide writers on expected length per section</li>
            <li>• Changes apply to new papers immediately (existing papers are not affected)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

