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

export default function DraftOnePage() {
  const params = useParams<{ projectId: string; grantId: string }>()
  const router = useRouter()
  const projectId = String(params?.projectId || '')
  const grantId = String(params?.grantId || '')

  const [loading, setLoading] = useState(true)
  const [draftingSessionId, setDraftingSessionId] = useState<string | null>(null)
  const [callTitle, setCallTitle] = useState('')
  const [sections, setSections] = useState<DraftOneSection[]>([])
  const [runStates, setRunStates] = useState<Record<string, DraftOneRunState>>({})
  const [running, setRunning] = useState(false)
  const stopRequested = useRef(false)
  const [busySection, setBusySection] = useState<string | null>(null)
  const [editorDrafts, setEditorDrafts] = useState<Record<string, string>>({})
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [rewriteNotes, setRewriteNotes] = useState<Record<string, string>>({})
  const [focusedSection, setFocusedSection] = useState<string | null>(null)
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
        setDraftingSessionId(blueprint.data?.grantSession?.draftingSessionId || null)
        setCallTitle(blueprint.data?.grantSession?.fundingCall?.title || blueprint.data?.grantSession?.title || '')
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
      const latest = sections.find((entry) => entry.sectionKey === section.sectionKey) || section
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
  const orderedSections = useMemo(() => [...sections].sort((a, b) => a.sectionOrder - b.sectionOrder), [sections])
  const focused = useMemo(
    () => orderedSections.find((section) => section.sectionKey === focusedSection) || orderedSections.find((section) => section.autoDraftable) || null,
    [orderedSections, focusedSection]
  )

  if (!featureEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-prep-surface p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-prep-card">
          <HiSparkles className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <h1 className="text-lg font-semibold text-slate-900">Draft One is not enabled</h1>
          <p className="mt-2 text-sm text-slate-500">
            Set <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_FEATURE_ENABLE_DRAFT_ONE=true</code> and{' '}
            <code className="rounded bg-slate-100 px-1">FEATURE_ENABLE_DRAFT_ONE=true</code> to try the drafting fast path.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-prep-surface">
        <div className="text-sm text-slate-500">Loading Draft One…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-prep-surface pb-24">
      <Toaster position="top-right" />

      <header className="sticky top-0 z-30 border-b border-prep-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-prep-accent text-white">
              <HiPencilSquare className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Draft One</div>
              <div className="text-xs text-slate-500">{callTitle || 'Proposal drafting'}</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full border border-prep-border bg-prep-surface px-3 py-1 text-xs font-medium text-prep-accent">
              {summary.passed}/{summary.draftable} sections pass agency rules
            </span>
            <button
              onClick={handleExport}
              disabled={exporting || running}
              className="flex items-center gap-1.5 rounded-lg bg-prep-accent px-4 py-2 text-sm font-medium text-white hover:bg-prep-accentDark disabled:opacity-50"
            >
              <HiArrowDownTray className="h-4 w-4" /> {exporting ? 'Checking gates…' : 'Export proposal'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6">
        {!draftingSessionId ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            The drafting engine hasn’t been initialized for this grant yet. Open the{' '}
            <button className="underline" onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/workspace?stage=BLUEPRINT`)}>
              blueprint
            </button>{' '}
            once — it self-heals the engine — then return here.
          </div>
        ) : null}

        {/* The Run */}
        <div className="rounded-2xl border border-prep-border bg-white p-5 shadow-prep-card">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Draft the proposal</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {summary.drafted}/{summary.draftable} AI sections drafted · {summary.withIssues} with rule issues ·{' '}
                {summary.manual} handled by your team outside AI drafting
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {running ? (
                <button
                  onClick={() => {
                    stopRequested.current = true
                    toast('Finishing the current section, then stopping.', { icon: '⏸' })
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Stop after this section
                </button>
              ) : (
                <button
                  onClick={handleRun}
                  disabled={!draftingSessionId || busySection !== null}
                  className="flex items-center gap-1.5 rounded-lg bg-prep-accent px-4 py-2 text-sm font-medium text-white hover:bg-prep-accentDark disabled:opacity-50"
                >
                  <HiPlay className="h-4 w-4" /> {summary.drafted ? 'Draft remaining sections' : 'Draft the proposal'}
                </button>
              )}
            </div>
          </div>
          {Object.keys(runStates).length ? (
            <div className="mt-4 flex flex-wrap gap-2">
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
                              ? 'border-slate-200 bg-slate-50 text-slate-500'
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

        {/* Sections + rail */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-5">
            {orderedSections.map((section) => {
              const words = countWords(section.content)
              const overBudget = section.wordBudget ? words > section.wordBudget : false
              const nearBudget = section.wordBudget ? !overBudget && words > section.wordBudget * 0.9 : false
              const isEditing = editingSection === section.sectionKey
              const busy = busySection === section.sectionKey || Boolean(runStates[section.sectionKey] && running)
              return (
                <section
                  key={section.sectionKey}
                  onFocus={() => setFocusedSection(section.sectionKey)}
                  onClick={() => setFocusedSection(section.sectionKey)}
                  className={clsx(
                    'rounded-2xl border bg-white shadow-prep-card',
                    focused?.sectionKey === section.sectionKey ? 'border-prep-accent/50' : 'border-prep-border'
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-slate-900">{section.label}</h3>
                    {section.required ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">required</span> : null}
                    {!section.autoDraftable ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">team handles</span>
                    ) : section.status === 'passed' ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">meets agency rules ✓</span>
                    ) : section.status === 'issues' ? (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">
                        {(section.compliance?.unmetRequiredPoints.length || 0) + (section.compliance?.violatedAvoidRules.length || 0) || section.compliance?.hardFailures.length || 1}{' '}
                        rule issue(s)
                      </span>
                    ) : section.status === 'stale' ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">stale — blueprint changed</span>
                    ) : section.status === 'unvalidated' && section.content ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">not yet validated</span>
                    ) : null}
                    <div className="ml-auto flex items-center gap-2">
                      {section.wordBudget ? (
                        <span
                          className={clsx(
                            'text-xs tabular-nums',
                            overBudget ? 'font-semibold text-rose-600' : nearBudget ? 'text-amber-600' : 'text-slate-400'
                          )}
                        >
                          {words} / {section.wordBudget} words
                        </span>
                      ) : section.content ? (
                        <span className="text-xs tabular-nums text-slate-400">{words} words</span>
                      ) : null}
                    </div>
                  </div>

                  {section.autoDraftable ? (
                    <div className="px-5 py-4">
                      {section.status === 'issues' && section.compliance ? (
                        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-900">
                          {section.compliance.unmetRequiredPoints.slice(0, 4).map((point) => (
                            <p key={point}>○ Missing required point: {point}</p>
                          ))}
                          {section.compliance.violatedAvoidRules.slice(0, 3).map((rule) => (
                            <p key={rule}>✕ Violates avoid-rule: {rule}</p>
                          ))}
                          {section.compliance.hardFailures.slice(0, 3).map((finding) => (
                            <p key={finding.key}>! {finding.message}</p>
                          ))}
                        </div>
                      ) : null}

                      {isEditing ? (
                        <>
                          <textarea
                            value={editorDrafts[section.sectionKey] ?? section.content}
                            onChange={(event) => setEditorDrafts((drafts) => ({ ...drafts, [section.sectionKey]: event.target.value }))}
                            rows={14}
                            className="w-full rounded-xl border border-slate-200 bg-prep-inputBg p-4 font-serif text-[15px] leading-relaxed text-slate-800 focus:border-prep-accent focus:outline-none"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => handleSaveEdit(section)}
                              disabled={busy}
                              className="rounded-lg bg-prep-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-prep-accentDark disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingSection(null)}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : section.content ? (
                        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-slate-800">
                          {section.content}
                        </div>
                      ) : (
                        <p className="text-sm italic text-slate-400">Not drafted yet — run the queue or draft this section alone.</p>
                      )}

                      {!isEditing ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => handleSingle(section)}
                            disabled={busy || running || !draftingSessionId}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          >
                            {section.content ? 'Regenerate' : 'Draft this section'}
                          </button>
                          {section.status === 'issues' ? (
                            <button
                              onClick={() => handleFixIssues(section)}
                              disabled={busy || running}
                              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-40"
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
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
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
                            className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-prep-accent focus:outline-none"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="px-5 py-3 text-xs text-slate-400">
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

          {/* Agency rail */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-2xl border border-prep-border bg-white p-4 shadow-prep-card">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agency rules — {focused?.label || 'select a section'}
              </h3>
              {focused?.ruleProfile ? (
                <div className="mt-3 space-y-3 text-xs">
                  {(
                    [
                      ['requiredPoints', 'Must cover', '○'],
                      ['avoidRules', 'Avoid', '✕'],
                      ['evaluationFocus', 'Scored on', '◆'],
                      ['reviewerSignals', 'Reviewers look for', '👁'],
                      ['formatConstraints', 'Format', '¶'],
                    ] as const
                  ).map(([field, label, mark]) => {
                    const rules = focused.ruleProfile?.[field] || []
                    if (!rules.length) return null
                    const covered = new Set(focused.compliance?.coveredRequiredPoints || [])
                    return (
                      <div key={field}>
                        <div className="font-medium text-slate-600">{label}</div>
                        <ul className="mt-1 space-y-1">
                          {rules.slice(0, 4).map((rule) => (
                            <li key={rule} className="flex items-start gap-1.5 text-slate-500">
                              <span className={clsx('flex-none', field === 'requiredPoints' && covered.has(rule) ? 'text-emerald-500' : 'text-slate-300')}>
                                {field === 'requiredPoints' && covered.has(rule) ? '●' : mark}
                              </span>
                              {rule}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">No routed rules for this section.</p>
              )}
              {focused?.readiness ? (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Reviewer readiness</div>
                  <div className="font-serif text-2xl text-prep-accent">{focused.readiness.score}<span className="text-sm text-slate-400">/100</span></div>
                  {focused.readiness.recommendedActions.slice(0, 2).map((action) => (
                    <p key={action} className="mt-1 text-[11px] text-slate-500">→ {action}</p>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </main>

      {/* Export gate modal */}
      {exportIssues ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setExportIssues(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-prep-float" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Not ready for final export</h3>
            <p className="mt-1 text-sm text-slate-500">The agency gates found {exportIssues.length} issue{exportIssues.length === 1 ? '' : 's'}:</p>
            <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
              {exportIssues.map((issue) => (
                <li key={issue} className="flex items-start gap-2 text-xs text-amber-800">
                  <HiExclamationTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-500" />
                  {issue}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={handleDraftExport}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Export draft anyway
              </button>
              <button
                onClick={() => setExportIssues(null)}
                className="rounded-lg bg-prep-accent px-4 py-2 text-sm font-medium text-white hover:bg-prep-accentDark"
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
