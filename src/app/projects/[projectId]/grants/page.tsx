'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, BrainCircuit, Loader2, Plus, Sparkles } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

type PrepSession = {
  id: string
  status: string
  mode: string
  engagement_mode: string
  overall_readiness: number
  updated_at: string
}

export default function ProjectGrantsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const params = useParams()
  const router = useRouter()
  const projectId = params?.projectId as string
  const [sessions, setSessions] = useState<PrepSession[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (user && projectId) {
      void loadSessions()
    }
  }, [authLoading, user, projectId, router])

  async function loadSessions() {
    try {
      setLoading(true)
      const response = await fetch(`/api/projects/${projectId}/grants`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to load project grants')
      }

      const data = await response.json()
      setSessions(data.prepSessions || [])
    } catch (error) {
      console.error('Failed to load grant prep sessions:', error)
    } finally {
      setLoading(false)
    }
  }

  async function startGrantPrep() {
    try {
      setCreating(true)
      const response = await fetch(`/api/projects/${projectId}/grants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({ engagementMode: 'guided' }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to start grant prep')
      }

      router.push(`/projects/${projectId}/grants/${data.session.id}/prep`)
    } catch (error) {
      console.error('Failed to create grant prep session:', error)
      alert(error instanceof Error ? error.message : 'Failed to create grant prep session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href={`/projects/${projectId}`}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="mb-1 flex items-center gap-2 text-sm font-mono text-ai-blue-600">
                <Sparkles className="h-4 w-4" />
                GRANT PREP
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Project Grants</h1>
              <p className="text-sm text-slate-500">Start or reopen grant-prep sessions for this project.</p>
            </div>
          </div>
          <button
            onClick={() => void startGrantPrep()}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-lg bg-ai-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-ai-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Start Grant Prep
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
            Loading grant sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <BrainCircuit className="mx-auto mb-4 h-12 w-12 text-slate-300" />
            <h2 className="text-lg font-semibold text-slate-900">No grant-prep sessions yet</h2>
            <p className="mt-2 text-sm text-slate-500">
              Create the first session to begin call-aware ideation and stage-based grant planning.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/projects/${projectId}/grants/${session.id}/prep`}
                className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-ai-blue-300 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{session.id}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-1 uppercase">{session.status}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">{session.mode}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">{session.engagement_mode}</span>
                    </div>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <div>{Math.round((session.overall_readiness || 0) * 100)}% ready</div>
                    <div className="text-xs">Updated {new Date(session.updated_at).toLocaleString()}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
