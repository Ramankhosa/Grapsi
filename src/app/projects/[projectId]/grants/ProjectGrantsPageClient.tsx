'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, BrainCircuit, ExternalLink, FileText, Loader2, Plus, Sparkles } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import { deriveGrantPrepPriorityAreaOptions } from '@/lib/grantPrep/priorityAreas'

type PrepSession = {
  id: string
  status: string
  mode: string
  engagement_mode: string
  overall_readiness: number
  updated_at: string
  grant_session_id?: string | null
  papsi_launch_url?: string | null
}

type GrantSession = {
  id: string
  status: string
  fundingCallId: string | null
  updatedAt: string
}

function formatEngagementModeLabel(value: string) {
  if (value === 'expert') return 'Expert'
  if (value === 'express') return 'Express'
  return value
}

export default function ProjectGrantsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = params?.projectId as string
  const fundingCallId = searchParams?.get('fundingCallId') || null
  const [sessions, setSessions] = useState<PrepSession[]>([])
  const [grantSessions, setGrantSessions] = useState<GrantSession[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [creatingForGrant, setCreatingForGrant] = useState<string | null>(null)
  const [callPriorityOptions, setCallPriorityOptions] = useState<string[]>([])
  const [selectedPriorityAreas, setSelectedPriorityAreas] = useState<string[]>([])

  const loadSessions = useCallback(async () => {
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
      setGrantSessions(data.grantSessions || [])
    } catch (error) {
      console.error('Failed to load project grants:', error)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (user && projectId) {
      void loadSessions()
    }
  }, [authLoading, user, projectId, router, loadSessions])

  useEffect(() => {
    if (!user || !fundingCallId) {
      setCallPriorityOptions([])
      setSelectedPriorityAreas([])
      return
    }

    let canceled = false
    const loadCallPriorityOptions = async () => {
      try {
        const response = await fetch(`/api/funding/calls/${encodeURIComponent(fundingCallId)}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
          },
        })
        if (!response.ok) return
        const data = await response.json()
        if (canceled) return
        const options = deriveGrantPrepPriorityAreaOptions({
          disciplines: data.call?.disciplines,
          focusAreas: data.call?.focusAreas,
        })
        setCallPriorityOptions(options)
        setSelectedPriorityAreas(options.length === 1 ? options : [])
      } catch {
        if (!canceled) {
          setCallPriorityOptions([])
          setSelectedPriorityAreas([])
        }
      }
    }

    void loadCallPriorityOptions()
    return () => {
      canceled = true
    }
  }, [fundingCallId, user])

  function togglePriorityArea(area: string) {
    if (callPriorityOptions.length === 1) {
      setSelectedPriorityAreas(callPriorityOptions)
      return
    }

    setSelectedPriorityAreas((current) => {
      const selected = current.some((item) => item.toLowerCase() === area.toLowerCase())
      return selected
        ? current.filter((item) => item.toLowerCase() !== area.toLowerCase())
        : [...current, area]
    })
  }

  async function startGrantPrep(selectedFundingCallId?: string | null) {
    try {
      const effectiveFundingCallId =
        selectedFundingCallId ||
        fundingCallId ||
        grantSessions.find((session) => session.fundingCallId)?.fundingCallId ||
        null
      if (!effectiveFundingCallId) {
        throw new Error('This grant project needs a linked funding call before GrantMentor can open.')
      }
      if (fundingCallId && callPriorityOptions.length > 1 && selectedPriorityAreas.length === 0) {
        throw new Error('Select at least one target priority area before starting Grant Prep.')
      }

      setCreating(true)
      const response = await fetch(`/api/projects/${projectId}/grants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({
          engagementMode: 'expert',
          fundingCallId: effectiveFundingCallId,
          selectedPriorityAreas: fundingCallId ? selectedPriorityAreas : undefined,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to start grant prep')
      }

      if (!data.launchUrl) {
        throw new Error('This grant project needs a linked funding call before GrantMentor can open.')
      }

      router.push(data.launchUrl)
    } catch (error) {
      console.error('Failed to create grant prep session:', error)
      alert(error instanceof Error ? error.message : 'Failed to create grant prep session')
    } finally {
      setCreating(false)
    }
  }

  async function startGrantPrepFromWorkspace(grantSessionId: string) {
    setCreatingForGrant(grantSessionId)
    router.push(`/projects/${projectId}/grants/${grantSessionId}/workspace?stage=GRANTMENTOR`)
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
              <p className="text-sm text-slate-500">Local grant prep, blueprint, drafting, and export for this project.</p>
            </div>
          </div>
          <button
            onClick={() => void startGrantPrep()}
            disabled={creating || (Boolean(fundingCallId) && callPriorityOptions.length > 1 && selectedPriorityAreas.length === 0)}
            className="inline-flex items-center gap-2 rounded-lg bg-ai-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-ai-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {fundingCallId ? 'Start Grant Prep for Call' : 'Start Grant Prep'}
          </button>
        </div>

        {fundingCallId ? (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div>This project can start grant prep directly from the selected funding call.</div>
            {callPriorityOptions.length > 0 ? (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
                  Target Priority Areas
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {callPriorityOptions.map((area) => {
                    const selected = callPriorityOptions.length === 1 ||
                      selectedPriorityAreas.some((item) => item.toLowerCase() === area.toLowerCase())
                    return (
                      <button
                        key={area}
                        type="button"
                        onClick={() => togglePriorityArea(area)}
                        disabled={callPriorityOptions.length === 1 || creating}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                          selected
                            ? 'border-emerald-300 bg-white text-emerald-900'
                            : 'border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-white'
                        } ${callPriorityOptions.length === 1 || creating ? 'cursor-not-allowed opacity-75' : ''}`}
                      >
                        {area}
                      </button>
                    )
                  })}
                </div>
                {callPriorityOptions.length > 1 && selectedPriorityAreas.length === 0 ? (
                  <div className="mt-2 text-xs font-medium text-amber-800">
                    Select at least one target priority area before starting.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
            Loading grant sessions...
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                <BrainCircuit className="h-4 w-4" />
                Grant Prep Sessions
              </div>
              {sessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                  <BrainCircuit className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                  <h2 className="text-lg font-semibold text-slate-900">No grant-prep sessions yet</h2>
                  <p className="mt-2 text-sm text-slate-500">Create the first session to begin call-aware grant preparation.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {sessions.map((session) => (
                    <div key={session.id} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-ai-blue-300 hover:shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Link
                          href={session.papsi_launch_url || `/projects/${projectId}/grants`}
                          className="flex-1"
                        >
                          <div className="text-sm font-medium text-slate-900">{session.id}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                            <span className="rounded-full bg-slate-100 px-2 py-1 uppercase">{session.status}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">{session.mode}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">{formatEngagementModeLabel(session.engagement_mode)}</span>
                          </div>
                        </Link>
                        <div className="text-right text-sm text-slate-500">
                          <div>{Math.round((session.overall_readiness || 0) * 100)}% ready</div>
                          <div className="text-xs">Updated {new Date(session.updated_at).toLocaleString()}</div>
                        </div>
                        {session.papsi_launch_url ? (
                          <Link href={session.papsi_launch_url} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                            <ExternalLink className="h-4 w-4" />
                            Open Grant Workspace
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                <FileText className="h-4 w-4" />
                Local Grant Workspaces
              </div>
              {grantSessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                  No local grant workspaces have been launched from prep yet.
                </div>
              ) : (
                <div className="grid gap-4">
                  {grantSessions.map((grantSession) => (
                    <div key={grantSession.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{grantSession.id}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                            <span className="rounded-full bg-slate-100 px-2 py-1 uppercase">{grantSession.status}</span>
                            {grantSession.fundingCallId ? <span className="rounded-full bg-slate-100 px-2 py-1">Funding-linked</span> : null}
                          </div>
                          <div className="mt-2 text-xs text-slate-500">Updated {new Date(grantSession.updatedAt).toLocaleString()}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/projects/${projectId}/grants/${grantSession.id}/workspace`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            Workspace
                          </Link>
                          <Link href={`/projects/${projectId}/grants/${grantSession.id}/workspace?stage=SECTION_DRAFTING`} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100">
                            Draft
                          </Link>
                          <button
                            type="button"
                            onClick={() => void startGrantPrepFromWorkspace(grantSession.id)}
                            disabled={creatingForGrant === grantSession.id}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            {creatingForGrant === grantSession.id ? 'Opening...' : 'Open Prep'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
