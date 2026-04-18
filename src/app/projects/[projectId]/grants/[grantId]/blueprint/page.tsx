'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, RefreshCw, Save, Search, Snowflake } from 'lucide-react'

import GrantBlueprintFoundationCard from '@/components/grants/GrantBlueprintFoundationCard'
import GrantBlueprintSectionCard from '@/components/grants/GrantBlueprintSectionCard'
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

type ProposalFoundation = {
  thesisStatement: string
  centralObjective: string
  keyContributions: string[]
  status: string | null
  version: number | null
}

type FreezeReadiness = {
  ok: boolean
  issues: string[]
}

type BlueprintResponse = {
  grantSession: {
    id: string
    status: string
    projectId: string
    project: { id: string; name: string }
    fundingCall: { scheme_title?: string | null; agency_name?: string | null } | null
  }
  blueprint: {
    id: string
    status: string
    version: number
    sectionPlan: BlueprintSection[]
  } | null
  proposalFoundation: ProposalFoundation
  freezeReadiness: FreezeReadiness
  launchPreview: {
    blockers: Array<{ stageKey: string; pointKey: string; message: string }>
    canLaunch: boolean
  } | null
}

type SectionFilter = 'all' | 'draftable' | 'structured' | 'required'

function sortSections(sections: BlueprintSection[]) {
  return [...sections].sort((a, b) => a.order - b.order)
}

function isDraftable(sectionType: BlueprintSection['sectionType']) {
  return sectionType === 'narrative' || sectionType === 'short_answer'
}

function normalizeFoundation(foundation: ProposalFoundation) {
  return {
    thesisStatement: foundation.thesisStatement.trim(),
    centralObjective: foundation.centralObjective.trim(),
    keyContributions: foundation.keyContributions.map((item) => item.trim()).filter(Boolean),
  }
}

function normalizeSections(sections: BlueprintSection[]) {
  return sortSections(sections).map((section) => ({
    ...section,
    label: section.label.trim(),
    purpose: section.purpose.trim(),
    seededContext: section.seededContext.trim(),
    mustCover: section.mustCover.map((item) => item.trim()).filter(Boolean),
    mustAvoid: section.mustAvoid.map((item) => item.trim()).filter(Boolean),
    dependencies: section.dependencies.map((item) => item.trim()).filter(Boolean),
  }))
}

