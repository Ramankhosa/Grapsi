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
  Compass,
  FileText,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  BarChart3,
  TrendingUp,
  Target,
  Library,
  Search,
  UserCircle,
  UploadCloud
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

interface UploadedFundingCall {
  id: string
  title: string
  agencyName?: string | null
  sourceUrl?: string | null
  closeDate?: string | null
  isRolling: boolean
  catalogStatus?: string | null
  guidelineStatus: string
  templateStatus: string
  adminReviewStatus?: string | null
  updatedAt: string
}

interface ActiveFundingUploadJob {
  id: string
  inputType: string
  sourceUrl?: string | null
  status: string
  linkedFundingCallId?: string | null
  errorMessage?: string | null
  updatedAt: string
}

export default function UserDashboard() {
  const { user, authFetch } = useAuth()
  const router = useRouter()
  const paperUiEnabled = false
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)
  const [fundingUploadsLoading, setFundingUploadsLoading] = useState(true)
  const [uploadedCalls, setUploadedCalls] = useState<UploadedFundingCall[]>([])
  const [activeUploadJobs, setActiveUploadJobs] = useState<ActiveFundingUploadJob[]>([])
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

  const fetchFundingUploads = useCallback(async () => {
    try {
      setFundingUploadsLoading(true)
      const response = await authFetch('/api/funding/user-uploads')
      if (response.ok) {
        const data = await response.json()
        setUploadedCalls(data.calls || [])
        setActiveUploadJobs(data.activeJobs || [])
      }
    } catch (error) {
      console.error('Error fetching funding uploads:', error)
    } finally {
      setFundingUploadsLoading(false)
    }
  }, [authFetch])

  // Use user_id instead of user object to prevent re-fetches on object reference changes
  const userId = user?.user_id
  
  useEffect(() => {
    if (userId && paperUiEnabled && isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
      fetchPapers()
    } else {
      setLoading(false)
    }
  }, [userId, fetchPapers, paperUiEnabled])

  useEffect(() => {
    if (userId) {
      fetchFundingUploads()
    } else {
      setFundingUploadsLoading(false)
    }
  }, [userId, fetchFundingUploads])

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

  const fundingActions = (
    <div className="space-y-3">
      <button
        onClick={() => router.push('/finder')}
        className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-left"
      >
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Search className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <div className="font-medium text-slate-900">Find Funding</div>
          <div className="text-xs text-slate-500">Search the directory and use the AI finder</div>
        </div>
      </button>
      <button
        onClick={() => router.push('/projects/new/grant')}
        className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-amber-200 hover:bg-amber-50 transition-colors text-left"
      >
        <div className="p-2 bg-amber-100 rounded-lg">
          <UploadCloud className="w-4 h-4 text-amber-600" />
        </div>
        <div>
          <div className="font-medium text-slate-900">Upload New Call For Proposal</div>
          <div className="text-xs text-slate-500">Upload a call, guidelines, and templates in a simple flow</div>
        </div>
      </button>
      <button
        onClick={() => router.push('/profile/researcher')}
        className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-sky-200 hover:bg-sky-50 transition-colors text-left"
      >
        <div className="p-2 bg-sky-100 rounded-lg">
          <UserCircle className="w-4 h-4 text-sky-600" />
        </div>
        <div>
          <div className="font-medium text-slate-900">Researcher Profile</div>
          <div className="text-xs text-slate-500">Add profile, eligibility, institution, and language details</div>
        </div>
      </button>
      <button
        onClick={() => router.push('/profile/research-areas')}
        className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-violet-200 hover:bg-violet-50 transition-colors text-left"
      >
        <div className="p-2 bg-violet-100 rounded-lg">
          <Compass className="w-4 h-4 text-violet-600" />
        </div>
        <div>
          <div className="font-medium text-slate-900">Research Areas</div>
          <div className="text-xs text-slate-500">Save focus areas and keywords for better funding matches</div>
        </div>
      </button>
    </div>
  )

  // Check if paper writing feature is enabled
  if (!paperUiEnabled || !isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-8 text-center">
            <BookOpen className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Grant Workspace</h2>
            <p className="text-slate-600">This deployment now exposes the grant-writing workspace only.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Funding Workspace</h3>
            {fundingActions}
          </div>
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-slate-900">My Uploaded Calls</h3>
              <button
                onClick={() => fetchFundingUploads()}
                className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
              >
                Refresh
              </button>
            </div>

            {fundingUploadsLoading ? (
              <div className="text-sm text-slate-500">Loading uploaded calls...</div>
            ) : uploadedCalls.length === 0 && activeUploadJobs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                No uploaded calls yet. Use Upload New Call For Proposal to add one.
              </div>
            ) : (
              <div className="space-y-3">
                {activeUploadJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                          Upload {job.status.replace(/_/g, ' ')}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {job.sourceUrl || `${job.inputType.toUpperCase()} upload`}
                        </div>
                        {job.errorMessage ? (
                          <div className="mt-1 text-xs text-red-700">{job.errorMessage}</div>
                        ) : (
                          <div className="mt-1 text-xs text-slate-500">Updated {formatDate(job.updatedAt)}</div>
                        )}
                      </div>
                      <button
                        onClick={() => router.push(`/projects/new/grant?jobId=${encodeURIComponent(job.id)}`)}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-slate-700"
                      >
                        Resume
                      </button>
                    </div>
                  </div>
                ))}

                {uploadedCalls.map((call) => (
                  <div key={call.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900">{call.title}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {call.agencyName || 'Funding agency'} - {call.isRolling ? 'Rolling deadline' : call.closeDate ? `Deadline ${new Date(call.closeDate).toLocaleDateString()}` : 'Deadline not set'}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                            Review {call.adminReviewStatus || 'pending'}
                          </span>
                          <span className="rounded-full bg-white px-2 py-1 text-slate-600">
                            Guidelines {call.guidelineStatus.replace(/_/g, ' ')}
                          </span>
                          <span className="rounded-full bg-white px-2 py-1 text-slate-600">
                            Template {call.templateStatus.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => router.push(`/finder/calls/${encodeURIComponent(call.id)}`)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-100"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                Continue working on your research papers and funding opportunities
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
                {fundingActions}
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
