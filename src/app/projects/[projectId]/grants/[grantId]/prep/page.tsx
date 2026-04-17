'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, RefreshCcw, Send } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

type PrepMessage = {
  id: string
  role: string
  content: string
  stage_key?: string | null
}

type PrepStage = {
  stageKey: string
  title: string
  enabled: boolean
  pickable: boolean
  readiness: number
  status: string
}

type PrepContext = {
  activeStageKey: string
  warning: string | null
  stageStates: Record<string, PrepStage>
}

type PrepSession = {
  id: string
  status: string
  project: {
    id: string
    project_title?: string
  }
  messages: PrepMessage[]
}

export default function GrantPrepWorkspacePage() {
  const { user, isLoading: authLoading } = useAuth()
  const params = useParams()
  const router = useRouter()
  const projectId = params?.projectId as string
  const grantId = params?.grantId as string
  const [session, setSession] = useState<PrepSession | null>(null)
  const [prepContext, setPrepContext] = useState<PrepContext | null>(null)
  const [fundingContext, setFundingContext] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (user && grantId) {
      void loadSession()
    }
  }, [authLoading, user, grantId, router])

  async function loadSession() {
    try {
      setLoading(true)
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load grant prep session')
      }

      setSession(data.session)
      setPrepContext(data.prepContext)
      setFundingContext(data.fundingContext)
    } catch (error) {
      console.error('Failed to load grant prep session:', error)
      alert(error instanceof Error ? error.message : 'Failed to load grant prep session')
    } finally {
      setLoading(false)
    }
  }

  async function sendMessage() {
    if (!message.trim()) return

    try {
      setSending(true)
      const response = await fetch(`/api/grant-prep/sessions/${grantId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({
          content: message.trim(),
          stageKey: prepContext?.activeStageKey,
          clientMessageId: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to send message')
      }

      setSession((current) =>
        current
          ? {
              ...current,
              status: data.sessionStatus || current.status,
              messages: [...current.messages, { id: `local_${Date.now()}`, role: 'user', content: message.trim() }, data.message],
            }
          : current
      )
      setPrepContext(data.prepContext)
      setMessage('')
    } catch (error) {
      console.error('Failed to send grant prep message:', error)
      alert(error instanceof Error ? error.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  async function refreshMapping() {
    try {
      setRefreshing(true)
      const response = await fetch(`/api/grant-prep/sessions/${grantId}/refresh-mapping`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to refresh mapping')
      }

      setPrepContext(data.prepContext)
      setSession((current) => (current ? { ...current, status: data.sessionStatus || current.status } : current))
    } catch (error) {
      console.error('Failed to refresh mapping:', error)
      alert(error instanceof Error ? error.message : 'Failed to refresh mapping')
    } finally {
      setRefreshing(false)
    }
  }

  async function setActiveStage(stageKey: string) {
    try {
      const response = await fetch(`/api/grant-prep/sessions/${grantId}/active-stage`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({ stageKey }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to switch stage')
      }

      setPrepContext((current) => (current ? { ...current, activeStageKey: data.activeStageKey } : current))
    } catch (error) {
      console.error('Failed to update active stage:', error)
      alert(error instanceof Error ? error.message : 'Failed to switch stage')
    }
  }

  const stages = useMemo(
    () =>
      Object.values(prepContext?.stageStates || {}).filter((stage) => stage.enabled && stage.pickable),
    [prepContext]
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-10 text-center text-slate-500">
        Loading grant-prep workspace...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href={`/projects/${projectId}/grants`}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {session?.project?.project_title || 'Grant Prep Workspace'}
              </h1>
              <p className="text-sm text-slate-500">
                {fundingContext?.title || 'No linked funding call yet'}
              </p>
            </div>
          </div>
          <button
            onClick={() => void refreshMapping()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh Mapping
          </button>
        </div>

        {prepContext?.warning && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {prepContext.warning}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Stages</h2>
            <div className="space-y-2">
              {stages.map((stage) => (
                <button
                  key={stage.stageKey}
                  onClick={() => void setActiveStage(stage.stageKey)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    prepContext?.activeStageKey === stage.stageKey
                      ? 'border-ai-blue-500 bg-ai-blue-50 text-ai-blue-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-medium">{stage.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {Math.round((stage.readiness || 0) * 100)}% ready · {stage.status}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="text-sm font-medium text-slate-900">
                Active Stage: {prepContext?.stageStates?.[prepContext.activeStageKey]?.title || prepContext?.activeStageKey}
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
                {(session?.messages || []).map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-2xl px-4 py-3 text-sm ${
                      entry.role === 'assistant'
                        ? 'mr-10 border border-slate-200 bg-slate-50 text-slate-800'
                        : 'ml-10 bg-ai-blue-600 text-white'
                    }`}
                  >
                    <div className="mb-1 text-[11px] uppercase tracking-wide opacity-70">{entry.role}</div>
                    <div className="whitespace-pre-wrap">{entry.content}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 pt-4">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Describe your idea, answer the current question, or paste a rough draft."
                  className="min-h-[140px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-ai-blue-500"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => void sendMessage()}
                    disabled={sending || !message.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-ai-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-ai-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
