'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleDashed,
  Compass, FileSearch, Lightbulb, Loader2, RefreshCw, ShieldCheck, Sparkles, Zap,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import { GRANT_PREP_ENABLED } from '@/lib/access/killSwitches'
import { buildGrantPrepEntryUrl } from '@/lib/grants/workspaceNavigation'
import type { AgencyIpYield, PriorWork, PriorWorkRow } from '@/lib/ideaIntelligence/priorWork'
import CoverageMap from './CoverageMap'
import FunderDrawer from './FunderDrawer'
import GapList, { type GapDirection } from './GapList'
import PriorWorkList from './PriorWorkList'
import type { ProjectSearchItem } from './types'

type FacetStatus = 'PRESENT' | 'PARTIAL' | 'ABSENT' | 'UNASSESSED'
type FacetAssessment = { facet: string; status: FacetStatus; evidence: string; reason: string }
type ProjectAssessment = { projectId: string; summary: string; facetAssessments: FacetAssessment[] }

type RefinementCandidate = {
  id: string
  runId: string
  candidateIndex: number
  objective: string | null
  strategy: string
  title: string
  ideaText: string
  groundednessScore: number
  status: 'PROPOSED' | 'SELECTED' | 'DISMISSED'
  selectedVersionId: string | null
  createdAt: string
  payload: {
    strategy: string
    title: string
    ideaText: string
    facetChanges?: Array<{ facet: string; change: string; resultingFacet: string }>
    citations?: Array<{ sourceType: string; evidenceId: string; role: string; quote: string | null; quoteVerified: boolean }>
    expectedImpact?: { saturation?: string; whiteSpace?: string; rationale?: string }
    risks?: string[]
    rationale?: string
  }
}

type FundingCallMatch = {
  id: string
  agencyName: string
  schemeTitle: string
  shortDescription: string | null
  closeDate: string | null
  isRolling: boolean
  amountMin: number | null
  amountMax: number | null
  currency: string | null
  eligibilitySummary: string
  officialUrls: string[]
  score: number
  matchReasons: string[]
}

type CallAlignment = {
  fundingCallId: string
  role: 'anchored' | 'matched'
  alignment: number
  assessedFacets: number
  invitedFacets: string[]
  partialFacets: string[]
  outsideScopeFacets: string[]
  unassessedFacets: string[]
  callPriorities: string[]
  methodology: string
}

type CallFitEntry = {
  fundingCallId: string
  role: string
  fitSummary: string
  strengths: string[]
  concerns: string[]
  verifyBeforeApplying: string[]
}

type IdeaCallGap = {
  id: string
  kind: string
  severity: 'critical' | 'major' | 'minor'
  title: string
  detail: string
  evidence: Array<{ sourceType: string; evidenceId: string; quote: string | null }>
  fixSuggestion: string
  grantPrepStageKey: string | null
}

type IdeaReviewerPersona = {
  persona: string
  personaLabel: string
  overallStance: string
  objections: Array<{
    objection: string
    severity: 'critical' | 'major' | 'minor'
    basedOn: string
    preemption: string
    grantPrepStageKey: string | null
  }>
}

type PatentEvidence = {
  id: string
  title: string
  abstract: string | null
  publicationNumber: string | null
  assignee: string | null
  inventor: string | null
  priorityDate: string | null
  filingDate: string | null
  publicationDate: string | null
  url: string | null
  source: 'google_patents' | 'patentnest'
}

type AnalysisRun = {
  id: string
  versionNumber: number | null
  title: string
  ideaText: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  currentStage: number
  anchorFundingCallId?: string | null
  linkedGrantPrepSessionId?: string | null
  linkedProjectId?: string | null
  structuredIdea: null | { problem: string; approach: string; intendedUsers: string; domain: string; trl: number | null; facets: string[]; keywords: string[]; semanticQuery: string }
  retrievalResults: null | {
    projects: ProjectSearchItem[]
    fundingCalls: FundingCallMatch[]
    patents?: PatentEvidence[]
    evidenceDiagnostics?: { patentnestConfigured?: boolean; patentnestStatus?: string; patentnestError?: string; serpapiError?: string }
    sourcesUsed?: { projects?: boolean; publications?: boolean; patents?: boolean; web?: boolean; calls?: boolean }
    degradedMode: string | null
    query: string
  }
  analysis: null | { items: ProjectAssessment[]; strongestOverlap: string[]; whiteSpace: string[]; cautions: string[] }
  scores: null | {
    saturation: number
    whiteSpace: number
    evidenceProjects: number
    callAlignments?: CallAlignment[]
    priorWork?: PriorWork
    methodology: string
  }
  report: null | Record<string, unknown>
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  versions?: Array<{ id: string; versionNumber: number; title: string; runId: string | null; runStatus: string | null; refinementObjective: string | null; createdAt: string; scoreDelta?: Record<string, { previous: number | null; current: number | null; delta: number | null }> | null }>
  refinementCandidates?: RefinementCandidate[]
}

