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
  buildDraftOneQueue,
  buildRepairInstructions,
  countWords,
  normalizeDraftOneSection,
  shouldAutoRepair,
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
  checking: 'Checking rules…',
  repairing: 'Repairing…',
  done: 'Done',
  failed: 'Failed',
}

/** Matches the MarkdownRenderer typography so the page reads as one document. */
const SERIF = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif'

function SectionStatusChip({ section }: { section: DraftOneSection }) {
  if (!section.autoDraftable) {
    return <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">handled by your team</span>
  }
  if (section.status === 'passed') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> meets agency rules
      </span>
    )
  }
  if (section.status === 'issues') {
    const count =
      (section.compliance?.unmetRequiredPoints.length || 0)
      + (section.compliance?.violatedAvoidRules.length || 0)
      || section.compliance?.hardFailures.length
      || 1
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {count} point{count === 1 ? '' : 's'} to address
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
  if (section.status === 'unvalidated' && section.content) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300" /> not yet validated
      </span>
    )
  }
  return null
}

export default function DraftOnePage() {
  const params = useParams<{ projectId: string; grantId: string }>()
  const router = useRouter()
  const projectId = String(params?.projectId || '')
  const grantId = String(params?.grantId || '')

  const [loading, setLoading] = useState(true)
  const [draftingSessionId, setDraftingSessionId] = useState<string | null>(null)
  const [callTitle, setCallTitle] = useState('')
  const [sections, setSections] = useState<DraftOneSection[]>([])
  // Ref mirror so the sequential run loop reads the freshest sections — the
  // `sections` binding captured by handleRun goes stale the moment the first
  // mid-run refresh lands, which made later queue items draft against
  // pre-run content and citation modes.
  const sectionsRef = useRef<DraftOneSection[]>([])
  const [runStates, setRunStates] = useState<Record<string, DraftOneRunState>>({})
  const [running, setRunning] = useState(false)
  const stopRequested = useRef(false)
  const selfHealAttempted = useRef(false)
  const [busySection, setBusySection] = useState<string | null>(null)
  const [editorDrafts, setEditorDrafts] = useState<Record<string, string>>({})
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [rewriteNotes, setRewriteNotes] = useState<Record<string, string>>({})
  const [focusedSection, setFocusedSection] = useState<string | null>(null)
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({})
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
        setCallTitle(blueprint.data?.grantSession?.fundingCall?.title || blueprint.data?.grantSession?.title || '')
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
   * Generate one section through the existing engine, persist it to the grant,
   * re-read its compliance report, and — if the agency check failed — run ONE
   * automatic repair generation fed the exact failures.
   */
  const draftSection = useCallback(
    async (section: DraftOneSection, options?: { instructions?: string; forceRegenerate?: boolean }): Promise<boolean> => {
      if (!draftingSessionId) {
        toast.error('The drafting engine is not ready yet — open the blueprint once, then retry.')
        return false
      }
      const key = section.sectionKey
      try {
        setRunState(key, 'writing')
        const hasContent = Boolean(section.content.trim())
        const generate = async (instructions: string) => {
          const response = await axios.post(
            `/api/papers/${draftingSessionId}/drafting`,
            {
              action: hasContent || options?.forceRegenerate || instructions ? 'regenerate_section' : 'generate_section',
              sectionKey: key,
              instructions,
              useMappedEvidence: section.citationMode !== 'no_citations',
              allowGrantEvidenceBypass: section.citationMode === 'no_citations',
              autoCitationRepair: false,
            },
            axiosConfig()
          )
          const content = String(response.data?.content || '')
          if (!content.trim()) throw new Error(`The engine returned no content for "${section.label}".`)
          await axios.patch(
            `/api/projects/${projectId}/grants/${grantId}/sections/${encodeURIComponent(key)}`,
            { content, markReviewed: false },
            axiosConfig()
          )
        }

        await generate(options?.instructions || '')

        setRunState(key, 'checking')
        let refreshed = await refreshSections()
        let current = refreshed.find((entry) => entry.sectionKey === key) || null

        if (current && shouldAutoRepair(current.compliance)) {
          setRunState(key, 'repairing')
          const repairInstructions = buildRepairInstructions({
            section: current,
            compliance: current.compliance!,
            readiness: current.readiness,
          })
          await generate(repairInstructions)
          setRunState(key, 'checking')
          refreshed = await refreshSections()
          current = refreshed.find((entry) => entry.sectionKey === key) || null
        }

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

  /** The Run: draft every remaining auto-draftable section, in template order. */
  const handleRun = useCallback(async () => {
    if (running) return
    const queue = buildDraftOneQueue(sections)
    if (!queue.length) {
      toast('Every AI-draftable section already has content — use per-section actions to revise.', { icon: 'ℹ️' })
      return
    }
    setRunning(true)
    stopRequested.current = false
    setRunStates(Object.fromEntries(queue.map((section) => [section.sectionKey, 'queued' as DraftOneRunState])))
    let completed = 0
    for (const section of queue) {
      if (stopRequested.current) break
      // Read through the ref — the `sections` closure is frozen at run start,
      // but every drafted section refreshes state mid-run.
      const latest = sectionsRef.current.find((entry) => entry.sectionKey === section.sectionKey) || section
      const ok = await draftSection(latest)
      if (ok) completed += 1
    }
    setRunning(false)
    if (completed) {
      toast.success(`Drafted ${completed} of ${queue.length} sections — review the ones flagged with issues.`)
    }
  }, [running, sections, draftSection])

  const handleSingle = useCallback(
    async (section: DraftOneSection, instructions?: string) => {
      if (busySection || running) return
      setBusySection(section.sectionKey)
      await draftSection(section, { instructions, forceRegenerate: true })
      setBusySection(null)
    },
    [busySection, running, draftSection]
  )

  const handleFixIssues = useCallback(
    async (section: DraftOneSection) => {
      if (!section.compliance || section.compliance.passed) return
      const instructions = buildRepairInstructions({
        section,
        compliance: section.compliance,
        readiness: section.readiness,
        userNote: rewriteNotes[section.sectionKey] || null,
      })
      await handleSingle(section, instructions)
    },
    [handleSingle, rewriteNotes]
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
        toast.success('Saved')
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
      toast.success('Final proposal exported — every agency gate passed.')
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
      toast('Draft exported — the file is watermark-free but has NOT passed the agency gates.', { icon: '⚠️' })
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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-900 text-white">
              <HiPencilSquare className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-stone-900" style={{ fontFamily: SERIF }}>
                Draft One
              </div>
              <div className="max-w-[46ch] truncate text-xs text-stone-500">{callTitle || 'Proposal drafting'}</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium',
                summary.passed === summary.draftable && summary.draftable > 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-stone-200 bg-white text-stone-600'
              )}
            >
              {summary.passed}/{summary.draftable} sections pass agency rules
            </span>
            <button
              onClick={handleExport}
              disabled={exporting || running}
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

        {/* The Run */}
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-[0_1px_2px_rgba(64,55,38,0.05),0_10px_30px_-18px_rgba(64,55,38,0.28)]">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900" style={{ fontFamily: SERIF }}>
                Draft the proposal
              </h2>
              <p className="mt-0.5 text-sm text-stone-500">
                {summary.drafted} of {summary.draftable} AI sections drafted · {summary.withIssues} with rule issues ·{' '}
                {summary.manual} handled by your team
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
                <button
                  onClick={handleRun}
                  disabled={!draftingSessionId || busySection !== null}
                  className="flex items-center gap-1.5 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                >
                  <HiPlay className="h-4 w-4" /> {summary.drafted ? 'Draft remaining sections' : 'Draft the proposal'}
                </button>
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

        {/* Manuscript + margin notes */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-6">
            {orderedSections.map((section, index) => {
              const words = countWords(section.content)
              const overBudget = section.wordBudget ? words > section.wordBudget : false
              const nearBudget = section.wordBudget ? !overBudget && words > section.wordBudget * 0.9 : false
              const isEditing = editingSection === section.sectionKey
              const busy = busySection === section.sectionKey || Boolean(runStates[section.sectionKey] && running)
              const issueItems: Array<{ mark: string; tone: 'point' | 'avoid' | 'hard'; text: string }> = section.compliance && section.status === 'issues'
                ? [
                    ...section.compliance.unmetRequiredPoints.map((point) => ({ mark: '○', tone: 'point' as const, text: point })),
                    ...section.compliance.violatedAvoidRules.map((rule) => ({ mark: '✕', tone: 'avoid' as const, text: rule })),
                    ...section.compliance.hardFailures
                      .filter((finding) => !finding.message.startsWith('Required point is still missing'))
                      .map((finding) => ({ mark: '!', tone: 'hard' as const, text: finding.message })),
                  ]
                : []
              const issuesExpanded = Boolean(expandedIssues[section.sectionKey])
              const visibleIssues = issuesExpanded ? issueItems : issueItems.slice(0, 4)
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
                    <SectionStatusChip section={section} />
                    <div className="ml-auto">
                      {section.wordBudget ? (
                        <span
                          className={clsx(
                            'text-xs tabular-nums',
                            overBudget ? 'font-semibold text-rose-600' : nearBudget ? 'text-amber-600' : 'text-stone-400'
                          )}
                        >
                          {words} / {section.wordBudget} words
                        </span>
                      ) : section.content ? (
                        <span className="text-xs tabular-nums text-stone-400">{words} words</span>
                      ) : null}
                    </div>
                  </div>

                  {section.autoDraftable ? (
                    <div className="px-6 py-5 sm:px-8">
                      {issueItems.length ? (
                        <div className="mb-4 rounded-md border border-amber-200/80 bg-[#fdf8ec] px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                            Agency check — {issueItems.length} point{issueItems.length === 1 ? '' : 's'} to address
                          </div>
                          <ul className="mt-2 space-y-1.5">
                            {visibleIssues.map((issue, issueIndex) => (
                              <li key={issueIndex} className="flex items-start gap-2 text-xs leading-relaxed text-stone-700">
                                <span
                                  className={clsx(
                                    'mt-px flex-none font-semibold',
                                    issue.tone === 'avoid' ? 'text-rose-500' : issue.tone === 'hard' ? 'text-amber-600' : 'text-stone-400'
                                  )}
                                >
                                  {issue.mark}
                                </span>
                                {summarizeGrantRuleText(issue.text, 180) || issue.text}
                              </li>
                            ))}
                          </ul>
                          {issueItems.length > 4 ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
                                setExpandedIssues((state) => ({ ...state, [section.sectionKey]: !issuesExpanded }))
                              }}
                              className="mt-2 text-xs font-medium text-amber-800 underline-offset-2 hover:underline"
                            >
                              {issuesExpanded ? 'Show fewer' : `Show all ${issueItems.length}`}
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
                          Not written yet — run the full draft, or draft this section alone.
                        </p>
                      )}

                      {!isEditing ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
                          <button
                            onClick={() => handleSingle(section)}
                            disabled={busy || running || !draftingSessionId}
                            className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                          >
                            {section.content ? 'Regenerate' : 'Draft this section'}
                          </button>
                          {section.status === 'issues' ? (
                            <button
                              onClick={() => handleFixIssues(section)}
                              disabled={busy || running}
                              className="rounded-md border border-amber-300 bg-amber-100/70 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                            >
                              Fix rule issues
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
                                handleSingle(section, `AUTHOR NOTE (must be honored): ${note}`)
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

          {/* Margin notes: agency rules for the focused section */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-lg border border-stone-200 bg-[#fbf9f3] p-5">
              <h3 className="text-sm font-semibold text-stone-800" style={{ fontFamily: SERIF }}>
                Agency rules
              </h3>
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-stone-400">
                {focused?.label || 'select a section'}
              </p>
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
                    const covered = new Set(focused.compliance?.coveredRequiredPoints || [])
                    return (
                      <div key={field}>
                        <div className="font-semibold text-stone-600">{label}</div>
                        <ul className="mt-1.5 space-y-1.5 border-l border-stone-200 pl-3">
                          {rules.slice(0, 4).map((rule) => (
                            <li key={rule} className="flex items-start gap-1.5 leading-relaxed text-stone-500">
                              <span className={clsx('flex-none', field === 'requiredPoints' && covered.has(rule) ? 'text-emerald-500' : 'text-stone-300')}>
                                {field === 'requiredPoints' && covered.has(rule) ? '●' : mark}
                              </span>
                              {summarizeGrantRuleText(rule, 140) || rule}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs text-stone-400">No routed rules for this section.</p>
              )}
              {focused?.readiness ? (
                <div className="mt-5 border-t border-stone-200 pt-4">
                  <div className="text-[11px] uppercase tracking-wide text-stone-400">Reviewer readiness</div>
                  <div className="mt-1 text-3xl text-stone-800" style={{ fontFamily: SERIF }}>
                    {focused.readiness.score}
                    <span className="text-sm text-stone-400"> / 100</span>
                  </div>
                  {focused.readiness.recommendedActions.slice(0, 2).map((action) => (
                    <p key={action} className="mt-1.5 text-[11px] leading-relaxed text-stone-500">
                      → {action}
                    </p>
                  ))}
                </div>
              ) : null}
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
            <p className="mt-1 text-sm text-stone-500">The agency gates found {exportIssues.length} issue{exportIssues.length === 1 ? '' : 's'}:</p>
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
