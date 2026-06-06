'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, ChevronRight, Clock, FileText, FileUp, Loader2, Search, Sparkles } from 'lucide-react'

import FundingCallImportModal from '@/components/FundingCallImportModal'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { useAuth } from '@/lib/auth-context'

interface Project {
  id: string
  name: string
  projectType?: 'PATENT' | 'GRANT'
  grantOpenUrl?: string | null
  latestGrantSession?: { id: string; status?: string; fundingCallId?: string | null } | null
  latestGrantPrepSession?: { id: string; status?: string; funding_call_id?: string | null } | null
  createdAt: string
}

type LaunchingAction = 'upload' | 'default' | null

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || payload?.details || 'Request failed')
  }
  return payload as T
}

export default function ProjectDashboardPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showFundingUpload, setShowFundingUpload] = useState(false)
  const [launchingAction, setLaunchingAction] = useState<LaunchingAction>(null)
  const [grantLaunchError, setGrantLaunchError] = useState<string | null>(null)

  const isStarting = launchingAction !== null
  const finderHref = `/finder?projectId=${encodeURIComponent(projectId)}`

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
              Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
            },
          })

          if (response.ok) {
            const data = await response.json()
            const nextProject = data.project as Project
            setProject(nextProject)

            if (nextProject.projectType === 'GRANT') {
              if (nextProject.grantOpenUrl) {
                router.replace(nextProject.grantOpenUrl)
                return
              }

              const effectiveFundingCallId =
                nextProject.latestGrantPrepSession?.funding_call_id ||
                nextProject.latestGrantSession?.fundingCallId ||
                null

              if (effectiveFundingCallId) {
                const grantResponse = await fetch(`/api/projects/${projectId}/grants`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
                  },
                  body: JSON.stringify({
                    fundingCallId: effectiveFundingCallId,
                    engagementMode: 'expert',
                  }),
                })
                const grantData = await grantResponse.json().catch(() => ({}))

                if (grantResponse.ok && grantData.launchUrl) {
                  router.replace(grantData.launchUrl)
                  return
                }
              }
            }
          } else if (response.status === 404) {
            router.push('/projects')
          } else {
            console.error('Failed to fetch project')
            router.push('/projects')
          }
        } catch (error) {
          console.error('Failed to fetch project:', error)
          router.push('/projects')
        } finally {
          setIsLoading(false)
        }
      }

      void fetchProject()
    }
  }, [authLoading, user, router, projectId])

  async function launchGrantPrep(payload: { fundingCallId?: string; useDefaultGrantFormat?: boolean }, action: LaunchingAction) {
    setLaunchingAction(action)
    setGrantLaunchError(null)

    try {
      const response = await readJsonResponse<{ launchUrl?: string | null; prepUrl?: string | null }>(
        await authFetch(`/api/projects/${encodeURIComponent(projectId)}/grants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            engagementMode: 'expert',
          }),
        })
      )

      setShowFundingUpload(false)
      setProject((current) => (current ? { ...current, projectType: 'GRANT' } : current))
      router.push(response.launchUrl || response.prepUrl || `/projects/${projectId}/grants`)
    } catch (err) {
      console.error('Failed to launch Grant Prep:', err)
      setGrantLaunchError(err instanceof Error ? err.message : 'Failed to launch Grant Prep')
      setLaunchingAction(null)
    }
  }

  async function handleBeginWriting(fundingCallId: string) {
    if (!fundingCallId) return
    await launchGrantPrep({ fundingCallId }, 'upload')
  }

  async function handleUseDefaultGrantFormat() {
    await launchGrantPrep({ useDefaultGrantFormat: true }, 'default')
  }

  if (authLoading || isLoading) {
    return <PageLoadingBird message="Loading project..." />
  }

  if (!user || !project) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }}
      />

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
                <div className="flex items-center gap-2 text-sm font-mono text-emerald-700 mb-1">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  GRANT PROJECT SETUP
                </div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{project.name}</h1>
                <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-1">
                  <Clock className="w-3.5 h-3.5" />
                  Created{' '}
                  {new Date(project.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur sm:p-8"
        >
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
              <Sparkles className="h-4 w-4" />
              Choose Grant Path
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">
              How do you want to start this grant project?
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Pick one path. The project stays the same whether you upload your own opportunity, select one from the
              funding database, or begin with the standard grant format.
            </p>
          </div>

          {grantLaunchError ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              {grantLaunchError}
            </div>
          ) : null}

          {isStarting ? (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-900">
              <Loader2 className="h-4 w-4 animate-spin" />
              {launchingAction === 'default'
                ? 'Starting Grant Prep with the standard grant format...'
                : 'Creating Grant Prep session for this project...'}
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                setGrantLaunchError(null)
                setShowFundingUpload(true)
              }}
              disabled={isStarting}
              className="group flex h-full flex-col rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition-all duration-300 hover:border-emerald-500/60 hover:shadow-lg hover:shadow-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
                <FileUp className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-950">I will provide my own funding opportunity</h3>
              <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">
                Paste the call text, add guideline text if available, and upload or paste an optional funder template.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                Upload opportunity <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </button>

            <Link
              href={finderHref}
              className="group flex h-full flex-col rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition-all duration-300 hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-500/10"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 transition-colors group-hover:bg-sky-600 group-hover:text-white">
                <Search className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-950">Search from the existing Funding Opportunities</h3>
              <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">
                Use the funding finder and AI chatbot, then write from a selected opportunity inside this project.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-sky-700">
                Search funding calls <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>

            <button
              type="button"
              onClick={() => void handleUseDefaultGrantFormat()}
              disabled={isStarting}
              className="group flex h-full flex-col rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition-all duration-300 hover:border-amber-500/60 hover:shadow-lg hover:shadow-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 transition-colors group-hover:bg-amber-500 group-hover:text-white">
                {launchingAction === 'default' ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileText className="h-6 w-6" />}
              </div>
              <h3 className="text-lg font-semibold text-slate-950">Use Default Grant Format</h3>
              <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">
                Start with the standard grant application fallback template when you do not have a specific call yet.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-amber-700">
                Start default format <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          </div>
        </motion.section>

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

      <FundingCallImportModal
        open={showFundingUpload && !isStarting}
        onClose={() => setShowFundingUpload(false)}
        onBeginWriting={handleBeginWriting}
        importEndpoint="/api/funding/imports"
        allowedCallModes={['text']}
        allowedGuidelineModes={['text', 'skip']}
        allowedTemplateModes={['file', 'text', 'skip']}
        storageKey={`project-${projectId}-funding-upload-wizard-v1`}
        eyebrow="Project funding call"
        title="Upload Funding Call for This Project"
        description="Paste the funding call text, review extracted details, optionally add guideline text and a funder template PDF/image/text, then start Grant Prep for this project. If no template is provided, the standard grant application template will be used."
      />
    </div>
  )
}