const STAGES = [
  ['Structure idea', 'Extracting specific, comparable aspects'],
  ['Search prior work', 'Finding funded awards and patents in this space'],
  ['Check relevance', 'Selecting the strongest evidence'],
  ['Compare aspect by aspect', 'Mapping what is already covered and what is not'],
  ['Map the funders', 'Building the funded-award ledger by agency'],
  ['Find the openings', 'Working out why each uncovered aspect is open'],
  ['Ready', 'Analysis complete'],
]

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700',
  major: 'border-amber-200 bg-amber-50 text-amber-700',
  minor: 'border-slate-200 bg-slate-50 text-slate-600',
}

const GAP_KIND_LABELS: Record<string, string> = {
  unaddressed_priority: 'Unaddressed call priority',
  missing_methodology: 'Missing methodology element',
  weak_differentiation: 'Weak differentiation',
  scale_mismatch: 'Scale mismatch',
  eligibility_risk: 'Eligibility risk',
  missing_evidence: 'Needs verification',
}

const STRATEGY_LABELS: Record<string, string> = {
  narrow_scope: 'Narrow scope',
  pivot_facet: 'Pivot facet',
  combine_white_space: 'Combine white-space',
  funder_align: 'Funder align',
  de_risk: 'De-risk',
}

function stageLabel(stageKey: string | null) {
  return stageKey ? stageKey.replace(/_/g, ' ') : null
}

function asString(value: unknown) { return typeof value === 'string' ? value : '' }
function asStrings(value: unknown) { return Array.isArray(value) ? value.map(asString).filter(Boolean) : [] }

function reportDirections(report: Record<string, unknown> | null): GapDirection[] {
  return Array.isArray((report as any)?.whitespaceDirections) ? (report as any).whitespaceDirections : []
}

/**
 * Runs made before the prior-work pass existed have no merged list stored. Show
 * their retrieved awards rather than an empty screen — with no coverage map or
 * gap readings, which those runs genuinely never computed.
 */
function fallbackPriorWork(run: AnalysisRun): PriorWork {
  const rows: PriorWorkRow[] = (run.retrievalResults?.projects || []).map((project) => ({
    key: `legacy:${project.id}`,
    kind: 'funded' as const,
    title: project.title,
    org: project.primaryInstitutionName,
    year: project.sanctionYear,
    facetsCovered: [],
    matchBasis: 'Retrieved for this idea before aspect-level coverage was recorded.',
    award: {
      id: project.id,
      abstract: project.abstractText && project.abstractText.toUpperCase() !== 'NA' ? project.abstractText : null,
      agencyName: project.fundingAgency || project.sourceKey,
      schemeName: project.schemeName,
      budgetAmount: project.budgetAmount,
      budgetCurrency: project.budgetCurrency,
      durationMonths: null,
      status: 'unknown' as const,
      hasReportedOutput: false,
      patentCount: 0,
      publicationCount: 0,
      relevanceScore: project.relevanceScore,
      duplicateIds: [],
    },
    patent: null,
  }))
  return {
    rows,
    coverage: [],
    gaps: [],
    agencyIpYield: [],
    crossHolders: [],
    summary: {
      totalRows: rows.length,
      fundedRows: rows.length,
      patentedRows: 0,
      duplicateAwardsCollapsed: 0,
      patentFamiliesCollapsed: 0,
    },
  }
}