export default function GrantBlueprintPage() {
  const params = useParams()
  const router = useRouter()
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const projectId = params?.projectId as string
  const grantId = params?.grantId as string

  const [workspace, setWorkspace] = useState<BlueprintResponse | null>(null)
  const [draftPlan, setDraftPlan] = useState<BlueprintSection[]>([])
  const [foundation, setFoundation] = useState<ProposalFoundation>({
    thesisStatement: '',
    centralObjective: '',
    keyContributions: ['', ''],
    status: null,
    version: null,
  })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SectionFilter>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actioning, setActioning] = useState<null | 'freeze' | 'unfreeze' | 'regenerate'>(null)
  const [error, setError] = useState<string | null>(null)

  const loadWorkspace = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load the grant blueprint')
      }
      const nextFoundation = data.proposalFoundation || {
        thesisStatement: '',
        centralObjective: '',
        keyContributions: [],
        status: null,
        version: null,
      }

      setWorkspace(data)
      setDraftPlan(sortSections(data.blueprint?.sectionPlan || []))
      setFoundation({
        ...nextFoundation,
        keyContributions:
          Array.isArray(nextFoundation.keyContributions) && nextFoundation.keyContributions.length > 0
            ? nextFoundation.keyContributions
            : ['', ''],
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load the grant blueprint')
    } finally {
      setLoading(false)
    }
  }, [authFetch, grantId, projectId])

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
      return
    }

    if (user && projectId && grantId) {
      void loadWorkspace()
    }
  }, [authLoading, user, projectId, grantId, router, loadWorkspace])

  const blockers = workspace?.launchPreview?.blockers || []
  const isFrozen = workspace?.blueprint?.status === 'FROZEN'
  const freezeReadiness = workspace?.freezeReadiness || { ok: false, issues: [] }

  const summary = useMemo(() => {
    const sections = draftPlan.length
    const required = draftPlan.filter((section) => section.required).length
    const draftable = draftPlan.filter((section) => isDraftable(section.sectionType)).length
    return { sections, required, draftable }
  }, [draftPlan])

  const filteredSections = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sortSections(draftPlan).filter((section) => {
      if (filter === 'draftable' && !isDraftable(section.sectionType)) return false
      if (filter === 'structured' && isDraftable(section.sectionType)) return false
      if (filter === 'required' && !section.required) return false

      if (!query) return true
      return (
        section.label.toLowerCase().includes(query) ||
        section.sectionKey.toLowerCase().includes(query)
      )
    })
  }, [draftPlan, filter, search])

  const hasUnsavedChanges = useMemo(() => {
    if (!workspace?.blueprint) return false

    const savedFoundation = normalizeFoundation({
      ...workspace.proposalFoundation,
      keyContributions: workspace.proposalFoundation.keyContributions || [],
    })
    const currentFoundation = normalizeFoundation(foundation)
    const savedSections = normalizeSections(workspace.blueprint.sectionPlan || [])
    const currentSections = normalizeSections(draftPlan)

    return (
      JSON.stringify(savedFoundation) !== JSON.stringify(currentFoundation) ||
      JSON.stringify(savedSections) !== JSON.stringify(currentSections)
    )
  }, [draftPlan, foundation, workspace])

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

  function updateFoundation(patch: Partial<ProposalFoundation>) {
    setFoundation((current) => ({ ...current, ...patch }))
  }

  function updateContribution(index: number, value: string) {
    setFoundation((current) => ({
      ...current,
      keyContributions: current.keyContributions.map((item, itemIndex) =>
        itemIndex === index ? value : item
      ),
    }))
  }

  function addContribution() {
    setFoundation((current) => ({
      ...current,
      keyContributions: [...current.keyContributions, ''],
    }))
  }

  function removeContribution(index: number) {
    setFoundation((current) => {
      const next = current.keyContributions.filter((_, itemIndex) => itemIndex !== index)
      return {
        ...current,
        keyContributions: next.length > 0 ? next : [''],
      }
    })
  }

  async function saveBlueprint() {
    try {
      setSaving(true)
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections: draftPlan,
          foundation: normalizeFoundation(foundation),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save the grant blueprint')
      }
      await loadWorkspace()
      return true
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : 'Failed to save the grant blueprint')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function runAction(action: 'freeze' | 'unfreeze' | 'regenerate') {
    try {
      setActioning(action)

      if (action === 'freeze' && hasUnsavedChanges) {
        const saved = await saveBlueprint()
        if (!saved) {
          return
        }
      }

      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const issueMessage = Array.isArray(data.issues) && data.issues.length > 0
          ? data.issues.join('\n')
          : data.message || `Failed to ${action} blueprint`
        throw new Error(issueMessage)
      }
      await loadWorkspace()
    } catch (nextError) {
      alert(nextError instanceof Error ? nextError.message : `Failed to ${action} blueprint`)
    } finally {
      setActioning(null)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        Loading blueprint...
      </div>
    )
  }

  if (error || !workspace?.grantSession) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Blueprint unavailable</div>
          <p className="mt-3 text-sm text-slate-600">
            {error || 'The local grant workspace is not ready yet.'}
          </p>
          <Link
            href={`/projects/${projectId}/grants`}
            className="mt-6 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
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
            <Link
              href={`/projects/${projectId}/grants`}
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Grants
            </Link>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Grant Blueprint</h1>
            <p className="mt-2 text-sm text-slate-600">
              {workspace.grantSession.fundingCall?.scheme_title || 'Local grant workspace'}
              {workspace.grantSession.fundingCall?.agency_name
                ? ` - ${workspace.grantSession.fundingCall.agency_name}`
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveBlueprint()}
              disabled={saving || actioning !== null || isFrozen}
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
              {actioning === 'freeze' || actioning === 'unfreeze' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Snowflake className="h-4 w-4" />
              )}
              {isFrozen ? 'Unfreeze Blueprint' : 'Freeze Blueprint'}
            </button>
            <button
              type="button"
              onClick={() => void runAction('regenerate')}
              disabled={saving || actioning !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
            >
              {actioning === 'regenerate' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Regenerate from Prep
            </button>
            <Link
              href={`/projects/${projectId}/grants/${grantId}/draft`}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
            >
              Open Draft Workspace
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Status
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {workspace.blueprint?.status || 'Not launched'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Sections
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{summary.sections}</div>
            <div className="mt-1 text-sm text-slate-500">
              {summary.required} required, {summary.draftable} draftable
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Foundation
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {foundation.status || 'Draft'}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {typeof foundation.version === 'number' ? `Version ${foundation.version}` : 'Not versioned yet'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Freeze Readiness
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {freezeReadiness.ok ? 'Ready' : 'Needs work'}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {freezeReadiness.issues.length} issue{freezeReadiness.issues.length === 1 ? '' : 's'}
            </div>
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

        {hasUnsavedChanges ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm font-medium text-sky-900">
            You have unsaved blueprint edits. Save before leaving or freezing.
          </div>
        ) : null}

        <GrantBlueprintFoundationCard
          foundation={foundation}
          isFrozen={isFrozen}
          issues={freezeReadiness.issues}
          onChange={updateFoundation}
          onUpdateContribution={updateContribution}
          onAddContribution={addContribution}
          onRemoveContribution={removeContribution}
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Section Editor
              </div>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">
                Review the template-driven section plan
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {([
                ['all', 'All'],
                ['draftable', 'Draftable'],
                ['structured', 'Structured'],
                ['required', 'Required'],
              ] as Array<[SectionFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-3 py-2 text-sm font-semibold ${
                    filter === value
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-3 text-sm text-slate-700 outline-none focus:border-slate-500"
                placeholder="Search by section label or key"
              />
            </label>
            <div className="text-sm text-slate-500">
              Showing {filteredSections.length} of {draftPlan.length} sections
            </div>
          </div>
        </section>

        <div className="space-y-4">
          {filteredSections.map((section, index) => (
            <GrantBlueprintSectionCard
              key={section.sectionKey}
              section={section}
              index={sortSections(draftPlan).findIndex((item) => item.sectionKey === section.sectionKey)}
              total={draftPlan.length}
              isFrozen={isFrozen}
              onMove={moveSection}
              onChange={updateSection}
            />
          ))}
          {filteredSections.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
              No sections matched the current search and filter.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
