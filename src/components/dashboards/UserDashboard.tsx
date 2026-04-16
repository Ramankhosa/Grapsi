'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { isFeatureEnabled } from '@/lib/feature-flags'
import LoadingBird from '@/components/ui/loading-bird'
import { motion } from 'framer-motion'
import {
  BookOpen,
  BookOpenCheck,
  Plus,
  Clock,
  FileText,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  BarChart3,
  TrendingUp,
  Calendar,
  Target,
  Library
} from 'lucide-react'

interface Paper {
  id: string
  title: string
  paperType?: {
    code: string
    name: string
  }
  citationStyle?: {
    code: string
    name: string
  }
  publicationVenue?: {
    code: string
    name: string
  }
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED'
  progress?: number
  citationsCount?: number
  wordCount?: number
  targetWordCount?: number
  createdAt: string
  updatedAt: string
}

interface DashboardStats {
  totalPapers: number
  inProgress: number
  completed: number
  totalCitations: number
  totalWords: number
}

export default function UserDashboard() {
  const { user } = useAuth()
  const router = useRouter()
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats>({
    totalPapers: 0,
    inProgress: 0,
    completed: 0,
    totalCitations: 0,
    totalWords: 0
  })

  const fetchPapers = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/papers?limit=5&sortBy=updatedAt&sortOrder=desc', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        const papersList = data.papers || []
        setPapers(papersList)
        
        // Calculate stats
        const totalPapers = papersList.length
        const inProgress = papersList.filter((p: Paper) => p.status === 'IN_PROGRESS').length
        const completed = papersList.filter((p: Paper) => p.status === 'COMPLETED').length
        const totalCitations = papersList.reduce((sum: number, p: Paper) => sum + (p.citationsCount || 0), 0)
        const totalWords = papersList.reduce((sum: number, p: Paper) => sum + (p.wordCount || 0), 0)
        
        setStats({ totalPapers, inProgress, completed, totalCitations, totalWords })
      }
    } catch (error) {
      console.error('Error fetching papers:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Use user_id instead of user object to prevent re-fetches on object reference changes
  const userId = user?.user_id
  
  useEffect(() => {
    if (userId && isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
      fetchPapers()
    } else if (!userId) {
      setLoading(false)
    }
  }, [userId, fetchPapers])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'IN_PROGRESS':
        return <Clock className="w-4 h-4 text-blue-500" />
      case 'DRAFT':
        return <FileText className="w-4 h-4 text-orange-500" />
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'Completed'
      case 'IN_PROGRESS': return 'In Progress'
      case 'DRAFT': return 'Draft'
      default: return status
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Check if paper writing feature is enabled
  if (!isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <BookOpen className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Paper Writing</h2>
          <p className="text-slate-600">Paper writing features are not currently enabled.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <LoadingBird message="Loading your dashboard..." useKishoFallback={true} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Header */}
        <div className="mb-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between"
          >
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}!
              </h1>
              <p className="text-slate-600 mt-1">
                Continue working on your research papers
              </p>
            </div>
            <button
              onClick={() => router.push('/papers/new')}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-violet-600 hover:bg-violet-700 shadow-lg shadow-violet-200 transition-all duration-200"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Paper
            </button>
          </motion.div>
        </div>

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
        >
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-100 rounded-lg">
                <BookOpenCheck className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">{stats.totalPapers}</div>
                <div className="text-sm text-slate-600">Total Papers</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">{stats.inProgress}</div>
                <div className="text-sm text-slate-600">In Progress</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">{stats.completed}</div>
                <div className="text-sm text-slate-600">Completed</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <BookOpen className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">{stats.totalCitations}</div>
                <div className="text-sm text-slate-600">Citations</div>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Papers */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-2"
          >
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-violet-600" />
                    Recent Papers
                  </h2>
                  <button
                    onClick={() => router.push('/papers')}
                    className="text-sm text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"
                  >
                    View All
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {papers.length === 0 ? (
                <div className="p-12 text-center">
                  <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-slate-900 mb-2">No papers yet</h3>
                  <p className="text-slate-600 mb-6">Start your academic writing journey</p>
                  <button
                    onClick={() => router.push('/papers/new')}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-violet-600 hover:bg-violet-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Paper
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {papers.map((paper, index) => (
                    <motion.div
                      key={paper.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 * index }}
                      onClick={() => router.push(`/papers/${paper.id}`)}
                      className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-slate-900 truncate">
                            {paper.title || 'Untitled Paper'}
                          </h3>
                          <div className="flex items-center gap-3 mt-1">
                            <div className="flex items-center gap-1">
                              {getStatusIcon(paper.status)}
                              <span className="text-xs text-slate-600">{getStatusText(paper.status)}</span>
                            </div>
                            {paper.paperType && (
                              <span className="text-xs text-slate-500">{paper.paperType.name}</span>
                            )}
                            <span className="text-xs text-slate-400">{formatDate(paper.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="ml-4 flex items-center gap-4">
                          {paper.progress !== undefined && (
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-slate-200 rounded-full h-1.5">
                                <div
                                  className="bg-violet-600 h-1.5 rounded-full"
                                  style={{ width: `${paper.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-600 w-8">{paper.progress}%</span>
                            </div>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* Quick Actions & Tips */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-6"
          >
            {/* Quick Actions */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-violet-600" />
                Quick Actions
              </h2>
              <div className="space-y-3">
                <button
                  onClick={() => router.push('/papers/new')}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-violet-200 hover:bg-violet-50 transition-colors text-left"
                >
                  <div className="p-2 bg-violet-100 rounded-lg">
                    <Plus className="w-4 h-4 text-violet-600" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900">Start New Paper</div>
                    <div className="text-xs text-slate-500">Create a new research paper</div>
                  </div>
                </button>
                <button
                  onClick={() => router.push('/papers')}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-200 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <BookOpenCheck className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900">Browse Papers</div>
                    <div className="text-xs text-slate-500">View all your papers</div>
                  </div>
                </button>
                <button
                  onClick={() => router.push('/library')}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-left"
                >
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <Library className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900">Reference Management</div>
                    <div className="text-xs text-slate-500">Organize your citations & libraries</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Writing Tips */}
            <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl border border-violet-100 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-violet-600" />
                Writing Tip
              </h2>
              <p className="text-sm text-slate-700">
                Start with your research question. A clear, focused research question will guide your entire paper and help you stay on track.
              </p>
            </div>

            {/* Word Count Stats */}
            {stats.totalWords > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-violet-600" />
                  Writing Progress
                </h2>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">Total Words Written</span>
                      <span className="font-medium text-slate-900">{stats.totalWords.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-violet-600 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min((stats.totalWords / 25000) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 mt-1">Target: 25,000 words</div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
