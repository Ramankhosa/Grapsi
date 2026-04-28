'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Loader2,
  Save,
} from 'lucide-react'

import SectionDraftingStage from '@/components/stages/SectionDraftingStage'
import {
  getGrantWorkflowBadgeLabel,
  getGrantWorkflowManualDetail,
} from '@/lib/grants/workflowMode'

type StructuredResponse = {
  id?: string
  responseJson?: unknown
}

export type GrantSection = {
  id: string
  sectionKey: string
  label: string
  sectionOrder: number
  sectionType: 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows'
  workflowMode: 'app_draft' | 'app_support' | 'team_manual'
  citationMode?: 'mapped_evidence' | 'direct_draft' | 'no_citations'
  status: string
  content: string | null
  required?: boolean
  wordBudget?: number | null
  characterLimit?: number | null
  dimensions?: string[]
  suggestedCitationCount?: number | null
  grantSemantic?: string | null
  prepContextBlock?: { bullets?: string[]; keywords?: string[] } | null
  grantRuleProfile?: {
    requiredPoints?: string[]
    evaluationFocus?: string[]
    reviewerSignals?: string[]
    avoidRules?: string[]
    formatConstraints?: string[]
  } | null
  structuredResponses?: StructuredResponse[]
}

type SectionsResponse = {
  sections: GrantSection[]
}

export type DraftingFilter = 'all' | 'app_draft' | 'team_draft' | 'evidence'

interface GrantSectionDraftingStageProps {
  projectId: string
  grantId: string
  draftingSessionId: string | null
  authToken: string | null
  selectedSection?: string
  onSectionSelect?: (sectionKey: string) => void
  onSessionUpdated?: (session: any) => void
  onSectionsUpdated?: (sections: GrantSection[]) => void
  sectionFilter?: DraftingFilter
  onSectionFilterChange?: (filter: DraftingFilter) => void
}

function structuredJson(section: GrantSection) {
  return JSON.stringify(section.structuredResponses?.[0]?.responseJson || {}, null, 2)
}

export function isNarrativeSection(section: GrantSection) {
  return section.sectionType === 'narrative' || section.sectionType === 'short_answer'
}

export function isPaperBackedSection(section: GrantSection) {
  return section.workflowMode === 'app_draft' && isNarrativeSection(section)
}

