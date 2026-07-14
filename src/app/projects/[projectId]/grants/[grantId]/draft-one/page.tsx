'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import axios from 'axios'
import { toast, Toaster } from 'react-hot-toast'
import {
  HiArrowDownTray,
  HiArrowPath,
  HiCheck,
  HiExclamationTriangle,
  HiPencilSquare,
  HiPlay,
  HiSparkles,
} from 'react-icons/hi2'

import { isFeatureEnabled } from '@/lib/feature-flags'
import {
  buildAiFixInstructions,
  buildAiReviewQueue,
  buildDraftOneQueue,
  countWords,
  normalizeDraftOneSection,
  summarizeDraftOneSections,
  type DraftOneRunState,
  type DraftOneSection,
} from '@/lib/draftOne/logic'
import { summarizeGrantRuleText } from '@/lib/grants/ruleText'
import MarkdownRenderer from '@/components/paper/MarkdownRenderer'

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

const RUN_STATE_LABEL: Record<DraftOneRunState, string> = {
  queued: 'Queued',
  writing: 'Writing…',
  reviewing: 'AI review…',
  fixing: 'Revising…',
  done: 'Done',
  failed: 'Failed',
}

/** Matches the MarkdownRenderer typography so the page reads as one document. */
const SERIF = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif'

const SEVERITY_META: Record<string, { mark: string; className: string; label: string }> = {
  critical: { mark: '●', className: 'text-rose-500', label: 'critical' },
  important: { mark: '●', className: 'text-amber-500', label: 'important' },
  polish: { mark: '○', className: 'text-stone-400', label: 'polish' },
}

function StatusChip({ section }: { section: DraftOneSection }) {
  if (!section.autoDraftable) {
    return <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">handled by your team</span>
  }
  if (section.status === 'ready') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> reviewer: ready
      </span>
    )
  }
  if (section.status === 'issues') {
    const count = section.aiReview?.findings.length || 0
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {count} reviewer finding{count === 1 ? '' : 's'}
      </span>
    )
  }
  if (section.status === 'stale') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> stale — blueprint changed
      </span>
    )
  }
  if (section.status === 'unreviewed' && section.content) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300" /> {section.aiReviewStale ? 'edited since review' : 'awaiting AI review'}
      </span>
    )
  }
  return null
}

function WordMeter({ section }: { section: DraftOneSection }) {
  const words = countWords(section.content)
  if (!section.content) return null
  if (!section.wordBudget) {
    return <span className="text-xs tabular-nums text-stone-400">{words} words</span>
  }
  const ratio = Math.min(1, words / section.wordBudget)
  const over = words > section.wordBudget
  const near = !over && words > section.wordBudget * 0.9
  return (
    <span className="flex items-center gap-2">
      <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-stone-100 sm:block">
        <span
          className={clsx('block h-full rounded-full', over ? 'bg-rose-400' : near ? 'bg-amber-400' : 'bg-stone-300')}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className={clsx('text-xs tabular-nums', over ? 'font-semibold text-rose-600' : near ? 'text-amber-600' : 'text-stone-400')}>
        {words} / {section.wordBudget}
      </span>
    </span>
  )
}

function StageStep({ index, label, detail, state }: { index: number; label: string; detail: string; state: 'done' | 'active' | 'todo' }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={clsx(
          'flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-semibold',
          state === 'done'
            ? 'bg-emerald-500 text-white'
            : state === 'active'
              ? 'bg-stone-900 text-white'
              : 'border border-stone-300 text-stone-400'
        )}
      >
        {state === 'done' ? <HiCheck className="h-3 w-3" /> : index}
      </span>
      <span>
        <span className={clsx('block text-xs font-medium leading-none', state === 'todo' ? 'text-stone-400' : 'text-stone-800')}>{label}</span>
        <span className="mt-0.5 block text-[10px] leading-none text-stone-400">{detail}</span>
      </span>
    </div>
  )
}

