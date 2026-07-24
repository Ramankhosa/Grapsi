'use client'

/**
 * Grant Diagram Studio — grant-native visuals stage.
 *
 * Section-aware recommendations → one-click AI spec generation → deterministic
 * themed rendering. Gantt specs get a structured editor that re-renders
 * instantly without another LLM call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileImage,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'

import { useToast } from '@/components/ui/toast'
import {
  recommendDiagramsForSection,
  DIAGRAM_KIND_LABELS,
  type DiagramRecommendation,
} from '@/lib/diagram-studio/catalog'
import { DIAGRAM_THEMES } from '@/lib/diagram-studio/theme'
import type { DiagramSpec, GanttSpec, DiagramStudioKind } from '@/lib/diagram-studio/spec-types'

type StageSection = {
  sectionKey: string
  label: string
  sectionType: string
  status: string
  content: string | null
}

type DiagramRecord = {
  id: string
  sectionKey: string | null
  figureNo: number
  kind: DiagramStudioKind
  title: string
  caption: string | null
  themeKey: string
  spec: DiagramSpec | null
  status: 'DRAFT' | 'GENERATING' | 'READY' | 'FAILED'
  errorMessage: string | null
  imageUrl: string | null
  imageVersion: number
  isStale: boolean
  createdAt: string
  updatedAt: string
}

interface GrantDiagramStudioStageProps {
  projectId: string
  grantId: string
  authToken: string | null
  sections: StageSection[]
  draftingSessionId: string | null
  onSectionsUpdated?: () => void
}

const CREATABLE_KINDS: DiagramStudioKind[] = ['gantt', 'flowchart', 'logic_model', 'chart', 'plot', 'sketch']

const GENERATION_MESSAGES = [
  'Reading the section content…',
  'Structuring the diagram…',
  'Applying the visual theme…',
  'Rendering the figure…',
]

function kindBadgeClasses(kind: DiagramStudioKind): string {
  switch (kind) {
    case 'gantt':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200'
    case 'flowchart':
      return 'bg-cyan-50 text-cyan-700 border-cyan-200'
    case 'logic_model':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'chart':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'plot':
      return 'bg-violet-50 text-violet-700 border-violet-200'
    case 'sketch':
      return 'bg-pink-50 text-pink-700 border-pink-200'
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200'
  }
}

export default function GrantDiagramStudioStage({
  projectId,
  grantId,
  authToken,
  sections,
  draftingSessionId,
  onSectionsUpdated,
}: GrantDiagramStudioStageProps) {
  const { showToast } = useToast()
  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationMessage, setGenerationMessage] = useState(GENERATION_MESSAGES[0])
  const [refineInstruction, setRefineInstruction] = useState('')
  const [refining, setRefining] = useState(false)
  const [applyingSpec, setApplyingSpec] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editableGantt, setEditableGantt] = useState<GanttSpec | null>(null)
  const [ganttDirty, setGanttDirty] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKind, setComposerKind] = useState<DiagramStudioKind>('gantt')
  const [composerSectionKey, setComposerSectionKey] = useState<string>('')
  const [composerTitle, setComposerTitle] = useState('')
  const [composerGuidance, setComposerGuidance] = useState('')
  const [composerFreeform, setComposerFreeform] = useState(false)
  const generationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const apiBase = `/api/projects/${projectId}/grants/${grantId}/diagrams`
  const narrativeSections = useMemo(
    () => sections.filter(section => section.sectionType === 'narrative' || section.sectionType === 'short_answer'),
    [sections]
  )
  const selected = useMemo(
    () => diagrams.find(diagram => diagram.id === selectedId) || null,
    [diagrams, selectedId]
  )

  const authHeaders = useCallback((): Record<string, string> => {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {}
  }, [authToken])

  const loadDiagrams = useCallback(async () => {
    if (!authToken) return
    try {
      const response = await fetch(apiBase, { headers: authHeaders(), cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Failed to load diagrams')
      setDiagrams(payload.diagrams || [])
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Could not load diagrams',
        message: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setLoading(false)
    }
  }, [apiBase, authHeaders, authToken, showToast])

  useEffect(() => {
    void loadDiagrams()
  }, [loadDiagrams])

  // Reset the gantt editor whenever the selected diagram changes.
  useEffect(() => {
    if (selected?.kind === 'gantt' && selected.spec?.kind === 'gantt') {
      setEditableGantt(JSON.parse(JSON.stringify(selected.spec)) as GanttSpec)
    } else {
      setEditableGantt(null)
    }
    setGanttDirty(false)
    setRefineInstruction('')
  }, [selected?.id, selected?.imageVersion, selected?.kind, selected?.spec])

  const startGenerationFeedback = useCallback(() => {
    let index = 0
    setGenerationMessage(GENERATION_MESSAGES[0])
    generationTimerRef.current = setInterval(() => {
      index = Math.min(index + 1, GENERATION_MESSAGES.length - 1)
      setGenerationMessage(GENERATION_MESSAGES[index])
    }, 6000)
  }, [])

  const stopGenerationFeedback = useCallback(() => {
    if (generationTimerRef.current) {
      clearInterval(generationTimerRef.current)
      generationTimerRef.current = null
    }
  }, [])

  useEffect(() => () => stopGenerationFeedback(), [stopGenerationFeedback])

  const upsertDiagram = useCallback((diagram: DiagramRecord) => {
    setDiagrams(prev => {
      const exists = prev.some(item => item.id === diagram.id)
      const next = exists
        ? prev.map(item => (item.id === diagram.id ? diagram : item))
        : [...prev, diagram]
      return next.sort((a, b) => a.figureNo - b.figureNo)
    })
  }, [])

  const handleGenerate = useCallback(
    async (params: {
      kind: DiagramStudioKind
      sectionKey: string
      title?: string
      guidance?: string
      mode?: 'structured' | 'freeform'
    }) => {
      if (!authToken || generating) return
      if (params.kind === 'sketch' && !draftingSessionId) {
        showToast({
          type: 'warning',
          title: 'Sketches need the drafting workspace',
          message: 'Open the Blueprint stage once so the drafting workspace is prepared.',
        })
        return
      }
      setGenerating(true)
      startGenerationFeedback()
      try {
        const response = await fetch(apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            kind: params.kind,
            mode: params.mode,
            sectionKeys: [params.sectionKey],
            title: params.title,
            guidance: params.guidance,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || 'Diagram generation failed')
        const diagram: DiagramRecord = payload.diagram
        upsertDiagram(diagram)
        setSelectedId(diagram.id)
        setComposerOpen(false)
        setComposerTitle('')
        setComposerGuidance('')
        setComposerFreeform(false)
        if (diagram.status === 'READY') {
          showToast({ type: 'success', title: `Figure ${diagram.figureNo} ready` })
        } else if (diagram.status === 'FAILED') {
          showToast({
            type: 'warning',
            title: 'Generation did not finish',
            message: diagram.errorMessage || undefined,
          })
        }
      } catch (error) {
        showToast({
          type: 'error',
          title: 'Diagram generation failed',
          message: error instanceof Error ? error.message : undefined,
        })
      } finally {
        stopGenerationFeedback()
        setGenerating(false)
      }
    },
    [apiBase, authHeaders, authToken, draftingSessionId, generating, showToast, startGenerationFeedback, stopGenerationFeedback, upsertDiagram]
  )

  const handleApplyGanttEdits = useCallback(async () => {
    if (!authToken || !selected || !editableGantt || applyingSpec) return
    setApplyingSpec(true)
    try {
      const response = await fetch(`${apiBase}/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ spec: editableGantt }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Failed to apply changes')
      upsertDiagram(payload.diagram)
      setGanttDirty(false)
      showToast({ type: 'success', title: 'Diagram updated' })
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Could not apply changes',
        message: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setApplyingSpec(false)
    }
  }, [apiBase, applyingSpec, authHeaders, authToken, editableGantt, selected, showToast, upsertDiagram])

  const handleThemeChange = useCallback(
    async (themeKey: string) => {
      if (!authToken || !selected || selected.themeKey === themeKey) return
      try {
        const response = await fetch(`${apiBase}/${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ themeKey, spec: selected.spec ?? undefined }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || 'Failed to change theme')
        upsertDiagram(payload.diagram)
      } catch (error) {
        showToast({
          type: 'error',
          title: 'Theme change failed',
          message: error instanceof Error ? error.message : undefined,
        })
      }
    },
    [apiBase, authHeaders, authToken, selected, showToast, upsertDiagram]
  )

  const handleRefine = useCallback(async () => {
    if (!authToken || !selected || !refineInstruction.trim() || refining) return
    setRefining(true)
    try {
      const response = await fetch(`${apiBase}/${selected.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ instruction: refineInstruction.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || 'Refinement failed')
      upsertDiagram(payload.diagram)
      setRefineInstruction('')
      showToast({ type: 'success', title: 'Diagram refined' })
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Refinement failed',
        message: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setRefining(false)
    }
  }, [apiBase, authHeaders, authToken, refineInstruction, refining, selected, showToast, upsertDiagram])

  const handleRegenerate = useCallback(async () => {
    if (!selected) return
    await handleGenerate({
      kind: selected.kind,
      sectionKey: selected.sectionKey || narrativeSections[0]?.sectionKey || '',
      title: selected.title,
    })
  }, [handleGenerate, narrativeSections, selected])

  const handleDelete = useCallback(async () => {
    if (!authToken || !selected || deleting) return
    setDeleting(true)
    try {
      const response = await fetch(`${apiBase}/${selected.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.message || 'Delete failed')
      }
      setDiagrams(prev => prev.filter(item => item.id !== selected.id))
      setSelectedId(null)
      showToast({ type: 'success', title: 'Diagram deleted' })
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Delete failed',
        message: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }, [apiBase, authHeaders, authToken, deleting, selected, showToast])

  const handleInsertIntoSection = useCallback(async () => {
    if (!authToken || !selected || inserting) return
    const targetKey = selected.sectionKey || narrativeSections[0]?.sectionKey
    if (!targetKey) {
      showToast({ type: 'warning', title: 'No narrative section available for insertion' })
      return
    }
    setInserting(true)
    try {
      const sectionUrl = `/api/projects/${projectId}/grants/${grantId}/sections/${encodeURIComponent(targetKey)}`
      const current = await fetch(sectionUrl, { headers: authHeaders(), cache: 'no-store' })
      const currentPayload = await current.json().catch(() => ({}))
      if (!current.ok) throw new Error(currentPayload.message || 'Could not load the section')
      const existing: string = currentPayload.section?.content || ''
      const marker = `[Figure ${selected.figureNo}]`
      if (existing.includes(marker)) {
        showToast({ type: 'info', title: `${marker} is already referenced in the section` })
        return
      }
      const nextContent = existing.trim().length > 0 ? `${existing.replace(/\s+$/, '')}\n\n${marker}\n` : `${marker}\n`
      const save = await fetch(sectionUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: nextContent }),
      })
      if (!save.ok) {
        const savePayload = await save.json().catch(() => ({}))
        throw new Error(savePayload.message || 'Could not update the section')
      }
      onSectionsUpdated?.()
      showToast({
        type: 'success',
        title: `${marker} inserted`,
        message: `Added to “${narrativeSections.find(s => s.sectionKey === targetKey)?.label || targetKey}”.`,
      })
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Insert failed',
        message: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setInserting(false)
    }
  }, [authHeaders, authToken, grantId, inserting, narrativeSections, onSectionsUpdated, projectId, selected, showToast])

  // ——— Gantt editor helpers ———
  const mutateGantt = useCallback((mutator: (draft: GanttSpec) => void) => {
    setEditableGantt(prev => {
      if (!prev) return prev
      const draft = JSON.parse(JSON.stringify(prev)) as GanttSpec
      mutator(draft)
      return draft
    })
    setGanttDirty(true)
  }, [])

  if (!authToken) {
    return <div className="p-6 text-sm text-slate-600">Sign in to use the Diagram Studio.</div>
  }

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      {/* Left rail: sections + recommendations */}
      <aside className="flex w-72 flex-shrink-0 flex-col gap-3 overflow-y-auto">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Recommended visuals</h2>
            <button
              onClick={() => setComposerOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              <Plus className="h-3.5 w-3.5" /> Custom
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            One click generates a themed figure grounded in the section&apos;s drafted text.
          </p>
        </div>

        {narrativeSections.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            No narrative sections yet. Freeze the blueprint and draft sections first.
          </div>
        ) : (
          narrativeSections.map(section => {
            const recommendations = recommendDiagramsForSection({
              sectionKey: section.sectionKey,
              label: section.label,
            })
            const hasContent = (section.content || '').trim().length > 40
            return (
              <div
                key={section.sectionKey}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold leading-snug text-slate-800">{section.label}</div>
                  {!hasContent ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      not drafted
                    </span>
                  ) : null}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {recommendations.map((rec: DiagramRecommendation) => (
                    <button
                      key={`${section.sectionKey}-${rec.kind}-${rec.label}`}
                      disabled={generating || (!hasContent && rec.kind !== 'sketch')}
                      title={rec.hint}
                      onClick={() =>
                        handleGenerate({
                          kind: rec.kind,
                          sectionKey: section.sectionKey,
                          title: rec.defaultTitle,
                        })
                      }
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${kindBadgeClasses(rec.kind)} ${
                        generating || (!hasContent && rec.kind !== 'sketch')
                          ? 'cursor-not-allowed opacity-45'
                          : 'hover:shadow-sm'
                      }`}
                    >
                      <Sparkles className="h-3 w-3" />
                      {rec.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </aside>

      {/* Center: gallery + detail */}
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        {generating ? (
          <div className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            <div className="text-sm text-indigo-900">{generationMessage}</div>
          </div>
        ) : null}

        {/* Gallery strip */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">
            Figures <span className="font-normal text-slate-400">({diagrams.length})</span>
          </h2>
          {loading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading diagrams…
            </div>
          ) : diagrams.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              <FileImage className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              No figures yet. Pick a recommended visual on the left to generate the first one.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {diagrams.map(diagram => (
                <button
                  key={diagram.id}
                  onClick={() => setSelectedId(diagram.id)}
                  className={`group relative overflow-hidden rounded-xl border text-left transition ${
                    selectedId === diagram.id
                      ? 'border-indigo-400 ring-2 ring-indigo-200'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex h-28 items-center justify-center bg-slate-50">
                    {diagram.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={diagram.imageUrl}
                        alt={diagram.title}
                        className="h-full w-full object-contain p-1.5"
                      />
                    ) : diagram.status === 'FAILED' ? (
                      <AlertTriangle className="h-6 w-6 text-amber-500" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    )}
                  </div>
                  <div className="border-t border-slate-100 bg-white px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-700">Fig. {diagram.figureNo}</span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${kindBadgeClasses(diagram.kind)}`}
                      >
                        {DIAGRAM_KIND_LABELS[diagram.kind]}
                      </span>
                      {diagram.isStale ? (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                          stale
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-600">{diagram.title}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail workspace */}
        {selected ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-slate-800">
                    Figure {selected.figureNo} — {selected.title}
                  </h3>
                  {selected.isStale ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> source changed
                    </span>
                  ) : null}
                </div>
                {selected.sectionKey ? (
                  <div className="text-xs text-slate-400">
                    From “{sections.find(s => s.sectionKey === selected.sectionKey)?.label || selected.sectionKey}”
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Theme picker (structured specs only — sketches, plots, and
                    freeform code carry their own styling) */}
                <div className="mr-1 flex items-center gap-1 rounded-lg border border-slate-200 p-1">
                  {Object.values(DIAGRAM_THEMES).map(theme => {
                    const themeLocked =
                      selected.kind === 'sketch' ||
                      selected.kind === 'plot' ||
                      selected.spec?.kind === 'freeform'
                    return (
                      <button
                        key={theme.key}
                        title={theme.name}
                        onClick={() => void handleThemeChange(theme.key)}
                        disabled={themeLocked}
                        className={`h-5 w-5 rounded-md border transition ${
                          selected.themeKey === theme.key ? 'ring-2 ring-slate-400' : ''
                        } ${themeLocked ? 'cursor-not-allowed opacity-40' : ''}`}
                        style={{ backgroundColor: theme.series[0], borderColor: theme.grid }}
                      />
                    )
                  })}
                </div>
                <button
                  onClick={() => void handleInsertIntoSection()}
                  disabled={inserting || selected.status !== 'READY'}
                  className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inserting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Insert into section
                </button>
                {selected.imageUrl ? (
                  <a
                    href={selected.imageUrl}
                    download={`figure-${selected.figureNo}.png`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                ) : null}
                <button
                  onClick={() => void handleRegenerate()}
                  disabled={generating}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete
                </button>
              </div>
            </div>

            {/* Preview */}
            <div className="flex items-center justify-center bg-slate-50/70 p-4">
              {selected.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.imageUrl}
                  alt={selected.title}
                  className="max-h-[520px] w-auto max-w-full rounded-lg border border-slate-200 bg-white shadow-sm"
                />
              ) : selected.status === 'FAILED' ? (
                <div className="flex flex-col items-center gap-2 p-8 text-center">
                  <AlertTriangle className="h-7 w-7 text-amber-500" />
                  <div className="text-sm font-medium text-slate-700">Generation failed</div>
                  <div className="max-w-md text-xs text-slate-500">{selected.errorMessage}</div>
                  <button
                    onClick={() => void handleRegenerate()}
                    className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Rendering…
                </div>
              )}
            </div>

            {/* AI refine — all kinds: structured specs get a minimal patch,
                freeform/plots get a code rewrite, sketches regenerate */}
            {selected.status === 'READY' ? (
              <div className="border-t border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 flex-shrink-0 text-indigo-500" />
                  <input
                    value={refineInstruction}
                    onChange={event => setRefineInstruction(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') void handleRefine()
                    }}
                    placeholder={
                      selected.kind === 'sketch'
                        ? 'Refine with AI — e.g. "make it more schematic", "add labels for the sensor layer"'
                        : 'Refine with AI — e.g. "split WP2 into two work packages", "add a dissemination phase"'
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    onClick={() => void handleRefine()}
                    disabled={refining || !refineInstruction.trim()}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Refine
                  </button>
                </div>
              </div>
            ) : null}

            {/* Generated code viewer (freeform DOT / matplotlib) */}
            {(() => {
              const spec = selected.spec
              const code =
                spec?.kind === 'freeform'
                  ? spec.code
                  : spec?.kind === 'plot'
                    ? (spec.pythonSpec as { code?: string } | undefined)?.code
                    : undefined
              if (!code) return null
              return (
                <details className="border-t border-slate-100 px-4 py-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
                    View AI-generated code ({spec?.kind === 'freeform' ? 'Graphviz DOT' : 'matplotlib · Python'})
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                    {code}
                  </pre>
                </details>
              )
            })()}

            {/* Gantt structured editor */}
            {editableGantt ? (
              <div className="border-t border-slate-100 px-4 py-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800">Workplan editor</h4>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      Duration
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={editableGantt.totalMonths}
                        onChange={event =>
                          mutateGantt(draft => {
                            draft.totalMonths = Math.max(1, Math.min(120, Number(event.target.value) || 1))
                          })
                        }
                        className="w-16 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      />
                      months
                    </label>
                    {ganttDirty ? (
                      <button
                        onClick={() => void handleApplyGanttEdits()}
                        disabled={applyingSpec}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {applyingSpec ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Apply &amp; re-render
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Edits re-render instantly from the spec — no AI call, no quota use.
                </p>

                <div className="mt-3 space-y-3">
                  {editableGantt.groups.map((group, groupIndex) => (
                    <div key={group.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={group.name}
                          onChange={event =>
                            mutateGantt(draft => {
                              draft.groups[groupIndex].name = event.target.value
                            })
                          }
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800"
                        />
                        <button
                          title="Remove work package"
                          onClick={() =>
                            mutateGantt(draft => {
                              draft.groups.splice(groupIndex, 1)
                            })
                          }
                          disabled={editableGantt.groups.length <= 1}
                          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {group.tasks.map((task, taskIndex) => (
                          <div key={task.id} className="flex items-center gap-1.5">
                            <input
                              value={task.label}
                              onChange={event =>
                                mutateGantt(draft => {
                                  draft.groups[groupIndex].tasks[taskIndex].label = event.target.value
                                })
                              }
                              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs"
                            />
                            <input
                              type="number"
                              min={1}
                              max={editableGantt.totalMonths}
                              value={task.startMonth}
                              title="Start month"
                              onChange={event =>
                                mutateGantt(draft => {
                                  draft.groups[groupIndex].tasks[taskIndex].startMonth =
                                    Number(event.target.value) || 1
                                })
                              }
                              className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-center text-xs"
                            />
                            <span className="text-[10px] text-slate-400">→</span>
                            <input
                              type="number"
                              min={1}
                              max={editableGantt.totalMonths}
                              value={task.endMonth}
                              title="End month"
                              onChange={event =>
                                mutateGantt(draft => {
                                  draft.groups[groupIndex].tasks[taskIndex].endMonth =
                                    Number(event.target.value) || 1
                                })
                              }
                              className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-center text-xs"
                            />
                            <label
                              title="Critical path"
                              className="flex items-center gap-1 text-[10px] text-slate-500"
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(task.critical)}
                                onChange={event =>
                                  mutateGantt(draft => {
                                    draft.groups[groupIndex].tasks[taskIndex].critical = event.target.checked
                                  })
                                }
                              />
                              crit
                            </label>
                            <button
                              title="Remove task"
                              onClick={() =>
                                mutateGantt(draft => {
                                  draft.groups[groupIndex].tasks.splice(taskIndex, 1)
                                })
                              }
                              disabled={group.tasks.length <= 1}
                              className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() =>
                            mutateGantt(draft => {
                              const g = draft.groups[groupIndex]
                              g.tasks.push({
                                id: `t_${Date.now().toString(36)}`,
                                label: 'New task',
                                startMonth: 1,
                                endMonth: Math.min(3, draft.totalMonths),
                              })
                            })
                          }
                          className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50"
                        >
                          <Plus className="h-3 w-3" /> Add task
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() =>
                        mutateGantt(draft => {
                          draft.groups.push({
                            id: `wp_${Date.now().toString(36)}`,
                            name: `Work Package ${draft.groups.length + 1}`,
                            tasks: [
                              {
                                id: `t_${Date.now().toString(36)}`,
                                label: 'New task',
                                startMonth: 1,
                                endMonth: Math.min(3, draft.totalMonths),
                              },
                            ],
                          })
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> Work package
                    </button>
                    <button
                      onClick={() =>
                        mutateGantt(draft => {
                          draft.milestones.push({
                            id: `m_${Date.now().toString(36)}`,
                            label: `Milestone ${draft.milestones.length + 1}`,
                            month: Math.min(6, draft.totalMonths),
                          })
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> Milestone
                    </button>
                  </div>

                  {editableGantt.milestones.length > 0 ? (
                    <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3">
                      <div className="text-xs font-semibold text-amber-800">Milestones</div>
                      <div className="mt-1.5 space-y-1.5">
                        {editableGantt.milestones.map((milestone, milestoneIndex) => (
                          <div key={milestone.id} className="flex items-center gap-1.5">
                            <input
                              value={milestone.label}
                              onChange={event =>
                                mutateGantt(draft => {
                                  draft.milestones[milestoneIndex].label = event.target.value
                                })
                              }
                              className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs"
                            />
                            <span className="text-[10px] text-amber-700">month</span>
                            <input
                              type="number"
                              min={1}
                              max={editableGantt.totalMonths}
                              value={milestone.month}
                              onChange={event =>
                                mutateGantt(draft => {
                                  draft.milestones[milestoneIndex].month = Number(event.target.value) || 1
                                })
                              }
                              className="w-14 rounded-md border border-amber-200 bg-white px-1.5 py-1 text-center text-xs"
                            />
                            <button
                              title="Remove milestone"
                              onClick={() =>
                                mutateGantt(draft => {
                                  draft.milestones.splice(milestoneIndex, 1)
                                })
                              }
                              className="rounded-md p-1 text-amber-500 hover:bg-red-50 hover:text-red-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </main>

      {/* Custom composer dialog */}
      {composerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">New diagram</h3>
              <button
                onClick={() => setComposerOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Type</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CREATABLE_KINDS.map(kind => (
                    <button
                      key={kind}
                      onClick={() => setComposerKind(kind)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${kindBadgeClasses(kind)} ${
                        composerKind === kind ? 'ring-2 ring-slate-300' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      {DIAGRAM_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
                {composerKind === 'flowchart' ? (
                  <label className="mt-2.5 flex items-start gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={composerFreeform}
                      onChange={event => setComposerFreeform(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Freeform AI code</span> — the AI writes the
                      Graphviz diagram code directly. Richer output for complex diagrams; edited via
                      AI refine instead of the structured editor.
                    </span>
                  </label>
                ) : null}
                {composerKind === 'plot' ? (
                  <p className="mt-2 text-xs text-slate-500">
                    The AI extracts real numbers from the section and writes matplotlib code, executed
                    on the chart server. Needs numeric data in the section.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600">Source section</label>
                <select
                  value={composerSectionKey || narrativeSections[0]?.sectionKey || ''}
                  onChange={event => setComposerSectionKey(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {narrativeSections.map(section => (
                    <option key={section.sectionKey} value={section.sectionKey}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600">Title (optional)</label>
                <input
                  value={composerTitle}
                  onChange={event => setComposerTitle(event.target.value)}
                  placeholder="e.g. Implementation Workplan"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600">Guidance (optional)</label>
                <textarea
                  value={composerGuidance}
                  onChange={event => setComposerGuidance(event.target.value)}
                  rows={3}
                  placeholder="Anything the AI should emphasise — e.g. show 4 work packages, highlight the pilot phase…"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setComposerOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  void handleGenerate({
                    kind: composerKind,
                    mode: composerKind === 'flowchart' && composerFreeform ? 'freeform' : undefined,
                    sectionKey: composerSectionKey || narrativeSections[0]?.sectionKey || '',
                    title: composerTitle || undefined,
                    guidance: composerGuidance || undefined,
                  })
                }
                disabled={generating || narrativeSections.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Generate
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
