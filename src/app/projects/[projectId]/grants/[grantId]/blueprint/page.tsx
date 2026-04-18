'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowDown, ArrowUp, Loader2, RefreshCw, Save, Snowflake } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

type BlueprintSection = {
  sectionKey: string
  label: string
  order: number
  sectionType: 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows'
  required: boolean
  wordBudget: number | null
  characterLimit: number | null
  purpose: string
  reviewerIntent: string | null
  dependencies: string[]
  sourceTemplatePointer: string | null
  mustCover: string[]
  mustAvoid: string[]
  seededContext: string
}

type BlueprintResponse = {
  grantSession: {
    id: string
    status: string
    project: { id: string; name: string }
    fundingCall: { scheme_title?: string | null; agency_name?: string | null } | null
  }
  blueprint: {
    id: string
    status: string
    sectionPlan: BlueprintSection[]
  } | null
  launchPreview: {
    blockers: Array<{ stageKey: string; pointKey: string; message: string }>
    canLaunch: boolean
  } | null
}

function sortSections(sections: BlueprintSection[]) {
  return [...sections].sort((a, b) => a.order - b.order)
}

export default function GrantBlueprintPage() {
  const params = useParams()
  const router = useRouter()
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const projectId = params?.projectId as string
  const grantId = params?.grantId as string

  const [workspace, setWorkspace] = useState<BlueprintResponse | null>(null)
  const [draftPlan, setDraftPlan] = useState<BlueprintSection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actioning, setActioning] = useState<null | 'freeze' | 'unfreeze' | 'regenerate'>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
      return
    }

    if (user && projectId && grantId) {
      void loadWorkspace()
    }
  }, [authLoading, user, projectId, grantId, router])

  async function loadWorkspace() {
    try {
      setLoading(true)
      setError(null)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load the grant blueprint')
      }
      setWorkspace(data)
      setDraftPlan(sortSections(data.blueprint?.sectionPlan || []))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load the grant blueprint')
    } finally {
      setLoading(false)
    }
  }

  const blockers = workspace?.launchPreview?.blockers || []
  const isFrozen = workspace?.blueprint?.status === 'FROZEN'

  const summary = useMemo(() => {
    const sections = draftPlan.length
    const required = draftPlan.filter((section) => section.required).length
    return { sections, required }
  }, [draftPlan])

  function moveSection(sectionKey: string, direction: -1 | 1) {
    setDraftPlan((current) => {
      const sorted = sortSections(current)
      const index = sorted.findIndex((section) => section.sectionKey === sectionKey)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
        return current
      }

      const next = [...sorted]
      const [section] = next.splice(index, 1)
      next.splice(targetIndex, 0, section)
      return next.map((item, idx) => ({ ...item, order: idx + 1 }))
    })
  }

  function updateSection(sectionKey: string, patch: Partial<BlueprintSection>) {
    setDraftPlan((current) =>
      current.map((section) =>
        section.sectionKey === sectionKey ? { ...section, ...patch } : section
      )
    )
  }

  async function saveBlueprint() {
    try {
      setSaving(true)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: draftPlan }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save the grant blueprint')
      }
      await loadWorkspace()
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : 'Failed to save the grant blueprint')
    } finally {
      setSaving(false)
    }
  }

  async function runAction(action: 'freeze' | 'unfreeze' | 'regenerate') {
    try {
      setActioning(action)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || `Failed to ${action} blueprint`)
      }
      await loadWorkspace()
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : `Failed to ${action} blueprint`)
    } finally {
      setActioning(null)
    }
  }

  if (authLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">Loading blueprint...</div>
  }

  if (error || !workspace?.grantSession) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Blueprint unavailable</div>
          <p className="mt-3 text-sm text-slate-600">{error || 'The local grant workspace is not ready yet.'}</p>
          <Link href={`/projects/${projectId}/grants`} className="mt-6 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Back to Grants
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href={`/projects/${projectId}/grants`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" />
              Back to Grants
            </Link>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Grant Blueprint</h1>
            <p className="mt-2 text-sm text-slate-600">
              {workspace.grantSession.fundingCall?.scheme_title || 'Local grant workspace'}
              {workspace.grantSession.fundingCall?.agency_name ? ` - ${workspace.grantSession.fundingCall.agency_name}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveBlueprint()}
              disabled={saving || actioning !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Plan
            </button>
            <button
              type="button"
              onClick={() => void runAction(isFrozen ? 'unfreeze' : 'freeze')}
              disabled={saving || actioning !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {actioning === 'freeze' || actioning === 'unfreeze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake className="h-4 w-4" />}
              {isFrozen ? 'Unfreeze Blueprint' : 'Freeze Blueprint'}
            </button>
            <button
              type="button"
              onClick={() => void runAction('regenerate')}
              disabled={saving || actioning !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
            >
              {actioning === 'regenerate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Regenerate from Prep
            </button>
            <Link href={`/projects/${projectId}/grants/${grantId}/draft`} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100">
              Open Draft Workspace
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{workspace.blueprint?.status || 'Not launched'}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sections</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{summary.sections}</div>
            <div className="mt-1 text-sm text-slate-500">{summary.required} required sections</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Launch blockers</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{blockers.length}</div>
            <div className="mt-1 text-sm text-slate-500">Resolved during prep before local launch</div>
          </div>
        </div>

        {blockers.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <div className="font-semibold">Prep blockers carried into launch preview</div>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {blockers.map((blocker) => (
                <li key={`${blocker.stageKey}_${blocker.pointKey}`}>{blocker.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-4">
          {draftPlan.map((section, index) => (
            <div key={section.sectionKey} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{index + 1}</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{section.sectionType}</span>
                    {section.required ? <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Required</span> : null}
                  </div>
                  <input
                    value={section.label}
                    onChange={(event) => updateSection(section.sectionKey, { label: event.target.value })}
                    className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-slate-500"
                    disabled={isFrozen}
                  />
                  <textarea
                    value={section.seededContext || ''}
                    onChange={(event) => updateSection(section.sectionKey, { seededContext: event.target.value })}
                    className="mt-3 min-h-[88px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500"
                    disabled={isFrozen}
                    placeholder="Seeded context from grant prep will appear here. You can refine it before freezing the blueprint."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => moveSection(section.sectionKey, -1)} disabled={isFrozen || index === 0} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => moveSection(section.sectionKey, 1)} disabled={isFrozen || index === draftPlan.length - 1} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Purpose</div>
                  <textarea
                    value={section.purpose}
                    onChange={(event) => updateSection(section.sectionKey, { purpose: event.target.value })}
                    disabled={isFrozen}
                    className="mt-2 min-h-[88px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Must Cover</div>
                  <textarea
                    value={section.mustCover.join('\n')}
                    onChange={(event) => updateSection(section.sectionKey, { mustCover: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })}
                    disabled={isFrozen}
                    className="mt-2 min-h-[88px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
