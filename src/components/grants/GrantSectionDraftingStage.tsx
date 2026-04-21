'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2, Save } from 'lucide-react'

import SectionDraftingStage from '@/components/stages/SectionDraftingStage'
import {
  getGrantWorkflowBadgeLabel,
  getGrantWorkflowManualDetail,
} from '@/lib/grants/workflowMode'

type StructuredResponse = {
  id?: string
  responseJson?: unknown
}

type GrantSection = {
  id: string
  sectionKey: string
  label: string
  sectionOrder: number
  sectionType: 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows'
  workflowMode: 'app_draft' | 'app_support' | 'team_manual'
  citationMode?: 'mapped_evidence' | 'direct_draft' | 'no_citations'
  status: string
  content: string | null
  structuredResponses?: StructuredResponse[]
}

type SectionsResponse = {
  sections: GrantSection[]
}

interface GrantSectionDraftingStageProps {
  projectId: string
  grantId: string
  draftingSessionId: string | null
  authToken: string | null
  selectedSection?: string
  onSectionSelect?: (sectionKey: string) => void
  onSessionUpdated?: (session: any) => void
  onSectionsUpdated?: (sections: GrantSection[]) => void
}

function structuredJson(section: GrantSection) {
  return JSON.stringify(section.structuredResponses?.[0]?.responseJson || {}, null, 2)
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
}: GrantSectionDraftingStageProps) {
  const [sections, setSections] = useState<GrantSection[]>([])
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

  const paperBacked = currentSection.workflowMode === 'app_draft'
    && (currentSection.sectionType === 'narrative' || currentSection.sectionType === 'short_answer')

  if (paperBacked && draftingSessionId) {
    return (
      <SectionDraftingStage
        sessionId={draftingSessionId}
        authToken={authToken}
        onSessionUpdated={onSessionUpdated}
        selectedSection={currentSection.sectionKey}
        onSectionSelect={onSectionSelect}
      />
    )
  }

  const isNarrative = currentSection.sectionType === 'narrative' || currentSection.sectionType === 'short_answer'

  return (
    <div className="min-h-[420px] p-6">
      {error ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                {currentSection.sectionType}
              </span>
              <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-800">
                {getGrantWorkflowBadgeLabel(currentSection.workflowMode)}
              </span>
              <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-800">
                {(currentSection.citationMode || 'direct_draft').replace(/_/g, ' ')}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                {currentSection.status}
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">{currentSection.label}</h2>
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
            className="mt-5 min-h-[320px] w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-7 text-slate-700 outline-none focus:border-slate-500"
            placeholder="Write this grant section here."
          />
        ) : (
          <textarea
            value={structuredValues[currentSection.sectionKey] || '{}'}
            onChange={(event) =>
              setStructuredValues((current) => ({ ...current, [currentSection.sectionKey]: event.target.value }))
            }
            className="mt-5 min-h-[300px] w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm leading-6 text-slate-700 outline-none focus:border-slate-500"
            placeholder="Enter the structured response JSON for this section."
          />
        )}
      </div>
    </div>
  )
}
