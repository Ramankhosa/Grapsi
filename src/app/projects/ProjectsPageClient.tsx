'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { 
  FolderOpen, 
  Plus, 
  FileText, 
  ArrowLeft, 
  Sparkles, 
  Building2,
  ChevronRight,
  Layers,
  Zap
} from 'lucide-react'
import LoadingBird from '@/components/ui/loading-bird'

interface Project {
  id: string
  name: string
  projectType?: 'PATENT' | 'GRANT'
  grantOpenUrl?: string | null
  latestGrantSession?: { id: string; status?: string; fundingCallId?: string | null } | null
  latestGrantPrepSession?: { id: string; status?: string; funding_call_id?: string | null } | null
  createdAt: string
  patents?: { id: string; title?: string; status?: string }[]
  collaborators?: { id: string; user: { name: string; email: string } }[]
  applicantProfile?: { applicantLegalName: string }
  _count?: { patents: number; collaborators?: number }
}

export default function ProjectsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [creatingGrantPrepFor, setCreatingGrantPrepFor] = useState<string | null>(null)
  const fundingCallId = searchParams?.get('fundingCallId') || null

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (user) {
      fetchProjects()
    }
  }, [user, authLoading, router])

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects || [])
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
      case 'IN_PROGRESS': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
      case 'COMPLETED': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
      default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20'
    }
  }

  const startGrantPrepForProject = async (projectId: string, selectedFundingCallId?: string | null) => {
    try {
      const effectiveFundingCallId = selectedFundingCallId || fundingCallId
      if (!effectiveFundingCallId) {
        throw new Error('This grant project needs a linked funding call before GrantMentor can open.')
      }

      setCreatingGrantPrepFor(projectId)
      const response = await fetch(`/api/projects/${projectId}/grants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({
          fundingCallId: effectiveFundingCallId,
          engagementMode: 'expert',
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Failed to start grant prep')
      }

      if (!data.launchUrl) {
        throw new Error('This grant project needs a linked funding call before GrantMentor can open.')
      }

      router.push(data.launchUrl)
    } catch (error) {
      console.error('Failed to start grant prep:', error)
      alert(error instanceof Error ? error.message : 'Failed to start grant prep')
    } finally {
      setCreatingGrantPrepFor(null)
    }
  }

  const openProject = async (project: Project) => {
    if (project.projectType !== 'GRANT') {
      router.push(`/projects/${project.id}`)
      return
    }

    if (project.grantOpenUrl) {
      router.push(project.grantOpenUrl)
      return
    }

    await startGrantPrepForProject(
      project.id,
      project.latestGrantPrepSession?.funding_call_id || project.latestGrantSession?.fundingCallId || null
    )
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingBird message="Loading your projects..." useKishoFallback={true} />
      </div>
    )
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <Link 
                href="/dashboard" 
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-all duration-200"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <div className="flex items-center gap-2 text-sm font-mono text-ai-blue-600 mb-1">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  PROJECTS MODULE
                </div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Your Projects</h1>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-right">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">Signed in as</div>
                  <div className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{user?.email}</div>
                </div>
              </div>
              <Link href="/dashboard">
                <button className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-200">
                  Dashboard
                </button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Create Project Section - Hero Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700/50 shadow-2xl">
            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute -top-24 -right-24 w-96 h-96 bg-ai-blue-500/20 rounded-full blur-3xl" />
              <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-purple-500/15 rounded-full blur-3xl" />
              <div 
                className="absolute inset-0 opacity-20" 
                style={{ 
                  backgroundImage: 'radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)', 
                  backgroundSize: '24px 24px' 
                }}
              />
            </div>
            
            <div className="relative p-8">
              <div className="flex items-center justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-ai-blue-400" />
                    <span className="text-xs font-mono text-ai-blue-400 uppercase tracking-wider">Initialize New Instance</span>
                  </div>
                  <h2 className="text-2xl font-bold text-white">Create a New Project</h2>
                  <p className="text-slate-400 max-w-lg">
                    Launch a new project workspace for patent drafting or funding-linked grant preparation without mixing the two workflows.
                  </p>
                </div>
                <button
                  onClick={() => router.push('/projects/new')}
                  className="group flex items-center gap-3 px-6 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-[1.02]"
                >
                  <Plus className="w-5 h-5" />
                  <span>New Project</span>
                  <ChevronRight className="w-4 h-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all duration-200" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Projects Section Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-ai-blue-500" />
            <h2 className="text-lg font-semibold text-slate-800">Active Projects</h2>
            <span className="ml-2 px-2 py-0.5 text-xs font-mono bg-slate-100 text-slate-600 rounded-full">
              {projects.length} total
            </span>
          </div>
        </div>

        {fundingCallId ? (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            Choose a project to start grant prep for the selected funding call.
          </div>
        ) : null}

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-center py-20"
          >
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-ai-blue-500/20 blur-2xl rounded-full" />
              <div className="relative p-6 bg-white rounded-2xl border border-slate-200 shadow-lg">
                <Layers className="w-16 h-16 text-slate-300" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">No projects yet</h3>
            <p className="text-slate-500 mb-8 max-w-md mx-auto">
              Initialize your first project to begin organizing patent work or funding-linked grant preparation.
            </p>
            <button
              onClick={() => router.push('/projects/new')}
              className="inline-flex items-center gap-2 px-6 py-3 bg-ai-blue-600 text-white font-semibold rounded-xl hover:bg-ai-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <Plus className="w-5 h-5" />
              Create Your First Project
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.4 }}
              >
                <div className="group relative bg-white rounded-2xl border border-slate-200 hover:border-ai-blue-500/40 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden">
                  {/* Top accent bar */}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-ai-blue-500 via-purple-500 to-ai-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  <div className="p-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-slate-900 truncate group-hover:text-ai-blue-600 transition-colors">
                          {project.name}
                        </h3>
                        <p className="text-xs text-slate-400 font-mono mt-1">
                          Created {new Date(project.createdAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </p>
                        <div className="mt-2">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${project.projectType === 'GRANT' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                            {project.projectType === 'GRANT' ? 'Grant Project' : 'Patent Project'}
                          </span>
                        </div>
                      </div>
                      <div className="p-2 bg-slate-50 group-hover:bg-ai-blue-50 rounded-lg transition-colors">
                        <FolderOpen className="w-5 h-5 text-slate-400 group-hover:text-ai-blue-500 transition-colors" />
                      </div>
                    </div>

                    {/* Stats Row */}
                    <div className="space-y-3 mb-5">
                      {/* Applicant Info */}
                      {project.applicantProfile && (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Building2 className="w-4 h-4 text-slate-400" />
                          <span className="truncate">{project.applicantProfile.applicantLegalName}</span>
                        </div>
                      )}

                      {/* Patents Count */}
                      {project.projectType === 'GRANT' ? (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Sparkles className="w-4 h-4 text-emerald-500" />
                          <span>Funding-linked grant workflow</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <FileText className="w-4 h-4 text-slate-400" />
                          <span>
                            {(project as any)._count?.patents ?? project.patents?.length ?? 0} patent
                            {((project as any)._count?.patents ?? project.patents?.length ?? 0) !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}

                      {/* Patents Status Tags */}
                      {project.projectType !== 'GRANT' && project.patents && project.patents.length > 0 && project.patents.some((p: any) => (p as any).status) && (
                        <div className="flex flex-wrap gap-1.5">
                          {project.patents
                            .filter((p: any) => (p as any).status)
                            .slice(0, 3)
                            .map((patent: any) => (
                              <span 
                                key={patent.id} 
                                className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${getStatusColor(patent.status)}`}
                              >
                                {String(patent.status).replace('_', ' ')}
                              </span>
                            ))}
                          {project.patents.length > 3 && (
                            <span className="px-2 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-100 rounded-full">
                              +{project.patents.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="space-y-2">
                      {fundingCallId ? (
                        <button
                          onClick={() => void startGrantPrepForProject(project.id)}
                          disabled={creatingGrantPrepFor === project.id}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-all duration-200 group-hover:shadow-lg disabled:opacity-60"
                        >
                          <span>{creatingGrantPrepFor === project.id ? 'Starting...' : 'Start Grant Prep'}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void openProject(project)}
                        disabled={creatingGrantPrepFor === project.id}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-xl transition-all duration-200 group-hover:shadow-lg disabled:opacity-60"
                      >
                        <span>{creatingGrantPrepFor === project.id ? 'Opening...' : 'Open Project'}</span>
                        <ChevronRight className="w-4 h-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all duration-200" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
