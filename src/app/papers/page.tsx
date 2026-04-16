'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import LoadingBird from '@/components/ui/loading-bird'
import { motion } from 'framer-motion'
import {
  BookOpen,
  Plus,
  Search,
  Filter,
  Grid3X3,
  List,
  MoreHorizontal,
  Archive,
  Trash2,
  Download,
  Calendar,
  FileText,
  BookOpenCheck,
  Clock,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import { isFeatureEnabled } from '@/lib/feature-flags'

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
  progress?: number // 0-100
  citationsCount?: number
  wordCount?: number
  targetWordCount?: number
  createdAt: string
  updatedAt: string
}

type ViewMode = 'grid' | 'list'
type SortBy = 'created' | 'modified' | 'title' | 'progress'
type FilterStatus = 'all' | 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED'

export default function PapersPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortBy, setSortBy] = useState<SortBy>('modified')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPapers, setSelectedPapers] = useState<string[]>([])

  const fetchPapers = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/papers', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setPapers(data.papers || [])
      } else {
        console.error('Failed to fetch papers')
      }
    } catch (error) {
      console.error('Error fetching papers:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user && isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
      fetchPapers()
    }
  }, [user, fetchPapers])

  // Check if paper writing feature is enabled
  if (!isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Paper Writing Feature</h2>
          <p className="text-slate-600">This feature is not currently available.</p>
        </div>
      </div>
    )
  }

  const filteredAndSortedPapers = papers
    .filter(paper => {
      // Status filter
      if (filterStatus !== 'all' && paper.status !== filterStatus) return false

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          paper.title.toLowerCase().includes(query) ||
          paper.paperType?.name.toLowerCase().includes(query) ||
          paper.publicationVenue?.name.toLowerCase().includes(query)
        )
      }

      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'modified':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        case 'title':
          return a.title.localeCompare(b.title)
        case 'progress':
          return (b.progress || 0) - (a.progress || 0)
        default:
          return 0
      }
    })

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
      case 'COMPLETED':
        return 'Completed'
      case 'IN_PROGRESS':
        return 'In Progress'
      case 'DRAFT':
        return 'Draft'
      default:
        return status
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const handleBulkAction = async (action: 'archive' | 'delete' | 'export') => {
    if (selectedPapers.length === 0) return

    switch (action) {
      case 'archive':
        // Implement archive logic
        alert('Archive functionality not yet implemented')
        break
      case 'delete':
        if (confirm(`Delete ${selectedPapers.length} paper(s)? This action cannot be undone.`)) {
          // Implement delete logic
          alert('Delete functionality not yet implemented')
        }
        break
      case 'export':
        // Implement export logic
        alert('Bulk export functionality not yet implemented')
        break
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingBird message="Loading your papers..." useKishoFallback={true} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                <BookOpenCheck className="w-6 h-6 text-violet-600" />
                My Papers
              </h1>
              <p className="text-slate-600 mt-1">
                Manage and continue working on your research papers
              </p>
            </div>

            <button
              onClick={() => router.push('/papers/new')}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 transition-all duration-200"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Paper
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search papers by title, type, or venue..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            >
              <option value="all">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            >
              <option value="modified">Last Modified</option>
              <option value="created">Date Created</option>
              <option value="title">Title</option>
              <option value="progress">Progress</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex border border-slate-300 rounded-lg">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-violet-100 text-violet-600' : 'text-slate-600 hover:bg-slate-50'} rounded-l-lg`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-violet-100 text-violet-600' : 'text-slate-600 hover:bg-slate-50'} rounded-r-lg`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedPapers.length > 0 && (
          <div className="mb-4 p-3 bg-violet-50 border border-violet-200 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-violet-800">
                {selectedPapers.length} paper{selectedPapers.length > 1 ? 's' : ''} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleBulkAction('archive')}
                  className="px-3 py-1 text-sm bg-white border border-slate-300 rounded hover:bg-slate-50"
                >
                  <Archive className="w-4 h-4 inline mr-1" />
                  Archive
                </button>
                <button
                  onClick={() => handleBulkAction('export')}
                  className="px-3 py-1 text-sm bg-white border border-slate-300 rounded hover:bg-slate-50"
                >
                  <Download className="w-4 h-4 inline mr-1" />
                  Export
                </button>
                <button
                  onClick={() => handleBulkAction('delete')}
                  className="px-3 py-1 text-sm bg-red-600 text-white border border-red-600 rounded hover:bg-red-700"
                >
                  <Trash2 className="w-4 h-4 inline mr-1" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Papers Grid/List */}
        {filteredAndSortedPapers.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              {papers.length === 0 ? 'No papers yet' : 'No papers match your filters'}
            </h3>
            <p className="text-slate-600 mb-6">
              {papers.length === 0
                ? 'Get started by creating your first research paper.'
                : 'Try adjusting your search or filter criteria.'
              }
            </p>
            {papers.length === 0 && (
              <button
                onClick={() => router.push('/papers/new')}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 transition-all duration-200"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Paper
              </button>
            )}
          </div>
        ) : (
          <div className={viewMode === 'grid'
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
            : 'space-y-4'
          }>
            {filteredAndSortedPapers.map((paper) => (
              <motion.div
                key={paper.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer ${
                  viewMode === 'list' ? 'flex items-center p-4' : 'p-6'
                }`}
                onClick={() => router.push(`/papers/${paper.id}`)}
              >
                {viewMode === 'list' && (
                  <input
                    type="checkbox"
                    checked={selectedPapers.includes(paper.id)}
                    onChange={(e) => {
                      e.stopPropagation()
                      if (e.target.checked) {
                        setSelectedPapers(prev => [...prev, paper.id])
                      } else {
                        setSelectedPapers(prev => prev.filter(id => id !== paper.id))
                      }
                    }}
                    className="mr-4"
                  />
                )}

                <div className={viewMode === 'list' ? 'flex-1' : ''}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3
                        className={`font-semibold text-slate-900 ${
                          viewMode === 'list'
                            ? 'text-base truncate'
                            : 'text-lg leading-snug line-clamp-2 break-words'
                        }`}
                      >
                        {paper.title || 'Untitled Paper'}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        {getStatusIcon(paper.status)}
                        <span className="text-sm text-slate-600">{getStatusText(paper.status)}</span>
                        {paper.paperType && (
                          <>
                            <span className="text-slate-400">•</span>
                            <span className="text-sm text-slate-600">{paper.paperType.name}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {viewMode === 'grid' && (
                      <div className="ml-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            // Handle more options menu
                          }}
                          className="p-1 text-slate-400 hover:text-slate-600"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {viewMode === 'grid' && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm text-slate-600 mb-1">
                        <span>Progress</span>
                        <span>{paper.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className="bg-violet-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${paper.progress || 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className={`flex items-center justify-between ${viewMode === 'list' ? 'text-sm' : 'text-sm'}`}>
                    <div className="flex items-center gap-4 text-slate-500">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {paper.citationsCount || 0} citations
                      </span>
                      {paper.wordCount && (
                        <span className="flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />
                          {paper.wordCount} words
                        </span>
                      )}
                    </div>

                    <div className="text-right text-slate-500">
                      <div className="text-xs">Modified</div>
                      <div className="text-xs font-medium">{formatDate(paper.updatedAt)}</div>
                    </div>
                  </div>

                  {paper.publicationVenue && (
                    <div className="mt-2 text-xs text-slate-500">
                      Target: {paper.publicationVenue.name}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
