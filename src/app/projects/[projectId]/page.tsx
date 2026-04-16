'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import NoveltySearchHistory from '@/components/novelty-search/NoveltySearchHistory'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import {
  FileText,
  Settings,
  UserPlus,
  Plus,
  ChevronRight,
  Search,
  PenTool,
  Eye,
  Trash2,
  AlertTriangle,
  X,
  Sparkles,
  Zap,
  ArrowLeft,
  Building2,
  Clock,
  Layers,
  BrainCircuit
} from 'lucide-react'

interface Collaborator {
  id: string
  role: string
  user: {
    id: string
    name: string | null
    email: string
  }
}

interface ApplicantProfile {
  id: string
  applicantLegalName: string
  applicantAddress: string | null
  applicantPhone: string | null
  applicantEmail: string | null
}

interface Patent {
  id: string
  title: string
  status?: string
  createdAt: string
}

interface Project {
  id: string
  name: string
  createdAt: string
  applicantProfile?: ApplicantProfile
  collaborators?: Collaborator[]
  patents?: Patent[]
}

export default function ProjectDashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [patents, setPatents] = useState<Patent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasDraftSessions, setHasDraftSessions] = useState<Record<string, boolean>>({})
  const [deleteDialog, setDeleteDialog] = useState<{ patentId: string; patentTitle: string; hasDrafts: boolean } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      const fetchProject = async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          })

          if (response.ok) {
            const data = await response.json()
            setProject(data.project)
          } else if (response.status === 404) {
            router.push('/dashboard')
          } else {
            console.error('Failed to fetch project')
            router.push('/dashboard')
          }
        } catch (error) {
          console.error('Failed to fetch project:', error)
          router.push('/dashboard')
        }
      }

      const fetchPatents = async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}/patents`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          })

          if (response.ok) {
            const data = await response.json()
            const list: Patent[] = data.patents || []
            setPatents(list)

            // Check for draft sessions per patent
            const sessionsMap: Record<string, boolean> = {}
            await Promise.all(
              list.map(async (p) => {
                try {
                  const res = await fetch(`/api/patents/${p.id}/drafting`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
                  })
                  if (res.ok) {
                    const draftData = await res.json()
                    sessionsMap[p.id] = Array.isArray(draftData.sessions) && draftData.sessions.length > 0
                  } else {
                    sessionsMap[p.id] = false
                  }
                } catch {
                  sessionsMap[p.id] = false
                }
              })
            )
            setHasDraftSessions(sessionsMap)
          }
        } catch (error) {
          console.error('Failed to fetch patents:', error)
        } finally {
          setIsLoading(false)
        }
      }

      fetchProject()
      fetchPatents()
    }
  }, [authLoading, user, router, projectId])

  const handleDeletePatent = async () => {
    if (!deleteDialog) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/patents/${deleteDialog.patentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        // Remove the patent from the list
        setPatents(patents.filter(p => p.id !== deleteDialog.patentId))
        setDeleteDialog(null)
        setDeleteConfirmText('')
      } else {
        const error = await response.json()
        alert(`Failed to delete patent: ${error.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to delete patent:', error)
      alert('Failed to delete patent. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const getStatusStyle = (status?: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
      case 'IN_PROGRESS':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
      case 'COMPLETED':
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
      default:
        return 'bg-slate-500/10 text-slate-600 border-slate-500/20'
    }
  }

  const formatStatus = (status?: string) => {
    if (!status) return 'Unknown'
    return status.replace(/_/g, ' ')
  }

  if (authLoading || isLoading) {
    return <PageLoadingBird message="Loading project..." />
  }

  if (!user || !project) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Subtle Background Grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-30" 
        style={{ 
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', 
          backgroundSize: '30px 30px' 
        }}
      />

      {/* Header */}
      <header className="relative z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link 
                href="/projects" 
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-all duration-200"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <div className="flex items-center gap-2 text-sm font-mono text-ai-blue-600 mb-1">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  PROJECT WORKSPACE
                </div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{project.name}</h1>
                <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-1">
                  <Clock className="w-3.5 h-3.5" />
                  Created {new Date(project.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/projects/${projectId}/setup`}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Manage</span>
              </Link>
              {!project.applicantProfile && (
                <Link
                  href={`/projects/${projectId}/applicant`}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-ai-blue-600 rounded-lg hover:bg-ai-blue-700 transition-all duration-200 shadow-sm"
                  title="Set up organization details for patent filings"
                >
                  <UserPlus className="w-4 h-4" />
                  <span className="hidden sm:inline">Add Profile</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        
        {/* Primary Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-ai-blue-500" />
            <h2 className="text-lg font-semibold text-slate-800">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href={`/patents/draft/new?projectId=${projectId}`}
              className="group flex items-center p-5 bg-white border-2 border-slate-200 rounded-xl hover:border-ai-blue-500/50 hover:shadow-lg hover:shadow-ai-blue-500/10 transition-all duration-300"
            >
              <div className="p-3 bg-ai-blue-50 rounded-xl mr-4 group-hover:bg-ai-blue-600 group-hover:text-white transition-colors">
                <PenTool className="w-6 h-6 text-ai-blue-600 group-hover:text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900 group-hover:text-ai-blue-600 transition-colors">Draft New Patent</h3>
                <p className="text-sm text-slate-500">Start AI-powered patent drafting workflow</p>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-ai-blue-500 group-hover:translate-x-1 transition-all" />
            </Link>

            <Link
              href={`/novelty-search?projectId=${projectId}`}
              className="group flex items-center p-5 bg-white border-2 border-slate-200 rounded-xl hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 transition-all duration-300"
            >
              <div className="p-3 bg-purple-50 rounded-xl mr-4 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <Search className="w-6 h-6 text-purple-600 group-hover:text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900 group-hover:text-purple-600 transition-colors">Novelty Search</h3>
                <p className="text-sm text-slate-500">Comprehensive patent novelty assessment</p>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-purple-500 group-hover:translate-x-1 transition-all" />
            </Link>
          </div>
        </motion.div>

        {/* Patents Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="mb-8"
        >
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-ai-blue-500" />
                  <h2 className="text-lg font-semibold text-slate-900">Patents</h2>
                  <span className="ml-2 px-2 py-0.5 text-xs font-mono bg-slate-100 text-slate-600 rounded-full">
                    {patents.length} total
                  </span>
                </div>
                <Link
                  href={`/patents/draft/new?projectId=${projectId}`}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-ai-blue-600 rounded-lg hover:bg-ai-blue-700 transition-all duration-200 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  New Patent
                </Link>
              </div>
            </div>

            <div className="p-6">
              {patents.length === 0 ? (
                <div className="text-center py-12">
                  <div className="relative inline-block mb-4">
                    <div className="absolute inset-0 bg-ai-blue-500/20 blur-2xl rounded-full" />
                    <div className="relative p-5 bg-slate-50 rounded-2xl border border-slate-200">
                      <Layers className="w-12 h-12 text-slate-300" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800 mb-2">No patents yet</h3>
                  <p className="text-slate-500 mb-6 max-w-sm mx-auto">
                    Start by creating your first patent application using our AI-powered drafting system.
                  </p>
                  <Link
                    href={`/patents/draft/new?projectId=${projectId}`}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-ai-blue-600 rounded-lg hover:bg-ai-blue-700 transition-all shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Create First Patent
                  </Link>
                </div>
              ) : (
                <div className="max-h-[1200px] overflow-y-auto pr-1">
                  <div className="space-y-3">
                    {patents.map((patent, index) => (
                      <motion.div
                        key={patent.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className="group flex items-center justify-between p-4 bg-slate-50 hover:bg-white border border-slate-200 hover:border-ai-blue-500/30 rounded-xl transition-all duration-200 hover:shadow-md"
                      >
                        <div className="flex-1 min-w-0 mr-4">
                          <h4 className="text-sm font-semibold text-slate-900 truncate group-hover:text-ai-blue-600 transition-colors">
                            {patent.title}
                          </h4>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${getStatusStyle(patent.status)}`}>
                              {formatStatus(patent.status)}
                            </span>
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(patent.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/projects/${projectId}/patents/${patent.id}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </Link>
                          <Link
                            href={`/patents/${patent.id}/draft`}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-ai-blue-600 rounded-lg hover:bg-ai-blue-700 transition-all"
                          >
                            <PenTool className="w-3.5 h-3.5" />
                            Resume
                          </Link>
                          <button
                            onClick={() => setDeleteDialog({
                              patentId: patent.id,
                              patentTitle: patent.title,
                              hasDrafts: hasDraftSessions[patent.id] || false
                            })}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 hover:border-red-300 transition-all"
                            title="Delete this patent"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Novelty Search History Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          id="novelty-search-history"
        >
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-purple-500" />
                <h2 className="text-lg font-semibold text-slate-900">Novelty Search History</h2>
              </div>
              <p className="text-sm text-slate-500 mt-1">View and access reports from previous novelty searches</p>
            </div>
            <div className="p-6">
              <NoveltySearchHistory projectId={projectId} showStats={false} />
            </div>
          </div>
        </motion.div>

        {/* Back to Projects */}
        <div className="mt-8 text-center">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Link>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      {deleteDialog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-red-100 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Delete Patent</h3>
                  <p className="text-sm text-slate-500">This action cannot be undone</p>
                </div>
                <button
                  onClick={() => {
                    setDeleteDialog(null)
                    setDeleteConfirmText('')
                  }}
                  className="ml-auto p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Are you sure you want to delete <strong className="text-slate-900">&quot;{deleteDialog.patentTitle}&quot;</strong>?
                </p>
                <p className="text-sm text-slate-500">
                  All patent data, including drafting sessions and generated content, will be permanently removed.
                </p>

                {deleteDialog.hasDrafts && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <p className="text-sm text-red-800 mb-3">
                      <strong>Warning:</strong> This patent has existing draft sessions. Type <strong>&quot;delete&quot;</strong> to confirm:
                    </p>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="Type 'delete' to confirm"
                      className="w-full px-4 py-2.5 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-all"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => {
                  setDeleteDialog(null)
                  setDeleteConfirmText('')
                }}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-all"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePatent}
                disabled={isDeleting || (deleteDialog.hasDrafts && deleteConfirmText.toLowerCase() !== 'delete')}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete Patent
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