function sectionWordCount(section: GrantSection) {
  const text = String(section.content || '').replace(/<[^>]*>/g, ' ').trim()
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

function hasStructuredResponse(section: GrantSection) {
  const responseJson = section.structuredResponses?.[0]?.responseJson
  if (!responseJson) return false
  try {
    const serialized = JSON.stringify(responseJson)
    return Boolean(serialized && serialized !== '{}' && serialized !== '[]')
  } catch {
    return false
  }
}

export function hasSectionContent(section: GrantSection) {
  if (isNarrativeSection(section)) {
    return sectionWordCount(section) > 0
  }
  return hasStructuredResponse(section)
}

function statusLabel(section: GrantSection) {
  if (section.status === 'REVIEWED' || section.status === 'COMPLETED') return 'Reviewed'
  if (hasSectionContent(section)) return 'Draft in progress'
  return 'Not started'
}

function statusClasses(section: GrantSection) {
  if (section.status === 'REVIEWED' || section.status === 'COMPLETED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (hasSectionContent(section)) {
    return 'border-sky-200 bg-sky-50 text-sky-800'
  }
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function workflowClasses(workflowMode: GrantSection['workflowMode']) {
  if (workflowMode === 'app_draft') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (workflowMode === 'app_support') return 'border-sky-200 bg-sky-50 text-sky-800'
  return 'border-amber-200 bg-amber-50 text-amber-900'
}

export function filterMatches(section: GrantSection, filter: DraftingFilter) {
  if (filter === 'app_draft') return isPaperBackedSection(section)
  if (filter === 'team_draft') return !isPaperBackedSection(section)
  if (filter === 'evidence') return isPaperBackedSection(section) && (section.dimensions || []).length > 0
  return true
}

export default function GrantSectionDraftingStage({
  projectId,
  grantId,
  draftingSessionId,
  authToken,
  selectedSection,
  onSectionSelect,
  onSessionUpdated,
  onSectionsUpdated,
  sectionFilter: controlledFilter,
  onSectionFilterChange,
}: GrantSectionDraftingStageProps) {
  const [sections, setSections] = useState<GrantSection[]>([])
  const [internalFilter, setInternalFilter] = useState<DraftingFilter>('all')
  const sectionFilter = controlledFilter ?? internalFilter
  const setSectionFilter = onSectionFilterChange ?? setInternalFilter
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>({})

  const loadSections = useCallback(async () => {
    if (!authToken) return

    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/sections`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const payload = await response.json().catch(() => ({})) as SectionsResponse & { message?: string }
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to load grant sections')
      }

      const nextSections = Array.isArray(payload.sections)
        ? [...payload.sections].sort((a, b) => a.sectionOrder - b.sectionOrder)
        : []
      setSections(nextSections)

      const nextDrafts: Record<string, string> = {}
      const nextStructured: Record<string, string> = {}
      for (const section of nextSections) {
        nextDrafts[section.sectionKey] = section.content || ''
        nextStructured[section.sectionKey] = structuredJson(section)
      }
      setDraftValues(nextDrafts)
      setStructuredValues(nextStructured)
      onSectionsUpdated?.(nextSections)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load grant sections')
    } finally {
      setLoading(false)
    }
  }, [authToken, grantId, onSectionsUpdated, projectId])

  useEffect(() => {
    void loadSections()
  }, [loadSections])

  useEffect(() => {
    if (!onSectionSelect || sections.length === 0) return
    if (selectedSection && sections.some((section) => section.sectionKey === selectedSection)) return
    onSectionSelect(sections[0].sectionKey)
  }, [onSectionSelect, sections, selectedSection])

  const filteredSections = useMemo(
    () => sections.filter((section) => filterMatches(section, sectionFilter)),
    [sectionFilter, sections]
  )

  useEffect(() => {
    if (!onSectionSelect || filteredSections.length === 0) return
    if (selectedSection && filteredSections.some((section) => section.sectionKey === selectedSection)) return
    onSectionSelect(filteredSections[0].sectionKey)
  }, [filteredSections, onSectionSelect, selectedSection])

  const currentSection = useMemo(() => {
    if (sections.length === 0) return null
    return sections.find((section) => section.sectionKey === selectedSection) || sections[0]
  }, [sections, selectedSection])

  const refreshShadowSession = useCallback(async () => {
    if (!authToken || !draftingSessionId || !onSessionUpdated) return
    try {
      const response = await fetch(`/api/papers/${draftingSessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!response.ok) return
      const payload = await response.json().catch(() => ({}))
      if (payload.session) {
        onSessionUpdated(payload.session)
      }
    } catch {
      // Best-effort shell refresh.
    }
  }, [authToken, draftingSessionId, onSessionUpdated])

  const saveSection = useCallback(async (section: GrantSection) => {
    if (!authToken) return

    try {
      setSavingKey(section.sectionKey)
      const body =
        section.sectionType === 'narrative' || section.sectionType === 'short_answer'
          ? { content: draftValues[section.sectionKey] || '', markReviewed: true }
          : { structuredData: JSON.parse(structuredValues[section.sectionKey] || '{}'), markReviewed: true }

      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/sections/${section.sectionKey}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to save grant section')
      }

      await loadSections()
      await refreshShadowSession()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save grant section')
    } finally {
      setSavingKey(null)
    }
  }, [authToken, draftValues, grantId, loadSections, projectId, refreshShadowSession, structuredValues])

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading section drafting workspace...
      </div>
    )
  }

  if (error && !currentSection) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" />
          Section drafting unavailable
        </div>
        <div className="mt-2">{error}</div>
      </div>
    )
  }

  if (!currentSection) {
    return (
      <div className="m-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-600">
        No grant sections are available yet.
      </div>
    )
  }

  const paperBacked = isPaperBackedSection(currentSection)

  if (paperBacked && draftingSessionId) {
    return (
      <div className="min-h-[720px] bg-slate-50" style={{ scrollBehavior: 'smooth' }}>
        {error ? (
          <div className="mx-6 mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        <SectionDraftingStage
          sessionId={draftingSessionId}
          authToken={authToken}
          onSessionUpdated={onSessionUpdated}
          selectedSection={currentSection.sectionKey}
          onSectionSelect={onSectionSelect}
        />
      </div>
    )
  }

  const isNarrative = isNarrativeSection(currentSection)

  return (
    <div className="min-h-[720px] bg-slate-50" style={{ scrollBehavior: 'smooth' }}>
      {error ? (
        <div className="mx-6 mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="bg-white px-6 py-7">
        <div
          id={`section-${currentSection.sectionKey}`}
          className={`mx-auto max-w-[850px] rounded-sm border border-gray-100/70 bg-white px-12 py-12 shadow-[0_1px_12px_rgba(0,0,0,0.08)] ${
            isPaperBackedSection(currentSection) ? 'border-l-4 border-l-emerald-300 bg-emerald-50/20' : ''
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                  {currentSection.sectionType}
                </span>
                <span className={`rounded-full border px-2 py-1 ${workflowClasses(currentSection.workflowMode)}`}>
                  {getGrantWorkflowBadgeLabel(currentSection.workflowMode)}
                </span>
                <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-800">
                  {(currentSection.citationMode || 'direct_draft').replace(/_/g, ' ')}
                </span>
                <span className={`rounded-full border px-2 py-1 ${statusClasses(currentSection)}`}>
                  {statusLabel(currentSection)}
                </span>
              </div>
              <h2 className="mt-4 font-serif text-2xl font-semibold text-slate-950">{currentSection.label}</h2>
              {currentSection.workflowMode !== 'app_draft' ? (
                <p className="mt-2 text-sm text-slate-500">
                  {getGrantWorkflowManualDetail(currentSection.workflowMode) || 'Grant-owned section editor.'}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void saveSection(currentSection)}
              disabled={savingKey !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {savingKey === currentSection.sectionKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Section
            </button>
          </div>

          {isNarrative ? (
            <textarea
              value={draftValues[currentSection.sectionKey] || ''}
              onChange={(event) =>
                setDraftValues((current) => ({ ...current, [currentSection.sectionKey]: event.target.value }))
              }
              className="mt-6 min-h-[420px] w-full resize-y border-0 px-0 py-0 font-serif text-[16px] leading-8 text-slate-800 outline-none"
              placeholder="Write this grant section here."
            />
          ) : (
            <textarea
              value={structuredValues[currentSection.sectionKey] || '{}'}
              onChange={(event) =>
                setStructuredValues((current) => ({ ...current, [currentSection.sectionKey]: event.target.value }))
              }
              className="mt-6 min-h-[380px] w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-6 text-slate-700 outline-none focus:border-slate-500"
              placeholder="Enter the structured response JSON for this section."
            />
          )}
        </div>
      </div>
    </div>
  )
}