export default function DraftOnePage() {
  const params = useParams<{ projectId: string; grantId: string }>()
  const router = useRouter()
  const projectId = String(params?.projectId || '')
  const grantId = String(params?.grantId || '')

  const [loading, setLoading] = useState(true)
  const [draftingSessionId, setDraftingSessionId] = useState<string | null>(null)
  const [callTitle, setCallTitle] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [sections, setSections] = useState<DraftOneSection[]>([])
  // Ref mirror so sequential run loops read the freshest sections — the
  // `sections` binding captured by a run handler goes stale the moment the
  // first mid-run refresh lands.
  const sectionsRef = useRef<DraftOneSection[]>([])
  const [runStates, setRunStates] = useState<Record<string, DraftOneRunState>>({})
  const [running, setRunning] = useState<false | 'write' | 'review'>(false)
  const stopRequested = useRef(false)
  const selfHealAttempted = useRef(false)
  const [busySection, setBusySection] = useState<string | null>(null)
  const [editorDrafts, setEditorDrafts] = useState<Record<string, string>>({})
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [rewriteNotes, setRewriteNotes] = useState<Record<string, string>>({})
  const [focusedSection, setFocusedSection] = useState<string | null>(null)
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({})
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({})
  const [exportIssues, setExportIssues] = useState<string[] | null>(null)
  const [exporting, setExporting] = useState(false)

  const featureEnabled = isFeatureEnabled('ENABLE_DRAFT_ONE')

  const axiosConfig = useCallback(
    () => ({
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') || '' : ''}`,
      },
    }),
    []
  )

  const surfaceError = useCallback((error: unknown, fallback: string) => {
    toast.error(
      axios.isAxiosError(error) && error.response?.data?.message ? error.response.data.message : fallback
    )
  }, [])

  const refreshSections = useCallback(async (): Promise<DraftOneSection[]> => {
    const response = await axios.get(`/api/projects/${projectId}/grants/${grantId}/sections`, axiosConfig())
    const normalized = (Array.isArray(response.data?.sections) ? response.data.sections : []).map(
      (raw: Record<string, unknown>) => normalizeDraftOneSection(raw)
    )
    setSections(normalized)
    sectionsRef.current = normalized
    return normalized
  }, [projectId, grantId, axiosConfig])

  useEffect(() => {
    if (!projectId || !grantId || !featureEnabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const blueprint = await axios.get(`/api/projects/${projectId}/grants/${grantId}/blueprint`, axiosConfig())
        if (cancelled) return
        let engineId: string | null = blueprint.data?.grantSession?.draftingSessionId || null
        setCallTitle(blueprint.data?.grantSession?.fundingCall?.scheme_title || blueprint.data?.grantSession?.fundingCall?.title || blueprint.data?.grantSession?.title || '')
        setAgencyName(blueprint.data?.grantSession?.fundingCall?.agency_name || '')
        if (!engineId && !selfHealAttempted.current) {
          // Self-heal instead of bouncing the user to the blueprint page: the
          // 'launch' action is idempotent and LLM-free, so re-running it just
          // (re)creates the drafting engine for this grant in a few seconds.
          selfHealAttempted.current = true
          try {
            const healed = await axios.post(
              `/api/projects/${projectId}/grants/${grantId}/blueprint`,
              { action: 'launch' },
              axiosConfig()
            )
            if (cancelled) return
            engineId = healed.data?.grantSession?.draftingSessionId || null
          } catch {
            // Banner below explains the manual path.
          }
        }
        setDraftingSessionId(engineId)
        await refreshSections()
      } catch (error) {
        if (!cancelled) surfaceError(error, 'Failed to load the proposal sections')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, grantId, featureEnabled, axiosConfig, refreshSections, surfaceError])

  const setRunState = useCallback((sectionKey: string, state: DraftOneRunState) => {
    setRunStates((states) => ({ ...states, [sectionKey]: state }))
  }, [])

  /**
   * Generate one section through the existing engine and persist it. Drafting
   * is never blocked: if the deterministic evidence gate 409s, we retry once
   * without mapped citations and let the AI review stage judge the result.
   */
  const draftSection = useCallback(
    async (section: DraftOneSection, options?: { instructions?: string; runState?: DraftOneRunState }): Promise<boolean> => {
      if (!draftingSessionId) {
        toast.error('The drafting engine is not ready yet — open the blueprint once, then retry.')
        return false
      }
      const key = section.sectionKey
      try {
        setRunState(key, options?.runState || 'writing')
        const hasContent = Boolean(section.content.trim())
        const generateOnce = async (useMappedEvidence: boolean) => {
          const response = await axios.post(
            `/api/papers/${draftingSessionId}/drafting`,
            {
              action: hasContent || options?.instructions ? 'regenerate_section' : 'generate_section',
              sectionKey: key,
              instructions: options?.instructions || '',
              useMappedEvidence,
              allowGrantEvidenceBypass: !useMappedEvidence,
              autoCitationRepair: false,
            },
            axiosConfig()
          )
          const content = String(response.data?.content || '')
          if (!content.trim()) throw new Error(`The engine returned no content for "${section.label}".`)
          return content
        }

        let content: string
        try {
          content = await generateOnce(section.citationMode !== 'no_citations')
        } catch (error) {
          const code = axios.isAxiosError(error) ? error.response?.data?.code : null
          if (code === 'MAPPED_EVIDENCE_MISSING' || code === 'GRANT_EVIDENCE_READINESS_FAILED') {
            // Evidence isn't mapped yet — draft without citations instead of
            // blocking, and say so. Literature mapping can still happen later.
            content = await generateOnce(false)
            setEvidenceNotes((notes) => ({
              ...notes,
              [key]: 'Drafted without mapped citations — run literature mapping in the workspace to add evidence.',
            }))
          } else {
            throw error
          }
        }

        await axios.patch(
          `/api/projects/${projectId}/grants/${grantId}/sections/${encodeURIComponent(key)}`,
          { content, markReviewed: false },
          axiosConfig()
        )
        await refreshSections()
        setRunState(key, 'done')
        return true
      } catch (error) {
        setRunState(key, 'failed')
        surfaceError(error, `Failed to draft "${section.label}"`)
        return false
      }
    },
    [draftingSessionId, projectId, grantId, axiosConfig, refreshSections, setRunState, surfaceError]
  )

  /** Run the LLM agency-rule review for one drafted section. */
  const reviewSection = useCallback(
    async (section: DraftOneSection): Promise<boolean> => {
      const key = section.sectionKey
      try {
        setRunState(key, 'reviewing')
        await axios.post(
          `/api/projects/${projectId}/grants/${grantId}/sections/${encodeURIComponent(key)}/ai-review`,
          {},
          axiosConfig()
        )
        await refreshSections()
        setRunState(key, 'done')
        return true
      } catch (error) {
        setRunState(key, 'failed')
        surfaceError(error, `AI review failed for "${section.label}"`)
        return false
      }
    },
    [projectId, grantId, axiosConfig, refreshSections, setRunState, surfaceError]
  )

  /** Write every remaining auto-draftable section, in template order. */
  const handleWriteAll = useCallback(async () => {
    if (running) return
    const queue = buildDraftOneQueue(sections)
    if (!queue.length) {
      toast('Every AI-draftable section already has content — use per-section actions to revise.', { icon: 'ℹ️' })
      return
    }
    setRunning('write')
    stopRequested.current = false
    setRunStates(Object.fromEntries(queue.map((section) => [section.sectionKey, 'queued' as DraftOneRunState])))
    let completed = 0
    for (const section of queue) {
      if (stopRequested.current) break
      const latest = sectionsRef.current.find((entry) => entry.sectionKey === section.sectionKey) || section
      const ok = await draftSection(latest)
      if (ok) completed += 1
    }
    setRunning(false)
    if (completed) {
      toast.success(`Drafted ${completed} of ${queue.length} sections. Next: run the AI review.`)
    }
  }, [running, sections, draftSection])

  /** AI-review every drafted section that lacks a current verdict. */
  const handleReviewAll = useCallback(async () => {
    if (running) return
    const queue = buildAiReviewQueue(sections)
    if (!queue.length) {
      toast('Every drafted section already has a current AI review.', { icon: 'ℹ️' })
      return
    }
    setRunning('review')
    stopRequested.current = false
    setRunStates(Object.fromEntries(queue.map((section) => [section.sectionKey, 'queued' as DraftOneRunState])))
    let flagged = 0
    for (const section of queue) {
      if (stopRequested.current) break
      const ok = await reviewSection(section)
      if (ok) {
        const latest = sectionsRef.current.find((entry) => entry.sectionKey === section.sectionKey)
        if (latest?.status === 'issues') flagged += 1
      }
    }
    setRunning(false)
    const readyNow = summarizeDraftOneSections(sectionsRef.current)
    toast.success(
      flagged
        ? `AI review finished — ${flagged} section${flagged === 1 ? '' : 's'} need${flagged === 1 ? 's' : ''} attention.`
        : `AI review finished — ${readyNow.ready} of ${readyNow.draftable} sections are ready.`
    )
  }, [running, sections, reviewSection])

  const handleSingleWrite = useCallback(
    async (section: DraftOneSection, instructions?: string) => {
      if (busySection || running) return
      setBusySection(section.sectionKey)
      await draftSection(section, { instructions })
      setBusySection(null)
    },
    [busySection, running, draftSection]
  )

  const handleSingleReview = useCallback(
    async (section: DraftOneSection) => {
      if (busySection || running) return
      setBusySection(section.sectionKey)
      await reviewSection(section)
      setBusySection(null)
    },
    [busySection, running, reviewSection]
  )

  /** Apply the reviewer's findings via one LLM revision, then re-review. */
  const handleFixWithAi = useCallback(
    async (section: DraftOneSection) => {
      if (!section.aiReview || busySection || running) return
      const instructions = buildAiFixInstructions({
        section,
        report: section.aiReview,
        userNote: rewriteNotes[section.sectionKey] || null,
      })
      setBusySection(section.sectionKey)
      const ok = await draftSection(section, { instructions, runState: 'fixing' })
      if (ok) {
        const latest = sectionsRef.current.find((entry) => entry.sectionKey === section.sectionKey) || section
        await reviewSection(latest)
      }
      setBusySection(null)
    },
    [busySection, running, rewriteNotes, draftSection, reviewSection]
  )

  const handleSaveEdit = useCallback(
    async (section: DraftOneSection) => {
      const content = editorDrafts[section.sectionKey]
      if (typeof content !== 'string') return
      setBusySection(section.sectionKey)
      try {
        await axios.patch(
          `/api/projects/${projectId}/grants/${grantId}/sections/${encodeURIComponent(section.sectionKey)}`,
          { content, markReviewed: true },
          axiosConfig()
        )
        setEditingSection(null)
        await refreshSections()
        toast.success('Saved — re-run the AI review to refresh this section’s verdict.')
      } catch (error) {
        surfaceError(error, 'Failed to save the section')
      } finally {
        setBusySection(null)
      }
    },
    [editorDrafts, projectId, grantId, axiosConfig, refreshSections, surfaceError]
  )

  const handleExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/export?mode=final`, {
        headers: axiosConfig().headers,
      })
      if (response.status === 409) {
        const payload = await response.json().catch(() => ({}))
        setExportIssues(Array.isArray(payload?.issues) && payload.issues.length ? payload.issues : [payload?.message || 'The proposal is not ready for final export.'])
        return
      }
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'grant-proposal.docx'
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success('Final proposal exported — every section passed the AI review.')
    } catch (error) {
      surfaceError(error, 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [exporting, projectId, grantId, axiosConfig, surfaceError])

  const handleDraftExport = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/export?mode=draft`, {
        headers: axiosConfig().headers,
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'grant-proposal-draft.docx'
      anchor.click()
      URL.revokeObjectURL(url)
      setExportIssues(null)
      toast('Draft exported — this file has NOT passed the AI review gates.', { icon: '⚠️' })
    } catch (error) {
      surfaceError(error, 'Draft export failed')
    }
  }, [projectId, grantId, axiosConfig, surfaceError])

  const summary = useMemo(() => summarizeDraftOneSections(sections), [sections])
  // Agency template order — sections render exactly as the call's template
  // lists them, never re-shuffled.
  const orderedSections = useMemo(() => [...sections].sort((a, b) => a.sectionOrder - b.sectionOrder), [sections])
  const focused = useMemo(
    () => orderedSections.find((section) => section.sectionKey === focusedSection) || orderedSections.find((section) => section.autoDraftable) || null,
    [orderedSections, focusedSection]
  )

  const writeQueueSize = useMemo(() => buildDraftOneQueue(sections).length, [sections])
  const reviewQueueSize = useMemo(() => buildAiReviewQueue(sections).length, [sections])
  const allReady = summary.draftable > 0 && summary.ready === summary.draftable

  if (!featureEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f2efe8] p-6">
        <div className="max-w-md rounded-lg border border-stone-200 bg-white p-8 text-center shadow-sm">
          <HiSparkles className="mx-auto mb-3 h-8 w-8 text-stone-300" />
          <h1 className="text-lg font-semibold text-stone-900" style={{ fontFamily: SERIF }}>Draft One is not enabled</h1>
          <p className="mt-2 text-sm text-stone-500">
            Set <code className="rounded bg-stone-100 px-1">NEXT_PUBLIC_FEATURE_ENABLE_DRAFT_ONE=true</code> and{' '}
            <code className="rounded bg-stone-100 px-1">FEATURE_ENABLE_DRAFT_ONE=true</code> to try the drafting fast path.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f2efe8]">
        <div className="text-sm text-stone-500" style={{ fontFamily: SERIF }}>Preparing your manuscript…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f2efe8] pb-24">
      <Toaster position="top-right" />

      <header className="sticky top-0 z-30 border-b border-stone-200 bg-[#fbfaf6]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-stone-900 text-white">
              <HiPencilSquare className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-stone-900" style={{ fontFamily: SERIF }}>
                Draft One
              </div>
              <div className="max-w-[42ch] truncate text-xs text-stone-500">
                {[agencyName, callTitle].filter(Boolean).join(' · ') || 'Proposal drafting'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <StageStep
              index={1}
              label="Write"
              detail={`${summary.drafted}/${summary.draftable} drafted`}
              state={summary.draftable > 0 && summary.drafted === summary.draftable ? 'done' : 'active'}
            />
            <span className="h-px w-6 bg-stone-300" />
            <StageStep
              index={2}
              label="AI review"
              detail={`${summary.ready}/${summary.draftable} ready`}
              state={allReady ? 'done' : summary.drafted > 0 ? 'active' : 'todo'}
            />
            <span className="h-px w-6 bg-stone-300" />
            <StageStep index={3} label="Export" detail={allReady ? 'gates passed' : 'after review'} state={allReady ? 'active' : 'todo'} />
          </div>
          <div className="ml-auto">
            <button
              onClick={handleExport}
              disabled={exporting || Boolean(running)}
              className="flex items-center gap-1.5 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              <HiArrowDownTray className="h-4 w-4" /> {exporting ? 'Checking gates…' : 'Export proposal'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6">
        {!draftingSessionId ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            The drafting engine couldn’t be initialized automatically for this grant. Open the{' '}
            <button className="underline" onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/workspace?stage=SECTION_DRAFTING`)}>
              workspace
            </button>{' '}
            once, then return here.
          </div>
        ) : null}

        {/* Conductor: one primary action for the current stage */}
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-[0_1px_2px_rgba(64,55,38,0.05),0_10px_30px_-18px_rgba(64,55,38,0.28)]">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900" style={{ fontFamily: SERIF }}>
                {writeQueueSize > 0 || summary.draftable === 0
                  ? 'Write the proposal'
                  : reviewQueueSize > 0
                    ? 'Review against the agency’s rules'
                    : allReady
                      ? 'Ready to export'
                      : 'Resolve the reviewer’s findings'}
              </h2>
              <p className="mt-0.5 text-sm text-stone-500">
                {summary.drafted} of {summary.draftable} sections drafted · {summary.ready} ready ·{' '}
                {summary.withIssues} with findings · {summary.manual} handled by your team
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {running ? (
                <button
                  onClick={() => {
                    stopRequested.current = true
                    toast('Finishing the current section, then stopping.', { icon: '⏸' })
                  }}
                  className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  Stop after this section
                </button>
              ) : (
                <>
                  {writeQueueSize > 0 ? (
                    <button
                      onClick={handleWriteAll}
                      disabled={!draftingSessionId || busySection !== null}
                      className="flex items-center gap-1.5 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                    >
                      <HiPlay className="h-4 w-4" /> {summary.drafted ? `Write remaining (${writeQueueSize})` : 'Write the full draft'}
                    </button>
                  ) : null}
                  {reviewQueueSize > 0 ? (
                    <button
                      onClick={handleReviewAll}
                      disabled={busySection !== null}
                      className={clsx(
                        'flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50',
                        writeQueueSize > 0
                          ? 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                          : 'bg-stone-900 text-white hover:bg-stone-700'
                      )}
                    >
                      <HiSparkles className="h-4 w-4" /> Run AI review ({reviewQueueSize})
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {Object.keys(runStates).length ? (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-stone-800 transition-all duration-500"
                style={{
                  width: `${Math.round(
                    (Object.values(runStates).filter((state) => state === 'done' || state === 'failed').length /
                      Math.max(1, Object.keys(runStates).length)) * 100
                  )}%`,
                }}
              />
            </div>
          ) : null}
          {Object.keys(runStates).length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {orderedSections
                .filter((section) => runStates[section.sectionKey])
                .map((section) => {
                  const state = runStates[section.sectionKey]
                  return (
                    <span
                      key={section.sectionKey}
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
                        state === 'done'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : state === 'failed'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : state === 'queued'
                              ? 'border-stone-200 bg-stone-50 text-stone-500'
                              : 'border-amber-200 bg-amber-50 text-amber-800'
                      )}
                    >
                      {state === 'done' ? <HiCheck className="h-3 w-3" /> : state === 'failed' ? <HiExclamationTriangle className="h-3 w-3" /> : <HiArrowPath className={clsx('h-3 w-3', state !== 'queued' && 'animate-spin')} />}
                      {section.label}: {RUN_STATE_LABEL[state]}
                    </span>
                  )
                })}
            </div>
          ) : null}
        </div>

        {/* Manuscript + agency lens */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-6">
            {orderedSections.map((section, index) => {
              const isEditing = editingSection === section.sectionKey
              const busy = busySection === section.sectionKey || Boolean(runStates[section.sectionKey] && running)
              const findings = section.aiReview?.findings || []
              const findingsExpanded = Boolean(expandedFindings[section.sectionKey])
              const visibleFindings = findingsExpanded ? findings : findings.slice(0, 3)
              const showFindings = section.status === 'issues' && findings.length > 0
              return (
                <section
                  key={section.sectionKey}
                  onFocus={() => setFocusedSection(section.sectionKey)}
                  onClick={() => setFocusedSection(section.sectionKey)}
                  className={clsx(
                    'rounded-lg border bg-white shadow-[0_1px_2px_rgba(64,55,38,0.05),0_10px_30px_-18px_rgba(64,55,38,0.28)] transition-colors',
                    focused?.sectionKey === section.sectionKey ? 'border-stone-400' : 'border-stone-200'
                  )}
                >
                  {/* Sheet header */}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-stone-100 px-6 pb-3 pt-5 sm:px-8">
                    <span className="text-sm tabular-nums text-stone-400" style={{ fontFamily: SERIF }}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="text-base font-semibold text-stone-900" style={{ fontFamily: SERIF }}>
                      {section.label}
                    </h3>
                    {section.required ? (
                      <span className="text-[10px] font-medium uppercase tracking-widest text-stone-400">required</span>
                    ) : null}
                    <StatusChip section={section} />
                    <div className="ml-auto">
                      <WordMeter section={section} />
                    </div>
                  </div>

                  {section.autoDraftable ? (
                    <div className="px-6 py-5 sm:px-8">
                      {evidenceNotes[section.sectionKey] ? (
                        <p className="mb-3 text-[11px] leading-relaxed text-stone-400">
                          ⓘ {evidenceNotes[section.sectionKey]}
                        </p>
                      ) : null}

                      {showFindings ? (
                        <div className="mb-4 rounded-md border border-amber-200/80 bg-[#fdf8ec] px-4 py-3">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                              AI reviewer — {findings.length} finding{findings.length === 1 ? '' : 's'}
                            </span>
                            {section.aiReview?.summary ? (
                              <span className="text-[11px] italic text-stone-500">“{section.aiReview.summary}”</span>
                            ) : null}
                          </div>
                          <ul className="mt-2 space-y-1.5">
                            {visibleFindings.map((finding, findingIndex) => {
                              const meta = SEVERITY_META[finding.severity] || SEVERITY_META.important
                              return (
                                <li key={findingIndex} className="flex items-start gap-2 text-xs leading-relaxed text-stone-700">
                                  <span className={clsx('mt-px flex-none font-semibold', meta.className)} title={meta.label}>
                                    {meta.mark}
                                  </span>
                                  <span>
                                    {finding.issue}
                                    {finding.fix && finding.fix !== finding.issue ? (
                                      <span className="text-stone-500"> — {finding.fix}</span>
                                    ) : null}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                          {findings.length > 3 ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
                                setExpandedFindings((state) => ({ ...state, [section.sectionKey]: !findingsExpanded }))
                              }}
                              className="mt-2 text-xs font-medium text-amber-800 underline-offset-2 hover:underline"
                            >
                              {findingsExpanded ? 'Show fewer' : `Show all ${findings.length}`}
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {isEditing ? (
                        <>
                          <textarea
                            value={editorDrafts[section.sectionKey] ?? section.content}
                            onChange={(event) => setEditorDrafts((drafts) => ({ ...drafts, [section.sectionKey]: event.target.value }))}
                            rows={16}
                            className="w-full rounded-md border border-stone-200 bg-[#fdfcf9] p-5 text-[15px] leading-relaxed text-stone-800 focus:border-stone-400 focus:outline-none"
                            style={{ fontFamily: SERIF }}
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => handleSaveEdit(section)}
                              disabled={busy}
                              className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingSection(null)}
                              className="rounded-md border border-stone-200 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : section.content ? (
                        <div className="max-h-[32rem] overflow-y-auto pr-1">
                          <MarkdownRenderer content={section.content} />
                        </div>
                      ) : (
                        <p className="text-sm italic text-stone-400" style={{ fontFamily: SERIF }}>
                          Not written yet — run the full draft, or write this section alone.
                        </p>
                      )}

                      {!isEditing ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
                          <button
                            onClick={() => handleSingleWrite(section)}
                            disabled={busy || Boolean(running) || !draftingSessionId}
                            className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                          >
                            {section.content ? 'Rewrite' : 'Write this section'}
                          </button>
                          {section.content && (section.status === 'unreviewed' || section.status === 'issues') ? (
                            <button
                              onClick={() => handleSingleReview(section)}
                              disabled={busy || Boolean(running)}
                              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                            >
                              {section.status === 'issues' ? 'Re-run AI review' : 'Run AI review'}
                            </button>
                          ) : null}
                          {section.status === 'issues' ? (
                            <button
                              onClick={() => handleFixWithAi(section)}
                              disabled={busy || Boolean(running)}
                              className="rounded-md border border-amber-300 bg-amber-100/70 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                            >
                              Fix with AI
                            </button>
                          ) : null}
                          {section.content ? (
                            <button
                              onClick={() => {
                                setEditingSection(section.sectionKey)
                                setEditorDrafts((drafts) => ({ ...drafts, [section.sectionKey]: section.content }))
                              }}
                              disabled={busy}
                              className="rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                            >
                              Edit myself
                            </button>
                          ) : null}
                          <input
                            value={rewriteNotes[section.sectionKey] || ''}
                            onChange={(event) => setRewriteNotes((notes) => ({ ...notes, [section.sectionKey]: event.target.value }))}
                            onKeyDown={(event) => {
                              const note = (rewriteNotes[section.sectionKey] || '').trim()
                              if (event.key === 'Enter' && note && !busy && !running) {
                                handleSingleWrite(section, `AUTHOR NOTE (must be honored): ${note}`)
                              }
                            }}
                            placeholder="Steer a rewrite — e.g. “lead with the pilot data” ⏎"
                            className="min-w-[220px] flex-1 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-700 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="px-6 py-4 text-xs text-stone-400 sm:px-8">
                      This section ({section.sectionType.replace('_', ' ')}) is completed by your team in the{' '}
                      <button
                        className="underline"
                        onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/workspace?stage=SECTION_DRAFTING`)}
                      >
                        full workspace
                      </button>
                      .
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {/* Agency lens: what the template expects from the focused section */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-lg border border-stone-200 bg-[#fbf9f3] p-5">
              <h3 className="text-sm font-semibold text-stone-800" style={{ fontFamily: SERIF }}>
                Agency lens
              </h3>
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-stone-400">
                {focused?.label || 'select a section'}
              </p>

              {focused?.aiReview && !focused.aiReviewStale ? (
                <div className="mt-4 rounded-md border border-stone-200 bg-white px-3 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] uppercase tracking-wide text-stone-400">AI review</span>
                    <span
                      className={clsx(
                        'text-[11px] font-semibold',
                        focused.aiReview.verdict === 'ready'
                          ? 'text-emerald-700'
                          : focused.aiReview.verdict === 'minor_revisions'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                      )}
                    >
                      {focused.aiReview.verdict.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-1 text-3xl text-stone-800" style={{ fontFamily: SERIF }}>
                    {focused.aiReview.score}
                    <span className="text-sm text-stone-400"> / 100</span>
                  </div>
                  {focused.aiReview.summary ? (
                    <p className="mt-1.5 text-[11px] italic leading-relaxed text-stone-500">“{focused.aiReview.summary}”</p>
                  ) : null}
                  {focused.aiReview.strengths.slice(0, 2).map((strength) => (
                    <p key={strength} className="mt-1.5 text-[11px] leading-relaxed text-emerald-700">
                      ✓ {strength}
                    </p>
                  ))}
                </div>
              ) : focused?.content ? (
                <p className="mt-3 text-xs text-stone-400">
                  {focused.aiReviewStale
                    ? 'The draft changed after its last review — re-run the AI review.'
                    : 'Not yet AI-reviewed against the agency rules.'}
                </p>
              ) : null}

              {focused?.ruleProfile ? (
                <div className="mt-4 space-y-4 text-xs">
                  {(
                    [
                      ['requiredPoints', 'Must cover', '○'],
                      ['avoidRules', 'Avoid', '✕'],
                      ['evaluationFocus', 'Scored on', '◆'],
                      ['reviewerSignals', 'Reviewers look for', '¶'],
                      ['formatConstraints', 'Format', '§'],
                    ] as const
                  ).map(([field, label, mark]) => {
                    const rules = focused.ruleProfile?.[field] || []
                    if (!rules.length) return null
                    return (
                      <div key={field}>
                        <div className="font-semibold text-stone-600">{label}</div>
                        <ul className="mt-1.5 space-y-1.5 border-l border-stone-200 pl-3">
                          {rules.slice(0, 4).map((rule) => (
                            <li key={rule} className="flex items-start gap-1.5 leading-relaxed text-stone-500">
                              <span className="flex-none text-stone-300">{mark}</span>
                              {summarizeGrantRuleText(rule, 140) || rule}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                  <p className="border-t border-stone-200 pt-3 text-[11px] leading-relaxed text-stone-400">
                    These rules guide the writing and are enforced by the AI review — they never block drafting.
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-stone-400">No routed rules for this section.</p>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* Export gate modal */}
      {exportIssues ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm" onClick={() => setExportIssues(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-base font-semibold text-stone-900" style={{ fontFamily: SERIF }}>
              Not ready for final export
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              The AI review gates found {exportIssues.length} issue{exportIssues.length === 1 ? '' : 's'}:
            </p>
            <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
              {exportIssues.map((issue) => (
                <li key={issue} className="flex items-start gap-2 text-xs text-amber-800">
                  <HiExclamationTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-500" />
                  {summarizeGrantRuleText(issue, 200) || issue}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={handleDraftExport}
                className="rounded-md border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Export draft anyway
              </button>
              <button
                onClick={() => setExportIssues(null)}
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
              >
                Keep fixing
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