function ProgressPanel({ run }: { run: AnalysisRun }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Analysis progress</h2>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working</span>
      </div>
      <div className="mt-6 space-y-1">
        {STAGES.map(([title, description], index) => {
          const complete = index < run.currentStage
          const active = index === run.currentStage
          return (
            <div key={title} className={`flex gap-3 rounded-xl p-3 ${active ? 'bg-teal-50' : ''}`}>
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${complete ? 'border-teal-700 bg-teal-700 text-white' : active ? 'border-teal-500 bg-white text-teal-700' : 'border-slate-200 bg-white text-slate-300'}`}>
                {complete ? <Check className="h-3.5 w-3.5" /> : active ? <CircleDashed className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[10px] font-bold">{index + 1}</span>}
              </div>
              <div>
                <p className={`text-sm font-semibold ${active ? 'text-teal-900' : complete ? 'text-slate-700' : 'text-slate-400'}`}>{title}</p>
                {active ? <p className="mt-0.5 text-xs text-teal-700">{description}</p> : null}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">You can leave this page. Completed stages are saved and a failed run can be retried.</p>
    </div>
  )
}

function ImpactPill({ label, value, goodDirection }: { label: string; value?: string; goodDirection: 'up' | 'down' }) {
  const direction = value || 'flat'
  const positive = direction === goodDirection
  const tone = direction === 'flat' ? 'bg-slate-50 text-slate-600' : positive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
  return <span className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tone}`}>{label}: {direction}</span>
}

function RefinementPanel({ run, token, strengthenGap, onStrengthenHandled }: {
  run: AnalysisRun
  token: string | null
  strengthenGap?: { id: string; title: string } | null
  onStrengthenHandled?: () => void
}) {
  const router = useRouter()
  const [objective, setObjective] = useState<'maximize_white_space' | 'target_funder' | 'reduce_risk'>('maximize_white_space')
  const [instructions, setInstructions] = useState('')
  const [candidates, setCandidates] = useState<RefinementCandidate[]>(run.refinementCandidates || [])
  const [generating, setGenerating] = useState(false)
  const [activeGap, setActiveGap] = useState<{ id: string; title: string } | null>(null)
  const [submittingCandidateId, setSubmittingCandidateId] = useState<string | null>(null)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null)
  const [editedIdeaText, setEditedIdeaText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCandidates(run.refinementCandidates || [])
    setEditingCandidateId(null)
    setExpandedCandidateId(null)
    setEditedIdeaText('')
  }, [run.id, run.refinementCandidates])

  const proposeCandidates = async (targetGap?: { id: string; title: string } | null) => {
    if (!token || generating) return
    setGenerating(true)
    setError(null)
    setActiveGap(targetGap || null)
    try {
      const response = await fetch(`/api/idea-intelligence/${run.id}/refine/candidates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: targetGap ? 'target_funder' : objective,
          instructions,
          targetGapId: targetGap?.id,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to generate refinement candidates')
      setCandidates(body.candidates || [])
      setEditingCandidateId(null)
      setExpandedCandidateId(body.candidates?.[0]?.id || null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to generate refinement candidates')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    if (!strengthenGap) return
    setObjective('target_funder')
    void proposeCandidates(strengthenGap)
    onStrengthenHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strengthenGap])

  const startEditing = (candidate: RefinementCandidate) => {
    setEditingCandidateId(candidate.id)
    setExpandedCandidateId(candidate.id)
    setEditedIdeaText(candidate.payload?.ideaText || candidate.ideaText)
  }

  const submitCandidate = async (candidate: RefinementCandidate) => {
    if (!token || submittingCandidateId) return
    setSubmittingCandidateId(candidate.id)
    setError(null)
    try {
      const response = await fetch(`/api/idea-intelligence/${run.id}/refine`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          objective: candidate.objective || objective,
          editedIdeaText: editingCandidateId === candidate.id ? editedIdeaText : undefined,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to create refined version')
      router.push(`/funding/intelligence/idea/${body.run.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create refined version')
    } finally {
      setSubmittingCandidateId(null)
    }
  }

  return (
    <section id="refinement-panel" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">Refine and re-run</h2>
          <p className="mt-1 text-sm text-slate-500">Create a new version from this evidence view, then run the pipeline again.</p>
          {run.versionNumber ? <p className="mt-2 text-xs font-semibold text-slate-500">Current version: v{run.versionNumber}</p> : null}
          {activeGap ? <p className="mt-2 rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800">Candidates target: {activeGap.title}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {run.versions?.filter((version) => version.runId).map((version) => (
            <Link key={version.id} href={`/funding/intelligence/idea/${version.runId}`} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${version.runId === run.id ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              v{version.versionNumber}
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_auto]">
        <select value={objective} onChange={(event) => setObjective(event.target.value as typeof objective)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700">
          <option value="maximize_white_space">Maximize white space</option>
          <option value="target_funder">Target funder fit</option>
          <option value="reduce_risk">Reduce reviewer risk</option>
        </select>
        <input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional refinement instruction" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500" />
        <button type="button" onClick={() => proposeCandidates()} disabled={generating} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Propose refinements
        </button>
      </div>
      {candidates.length ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          {candidates.map((candidate) => {
            const payload = candidate.payload || {}
            const expanded = expandedCandidateId === candidate.id
            const editing = editingCandidateId === candidate.id
            const citations = payload.citations || []
            const verifiedCount = citations.filter((citation) => citation.quoteVerified).length
            const disabled = candidate.status !== 'PROPOSED'
            return (
              <article key={candidate.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${candidate.status === 'SELECTED' ? 'border-emerald-200' : 'border-slate-200'} ${candidate.status === 'DISMISSED' ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700">{STRATEGY_LABELS[candidate.strategy] || candidate.strategy.replace(/_/g, ' ')}</span>
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{Math.round((candidate.groundednessScore || 0) * 100)}% grounded</span>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-6 text-slate-900">{candidate.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{payload.rationale || 'Evidence-aware refinement direction.'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ImpactPill label="Overlap" value={payload.expectedImpact?.saturation} goodDirection="down" />
                  <ImpactPill label="White space" value={payload.expectedImpact?.whiteSpace} goodDirection="up" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                  <span className="rounded-lg bg-slate-50 px-2 py-1">{citations.length} evidence links</span>
                  <span className="rounded-lg bg-slate-50 px-2 py-1">{verifiedCount} verified quotes</span>
                </div>
                {expanded ? (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    {citations.length ? (
                      <div>
                        <p className="text-xs font-semibold text-slate-500">Evidence citations</p>
                        <div className="mt-2 space-y-2">
                          {citations.slice(0, 4).map((citation, index) => (
                            <div key={`${citation.evidenceId}-${index}`} className="rounded-xl border border-slate-100 p-3 text-xs leading-5 text-slate-600">
                              <span className="font-semibold text-teal-700">{citation.sourceType.replace(/_/g, ' ')}</span> - {citation.role.replace(/_/g, ' ')}
                              {citation.quote ? <p className="mt-1 text-slate-500">&quot;{citation.quote}&quot;</p> : <p className="mt-1 text-slate-400">Linked to retrieved evidence; no verified quote supplied.</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {editing ? (
                      <div>
                        <label className="text-xs font-semibold text-slate-500">Edit refined idea before rerun</label>
                        <textarea value={editedIdeaText} onChange={(event) => setEditedIdeaText(event.target.value)} rows={7} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-teal-500" />
                        <button type="button" onClick={() => submitCandidate(candidate)} disabled={Boolean(submittingCandidateId) || editedIdeaText.trim().length < 50} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300">
                          {submittingCandidateId === candidate.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                          Create v{(run.versionNumber || run.versions?.length || 1) + 1}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setExpandedCandidateId(expanded ? null : candidate.id)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{expanded ? 'Collapse' : 'Inspect'}</button>
                  <button type="button" onClick={() => startEditing(candidate)} disabled={disabled} className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400">Use this direction</button>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs font-semibold text-rose-700">{error}</p> : null}
    </section>
  )
}

/** Shown only once the researcher has committed to a call. */
function CallVerdictSections({ run, onStrengthen, strengthenBusyId }: {
  run: AnalysisRun
  onStrengthen: (gap: IdeaCallGap) => void
  strengthenBusyId: string | null
}) {
  const alignments = run.scores?.callAlignments || []
  const gaps = Array.isArray((run.report as any)?.callGaps) ? ((run.report as any).callGaps as IdeaCallGap[]) : []
  const panel = Array.isArray((run.report as any)?.reviewerPanel) ? ((run.report as any).reviewerPanel as IdeaReviewerPersona[]) : []
  if (!alignments.length && !gaps.length && !panel.length) return null

  const callById = new Map((run.retrievalResults?.fundingCalls || []).map((call) => [call.id, call]))
  const callFitById = new Map(
    (Array.isArray((run.report as any)?.callFit) ? ((run.report as any).callFit as CallFitEntry[]) : []).map((entry) => [entry.fundingCallId, entry])
  )
  const targetCallId = (run.report as any)?.targetFundingCallId || null
  const targetCall = callById.get(targetCallId) || null

  return (
    <section className="mt-8 rounded-2xl border-2 border-teal-100 bg-teal-50/30 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Check className="h-5 w-5 text-teal-700" />
        <h2 className="text-lg font-semibold text-slate-900">
          Your idea against {targetCall ? targetCall.schemeTitle : 'the call you picked'}
        </h2>
      </div>

      {alignments.length ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {alignments.map((alignment) => {
            const call = callById.get(alignment.fundingCallId)
            const fit = callFitById.get(alignment.fundingCallId)
            return (
              <article key={alignment.fundingCallId} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{call?.agencyName || 'Funding call'}</span>
                    <h3 className="mt-1 text-base font-semibold leading-6 text-slate-900">{call?.schemeTitle || alignment.fundingCallId}</h3>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${alignment.alignment >= 60 ? 'bg-emerald-50 text-emerald-700' : alignment.alignment >= 30 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{alignment.alignment}% aligned</span>
                </div>
                {fit?.fitSummary ? <p className="mt-3 text-sm leading-6 text-slate-600">{fit.fitSummary}</p> : null}
                <div className="mt-3 space-y-1.5 text-xs">
                  {alignment.invitedFacets.length ? <p><span className="font-bold text-emerald-700">Invited:</span> <span className="text-slate-600">{alignment.invitedFacets.join(' · ')}</span></p> : null}
                  {alignment.partialFacets.length ? <p><span className="font-bold text-amber-700">Related:</span> <span className="text-slate-600">{alignment.partialFacets.join(' · ')}</span></p> : null}
                  {alignment.outsideScopeFacets.length ? <p><span className="font-bold text-rose-700">Possibly out of scope:</span> <span className="text-slate-600">{alignment.outsideScopeFacets.join(' · ')}</span></p> : null}
                </div>
                {fit?.verifyBeforeApplying?.length ? (
                  <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800">Verify before applying</p>
                    <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-800">{fit.verifyBeforeApplying.slice(0, 4).map((item) => <li key={item}>- {item}</li>)}</ul>
                  </div>
                ) : null}
                <Link href={`/finder/calls/${alignment.fundingCallId}`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">Open call <ArrowRight className="h-3.5 w-3.5" /></Link>
              </article>
            )
          })}
        </div>
      ) : null}

      {gaps.length ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900">What to fix before applying</h3>
          <div className="mt-3 space-y-3">
            {gaps.map((gap) => (
              <article key={gap.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${SEVERITY_STYLES[gap.severity] || SEVERITY_STYLES.minor}`}>{gap.severity}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{GAP_KIND_LABELS[gap.kind] || gap.kind.replace(/_/g, ' ')}</span>
                      {gap.grantPrepStageKey ? <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold capitalize text-teal-700">Fix in: {stageLabel(gap.grantPrepStageKey)}</span> : null}
                    </div>
                    <h4 className="mt-2 font-semibold leading-6 text-slate-900">{gap.title}</h4>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{gap.detail}</p>
                    {gap.fixSuggestion ? <p className="mt-2 text-sm leading-6 text-slate-700"><span className="font-semibold text-teal-800">Suggested fix:</span> {gap.fixSuggestion}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onStrengthen(gap)}
                    disabled={Boolean(strengthenBusyId)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {strengthenBusyId === gap.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Strengthen this
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {panel.length ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900">How a review panel would attack it</h3>
          <div className="mt-3 grid gap-4 xl:grid-cols-3">
            {panel.map((persona) => (
              <article key={persona.persona} className="rounded-2xl border border-slate-200 p-4">
                <h4 className="font-semibold text-slate-900">{persona.personaLabel}</h4>
                {persona.overallStance ? <p className="mt-1 text-xs leading-5 text-slate-500">{persona.overallStance}</p> : null}
                <div className="mt-3 space-y-3">
                  {persona.objections.map((objection, index) => (
                    <div key={`${persona.persona}-${index}`} className="rounded-xl bg-slate-50 p-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_STYLES[objection.severity] || SEVERITY_STYLES.minor}`}>{objection.severity}</span>
                      <p className="mt-2 text-sm font-medium leading-6 text-slate-800">&quot;{objection.objection}&quot;</p>
                      {objection.preemption ? <p className="mt-1.5 text-xs leading-5 text-slate-600"><span className="font-semibold text-emerald-700">Pre-empt:</span> {objection.preemption}</p> : null}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default function IdeaAnalysisWorkspace({ runId }: { runId: string }) {
  const { token, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [run, setRun] = useState<AnalysisRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [exportingIdea, setExportingIdea] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [strengthenGap, setStrengthenGap] = useState<{ id: string; title: string } | null>(null)
  const [strengthenBusyId, setStrengthenBusyId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTitle, setDrawerTitle] = useState<string | null>(null)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const executeStarted = useRef(false)

  const loadRun = useCallback(async () => {
    if (!token) return
    try {
      const response = await fetch(`/api/idea-intelligence/${runId}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to load analysis')
      setRun(body.run)
      setRequestError(null)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Failed to load analysis')
    } finally {
      setLoading(false)
    }
  }, [runId, token])

  const execute = useCallback(async () => {
    if (!token || executeStarted.current) return
    executeStarted.current = true
    try {
      const response = await fetch(`/api/idea-intelligence/${runId}/execute`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Analysis failed')
      setRun(body.run)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Analysis failed')
      await loadRun()
    }
  }, [loadRun, runId, token])

  useEffect(() => { void loadRun() }, [loadRun])
  useEffect(() => {
    const staleProcessingRun = run?.status === 'PROCESSING' && new Date(run.updatedAt).getTime() < Date.now() - 10 * 60 * 1000
    if (run?.status === 'PENDING' || staleProcessingRun) void execute()
  }, [execute, run?.status, run?.updatedAt])
  useEffect(() => {
    if (run?.status !== 'PROCESSING' && run?.status !== 'PENDING') return
    const timer = window.setInterval(() => void loadRun(), 2000)
    return () => window.clearInterval(timer)
  }, [loadRun, run?.status])

  const retry = () => { executeStarted.current = false; setRequestError(null); void execute() }
  const targetCallId: string | null = (run?.report as any)?.targetFundingCallId || run?.anchorFundingCallId || null
  const patentsSearched = Boolean(run?.retrievalResults?.sourcesUsed?.patents ?? run?.retrievalResults?.patents?.length)

  const priorWork = useMemo<PriorWork | null>(() => {
    if (!run || run.status !== 'COMPLETED') return null
    return run.scores?.priorWork || fallbackPriorWork(run)
  }, [run])

  const directions = useMemo(() => reportDirections(run?.report || null), [run?.report])

  const openFunders = (title: string | null) => {
    setDrawerTitle(title)
    setDrawerOpen(true)
  }

  const strengthen = (gap: { id: string; title: string }) => {
    setStrengthenBusyId(gap.id)
    setStrengthenGap(gap)
    document.getElementById('refinement-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const startGrantPrep = async () => {
    if (!token || !run || handoffBusy) return
    if (run.linkedGrantPrepSessionId && run.linkedProjectId) {
      router.push(buildGrantPrepEntryUrl({ projectId: run.linkedProjectId, grantOrPrepSessionId: run.linkedGrantPrepSessionId }))
      return
    }
    if (!targetCallId) {
      setHandoffError('Pick a call first — Grant Prep needs a call to prepare against.')
      openFunders(null)
      return
    }
    setHandoffBusy(true)
    setHandoffError(null)
    try {
      const response = await fetch(`/api/idea-intelligence/${run.id}/grant-prep-handoff`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundingCallId: targetCallId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to start Grant Prep from this analysis')
      const destination = body.handoff?.launchUrl || body.handoff?.prepUrl
      if (!destination) throw new Error('Grant Prep was created but no workspace URL was returned.')
      router.push(destination)
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : 'Failed to start Grant Prep from this analysis')
      setHandoffBusy(false)
    }
  }

  const exportToIdeaBank = async () => {
    if (!token || !run || run.status !== 'COMPLETED') return
    setExportingIdea(true)
    setExportMessage(null)
    try {
      const report = run.report || {}
      const domainTag = run.structuredIdea?.domain || run.structuredIdea?.keywords?.[0] || 'Funding intelligence'
      const response = await fetch('/api/idea-bank', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: run.title,
          description: run.ideaText,
          abstract: [asString(report.headline), asString(report.alreadyDoneSummary)].filter(Boolean).join('\n\n'),
          domainTags: [domainTag],
          technicalField: run.structuredIdea?.domain || undefined,
          keyFeatures: directions.map((direction) => direction.stillMissing).filter(Boolean).slice(0, 6),
          potentialApplications: directions.map((direction) => direction.example?.projectIdea).filter(Boolean).concat(asStrings(report.nextSteps)).slice(0, 6),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.details || body.error || 'Failed to export idea')
      setExportMessage('Exported to Idea Bank.')
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Failed to export idea')
    } finally {
      setExportingIdea(false)
    }
  }

  if (authLoading || loading) return <div className="flex min-h-[70vh] items-center justify-center bg-[#f6f8f7]"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>
  if (!run) return <div className="mx-auto max-w-3xl p-8"><Link href="/funding/intelligence" className="text-sm font-semibold text-teal-700">Back to landscape</Link><div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{requestError || 'Analysis not found'}</div></div>

  const processing = run.status === 'PENDING' || run.status === 'PROCESSING'
  const crossHolders = priorWork?.crossHolders || []

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/funding/intelligence" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal-800"><ArrowLeft className="h-4 w-4" /> Landscape</Link>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${run.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700' : run.status === 'FAILED' ? 'bg-rose-50 text-rose-700' : 'bg-teal-50 text-teal-700'}`}>{run.status === 'PROCESSING' ? 'ANALYZING' : run.status}</span>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-8 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-4xl">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-teal-700"><Sparkles className="h-4 w-4" /> Idea intelligence</div>
              <h1 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">{run.title}</h1>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">{run.ideaText}</p>
              {run.structuredIdea?.facets?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {run.structuredIdea.facets.map((facet) => (
                    <span key={facet} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{facet}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {run.status === 'COMPLETED' ? (
                <button type="button" onClick={() => openFunders(null)} className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900">
                  <Compass className="h-4 w-4" /> Who funds this idea?
                </button>
              ) : null}
              {run.status === 'COMPLETED' ? (
                <Link href="/funding/intelligence/idea/new" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"><Zap className="h-4 w-4 text-teal-700" /> Analyze another</Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {processing ? (
          <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <ProgressPanel run={run} />
            <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
              <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center">
                <div className="relative">
                  <div className="absolute inset-0 animate-ping rounded-full bg-teal-100" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-teal-50"><FileSearch className="h-7 w-7 text-teal-700" /></div>
                </div>
                <h2 className="mt-6 text-xl font-semibold">{STAGES[run.currentStage]?.[0] || 'Analyzing evidence'}</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{STAGES[run.currentStage]?.[1] || 'Building your evidence-grounded view.'}</p>
              </div>
            </div>
          </div>
        ) : null}

        {run.status === 'FAILED' ? (
          <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-7 text-center shadow-sm">
            <AlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
            <h2 className="mt-4 text-xl font-semibold">Analysis paused</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{run.errorMessage || requestError || 'A provider failed while processing this run.'}</p>
            <button type="button" onClick={retry} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" /> Retry from saved progress</button>
          </div>
        ) : null}

        {run.status === 'COMPLETED' && priorWork ? (
          <>
            {run.retrievalResults?.degradedMode ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Semantic retrieval was unavailable for this run; award evidence came from keyword matching only. Judge the list below with that in mind.
              </div>
            ) : null}

            <PriorWorkList rows={priorWork.rows} summary={priorWork.summary} />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-sm text-slate-600">
              <span>Need more patents than the landscape pulled in? Search the PatentNest corpus with this idea and save the ones worth citing.</span>
              <Link
                href={`/funding/intelligence/patents?q=${encodeURIComponent((run.structuredIdea?.semanticQuery || run.title).slice(0, 2000))}&runId=${encodeURIComponent(run.id)}`}
                className="inline-flex items-center gap-1.5 font-semibold text-indigo-700 hover:underline"
              >
                <FileSearch className="h-4 w-4" /> Search related patents
              </Link>
            </div>

            <CoverageMap coverage={priorWork.coverage} rows={priorWork.rows} patentsSearched={patentsSearched} />

            {crossHolders.length ? (
              <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
                <h2 className="font-semibold text-slate-900">Holding both an award and a patent here</h2>
                <p className="mt-1 text-sm text-slate-600">
                  These organisations appear in both corpora — your closest competition, and the most credible
                  collaborators. This says the organisation appears in both, not that a particular patent came from a
                  particular award.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {crossHolders.slice(0, 6).map((holder) => (
                    <span key={holder.org} className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      {holder.org}
                      <span className="ml-1.5 font-normal text-slate-500">
                        {holder.awardRowKeys.length} award{holder.awardRowKeys.length === 1 ? '' : 's'} · {holder.patentRowKeys.length} patent{holder.patentRowKeys.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <GapList
              directions={directions}
              rows={priorWork.rows}
              onFindFunders={(direction) => openFunders(direction.title)}
            />

            <CallVerdictSections
              run={run}
              onStrengthen={(gap) => strengthen({ id: gap.id, title: gap.title })}
              strengthenBusyId={strengthenBusyId}
            />

            {asStrings(run.report?.nextSteps).length ? (
              <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-sky-700" /><h2 className="font-semibold text-slate-900">Do these next</h2></div>
                <ul className="mt-4 space-y-3">
                  {asStrings(run.report?.nextSteps).slice(0, 3).map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-600">
                      <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{index + 1}</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-900">Continue from this analysis</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {!GRANT_PREP_ENABLED
                      ? 'Save the idea to your Idea Bank so the evidence and openings stay with it.'
                      : run.linkedGrantPrepSessionId
                        ? 'This idea has already been handed off to Grant Prep — continue where you left off.'
                        : targetCallId
                          ? 'Start Grant Prep with this idea locked in: the evidence and openings carry over with it.'
                          : 'Save the idea for later. Grant Prep needs a call — pick one from "Who funds this" first.'}
                  </p>
                  {exportMessage ? <p className="mt-2 text-xs font-semibold text-teal-700">{exportMessage}</p> : null}
                  {handoffError ? <p className="mt-2 text-xs font-semibold text-rose-700">{handoffError}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={exportToIdeaBank} disabled={exportingIdea} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                    {exportingIdea ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                    Export to Idea Bank
                  </button>
                  {GRANT_PREP_ENABLED ? (
                    <button type="button" onClick={startGrantPrep} disabled={handoffBusy} className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300">
                      {handoffBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {run.linkedGrantPrepSessionId ? 'Continue in Grant Prep' : 'Start Grant Prep'} <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <RefinementPanel
              run={run}
              token={token}
              strengthenGap={strengthenGap}
              onStrengthenHandled={() => { setStrengthenGap(null); setStrengthenBusyId(null) }}
            />

            <details className="group mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
                <div>
                  <h2 className="font-semibold text-slate-900">How this was worked out</h2>
                  <p className="mt-1 text-sm text-slate-500">Method, corpora searched, and what this analysis cannot tell you.</p>
                </div>
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-slate-100 p-5 text-sm leading-6 text-slate-600">
                <p>
                  <span className="font-semibold text-slate-800">Corpora searched:</span> sanctioned awards
                  {patentsSearched ? ', patents (Google Patents and PatentNest)' : ' only — no patent check ran for this run'}.
                  {run.retrievalResults?.evidenceDiagnostics?.patentnestConfigured === false
                    ? ' PatentNest is not configured, so Indian patents were not covered.'
                    : ''}
                </p>
                <p><span className="font-semibold text-slate-800">Coverage:</span> {run.scores?.methodology}</p>
                <div className="flex gap-3 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" />
                  <p>{asString(run.report?.evidenceDisclaimer) || 'This describes what the retrieved records show and do not show. It is not a prediction of funding success.'}</p>
                </div>
              </div>
            </details>
          </>
        ) : null}
      </div>

      <FunderDrawer
        runId={run.id}
        token={token}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        forTitle={drawerTitle}
        selectedCallId={targetCallId}
        agencyIpYield={(priorWork?.agencyIpYield || []) as AgencyIpYield[]}
        onCallEvaluated={loadRun}
      />
    </main>
  )
}
