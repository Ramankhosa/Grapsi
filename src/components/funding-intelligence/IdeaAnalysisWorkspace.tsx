'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown,
  CircleDashed, Clock3, ExternalLink, FileSearch, Landmark, Lightbulb, Loader2,
  RefreshCw, ShieldCheck, Sparkles, Target, TrendingUp, Zap,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import { buildGrantPrepEntryUrl } from '@/lib/grants/workspaceNavigation'
import type { ProjectSearchItem } from './types'

type FacetStatus = 'PRESENT' | 'PARTIAL' | 'ABSENT' | 'UNASSESSED'
type FacetAssessment = { facet: string; status: FacetStatus; evidence: string; reason: string }
type ProjectAssessment = { projectId: string; summary: string; facetAssessments: FacetAssessment[] }
type CrossCorpusFacetSignal = {
  facet: string
  funded: FacetStatus
  published: FacetStatus
  patented: FacetStatus
  web: FacetStatus
  signal: string
  rationale: string
}

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
    expectedImpact?: { saturation?: string; whiteSpace?: string; rationale?: string; modelSaturation?: string; modelWhiteSpace?: string }
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

type FundingCallFacetAssessment = {
  fundingCallId: string
  role: 'anchored' | 'matched'
  summary: string
  callPriorities: string[]
  facetAssessments: FacetAssessment[]
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

type PublicationEvidence = {
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  doi: string | null
  url: string | null
  citationCount: number | null
  source: string
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

type WebEvidence = {
  id: string
  title: string
  snippet: string | null
  url: string | null
  source: string
  date: string | null
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
    anchoredCall?: (FundingCallMatch & { description?: string | null; eligibilityText?: string | null }) | null
    publications?: PublicationEvidence[]
    patents?: PatentEvidence[]
    webResults?: WebEvidence[]
    evidenceDiagnostics?: { patentnestConfigured?: boolean; patentnestStatus?: string; patentnestError?: string; serpapiError?: string }
    degradedMode: string | null
    query: string
  }
  analysis: null | { items: ProjectAssessment[]; callItems?: FundingCallFacetAssessment[]; strongestOverlap: string[]; whiteSpace: string[]; cautions: string[] }
  scores: null | {
    landscapePositioning: number
    saturation: number
    whiteSpace: number
    momentum: number
    evidenceConfidence: number
    evidenceProjects: number
    evidencePublications?: number
    evidencePatents?: number
    evidenceWeb?: number
    crossCorpusFacets?: CrossCorpusFacetSignal[]
    callAlignments?: CallAlignment[]
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
  ['Structure idea', 'Extracting specific, comparable facets'],
  ['Search evidence', 'Finding related funded projects and calls'],
  ['Check relevance', 'Selecting the strongest evidence'],
  ['Compare facets', 'Mapping overlap, differentiation, and call fit'],
  ['Calculate signals', 'Computing transparent landscape measures'],
  ['Build brief', 'Writing recommendations, gap report, and reviewer panel'],
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

function stageLabel(stageKey: string | null) {
  return stageKey ? stageKey.replace(/_/g, ' ') : null
}

const STATUS_STYLES: Record<FacetStatus, string> = {
  PRESENT: 'border-rose-200 bg-rose-50 text-rose-700',
  PARTIAL: 'border-amber-200 bg-amber-50 text-amber-700',
  ABSENT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  UNASSESSED: 'border-slate-200 bg-slate-50 text-slate-500',
}

function asString(value: unknown) { return typeof value === 'string' ? value : '' }
function asStrings(value: unknown) { return Array.isArray(value) ? value.map(asString).filter(Boolean) : [] }

function formatMoney(value: number | null, currency = 'INR') {
  if (value === null) return null
  if (currency === 'INR') {
    if (value >= 10_000_000) return `Rs ${(value / 10_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Cr`
    if (value >= 100_000) return `Rs ${(value / 100_000).toFixed(value >= 1_000_000 ? 0 : 1)} L`
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

function formatFundingRange(call: FundingCallMatch) {
  const currency = call.currency || 'INR'
  const min = formatMoney(call.amountMin, currency)
  const max = formatMoney(call.amountMax, currency)
  if (min && max) return min === max ? min : `${min} - ${max}`
  return min || max
}

function FacetLegend() {
  return (
    <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <span className="font-semibold text-slate-700">Facet legend:</span>
      <span><span className="font-bold text-rose-700">PRESENT</span> means existing overlap.</span>
      <span><span className="font-bold text-emerald-700">ABSENT</span> means possible white space.</span>
      <span><span className="font-bold text-amber-700">PARTIAL</span> means mixed evidence.</span>
      <span><span className="font-bold text-slate-500">UNASSESSED</span> means source evidence is insufficient.</span>
    </div>
  )
}

function SignalCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Target; tone: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label}</span><Icon className={`h-4 w-4 ${tone}`} /></div><div className="mt-2 flex items-end gap-1"><span className="text-2xl font-semibold text-slate-900">{value}</span><span className="mb-1 text-xs text-slate-400">/100</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone.replace('text-', 'bg-')}`} style={{ width: `${value}%` }} /></div></div>
}

function CrossCorpusTable({ rows }: { rows: CrossCorpusFacetSignal[] }) {
  if (!rows.length) return null
  const sourceColumns = [
    ['funded', 'Funded'],
    ['published', 'Published'],
    ['patented', 'Patented'],
    ['web', 'Web'],
  ] as const
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Cross-corpus triangulation</h2>
          <p className="mt-1 text-sm text-slate-500">Facet-level signal across funded projects, publications, patents, and web evidence.</p>
        </div>
        <p className="text-xs text-slate-500">Rose = overlap, emerald = potential white space, amber = partial, slate = insufficient evidence.</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="pb-2 pr-4 font-semibold">Facet</th>{sourceColumns.map(([, label]) => <th key={label} className="pb-2 pr-3 font-semibold">{label}</th>)}<th className="pb-2 font-semibold">Signal</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.facet} className="border-b border-slate-100 last:border-0"><td className="py-3 pr-4 font-medium text-slate-800">{row.facet}</td>{sourceColumns.map(([key]) => <td key={key} className="py-3 pr-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_STYLES[row[key]]}`}>{row[key]}</span></td>)}<td className="py-3"><p className="font-semibold capitalize text-slate-800">{row.signal.replace(/_/g, ' ')}</p><p className="mt-1 text-xs leading-5 text-slate-500">{row.rationale}</p></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}

function ProgressPanel({ run }: { run: AnalysisRun }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">Analysis progress</h2><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working</span></div>
      <div className="mt-6 space-y-1">
        {STAGES.map(([title, description], index) => {
          const complete = index < run.currentStage
          const active = index === run.currentStage
          return <div key={title} className={`flex gap-3 rounded-xl p-3 ${active ? 'bg-teal-50' : ''}`}><div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${complete ? 'border-teal-700 bg-teal-700 text-white' : active ? 'border-teal-500 bg-white text-teal-700' : 'border-slate-200 bg-white text-slate-300'}`}>{complete ? <Check className="h-3.5 w-3.5" /> : active ? <CircleDashed className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[10px] font-bold">{index + 1}</span>}</div><div><p className={`text-sm font-semibold ${active ? 'text-teal-900' : complete ? 'text-slate-700' : 'text-slate-400'}`}>{title}</p>{active ? <p className="mt-0.5 text-xs text-teal-700">{description}</p> : null}</div></div>
        })}
      </div>
      <p className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">You can leave this page. Completed stages are saved and a failed run can be retried.</p>
    </div>
  )
}

function displayFundingSource(project: Pick<ProjectSearchItem, 'fundingAgency' | 'sourceKey'>) {
  return project.fundingAgency || project.sourceKey
}

function EvidenceRow({ project, assessment }: { project: ProjectSearchItem; assessment?: ProjectAssessment }) {
  const [open, setOpen] = useState(false)
  const fundingSource = displayFundingSource(project)
  return (
    <article className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-start gap-4 p-5 text-left">
        <span className="mt-0.5 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700">{fundingSource}</span>
        <div className="min-w-0 flex-1"><h3 className="font-semibold leading-6 text-slate-900">{project.title}</h3><p className="mt-1 text-xs text-slate-500">{[project.primaryInstitutionName, project.sanctionYear, project.schemeName].filter(Boolean).join(' · ')}</p></div>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="border-t border-slate-100 p-5"><p className="text-sm leading-6 text-slate-600">{assessment?.summary || project.abstractText || 'Detailed comparison evidence is unavailable.'}</p>{assessment?.facetAssessments.length ? <div className="mt-5"><FacetLegend /><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="pb-2 pr-4 font-semibold">Idea facet</th><th className="pb-2 pr-4 font-semibold">Assessment</th><th className="pb-2 font-semibold">Evidence</th></tr></thead><tbody>{assessment.facetAssessments.map((facet) => <tr key={facet.facet} className="border-b border-slate-100 last:border-0"><td className="py-3 pr-4 font-medium text-slate-800">{facet.facet}</td><td className="py-3 pr-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${STATUS_STYLES[facet.status]}`}>{facet.status}</span></td><td className="py-3 text-xs leading-5 text-slate-500">{facet.evidence || facet.reason || 'Not enough source evidence'}</td></tr>)}</tbody></table></div></div> : null}<Link href={`/funding/intelligence/projects/${project.id}`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">Open full project evidence <ArrowRight className="h-3.5 w-3.5" /></Link></div> : null}
    </article>
  )
}

function FundingCallCard({ call }: { call: FundingCallMatch }) {
  const amount = formatFundingRange(call)
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{call.agencyName}</span>{call.score ? <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">{Math.round(call.score * 100)}% match</span> : null}</div><h3 className="mt-3 text-lg font-semibold text-slate-900">{call.schemeTitle}</h3>{call.shortDescription ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{call.shortDescription}</p> : null}<div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">{amount ? <span className="rounded-lg bg-slate-50 px-2.5 py-1.5">{amount}</span> : null}<span className="rounded-lg bg-slate-50 px-2.5 py-1.5">{call.isRolling ? 'Rolling deadline' : call.closeDate ? `Closes ${new Date(call.closeDate).toLocaleDateString('en-IN')}` : 'Verify deadline'}</span></div><div className="mt-4 flex flex-wrap gap-3"><Link href={`/funding/calls/${call.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700">View call <ArrowRight className="h-4 w-4" /></Link>{call.officialUrls?.[0] ? <a href={call.officialUrls[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500">Official source <ExternalLink className="h-3.5 w-3.5" /></a> : null}</div></article>
}

function SourceEvidenceCard({ eyebrow, title, meta, body, href }: { eyebrow: string; title: string; meta?: string; body?: string | null; href?: string | null }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{eyebrow}</span>
        {href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">Source <ExternalLink className="h-3.5 w-3.5" /></a> : null}
      </div>
      <h3 className="mt-3 text-base font-semibold leading-6 text-slate-900">{title}</h3>
      {meta ? <p className="mt-1 text-xs text-slate-500">{meta}</p> : null}
      {body ? <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-600">{body}</p> : null}
    </article>
  )
}

const STRATEGY_LABELS: Record<string, string> = {
  narrow_scope: 'Narrow scope',
  pivot_facet: 'Pivot facet',
  combine_white_space: 'Combine white-space',
  funder_align: 'Funder align',
  de_risk: 'De-risk',
}

function ImpactPill({ label, value, goodDirection }: { label: string; value?: string; goodDirection: 'up' | 'down' }) {
  const direction = value || 'flat'
  const positive = direction === goodDirection
  const tone = direction === 'flat' ? 'bg-slate-50 text-slate-600' : positive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
  return <span className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tone}`}>{label}: {direction}</span>
}

function RefinementPanel({ run, token, strengthenGap, onStrengthenHandled }: { run: AnalysisRun; token: string | null; strengthenGap?: IdeaCallGap | null; onStrengthenHandled?: () => void }) {
  const router = useRouter()
  const [objective, setObjective] = useState<'maximize_white_space' | 'target_funder' | 'reduce_risk'>('maximize_white_space')
  const [instructions, setInstructions] = useState('')
  const [candidates, setCandidates] = useState<RefinementCandidate[]>(run.refinementCandidates || [])
  const [generating, setGenerating] = useState(false)
  const [activeGap, setActiveGap] = useState<IdeaCallGap | null>(null)
  const [submittingCandidateId, setSubmittingCandidateId] = useState<string | null>(null)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null)
  const [editedIdeaText, setEditedIdeaText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const currentVersionDelta = run.versions?.find((version) => version.runId === run.id)?.scoreDelta || null
  const deltaItems = currentVersionDelta ? [
    ['Positioning', currentVersionDelta.landscapePositioning?.delta],
    ['White space', currentVersionDelta.whiteSpace?.delta],
    ['Confidence', currentVersionDelta.evidenceConfidence?.delta],
  ].filter((item): item is [string, number] => typeof item[1] === 'number') : []

  useEffect(() => {
    setCandidates(run.refinementCandidates || [])
    setEditingCandidateId(null)
    setExpandedCandidateId(null)
    setEditedIdeaText('')
  }, [run.id, run.refinementCandidates])

  const proposeCandidates = async (targetGap?: IdeaCallGap | null) => {
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
          {activeGap ? <p className="mt-2 rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800">Candidates target the gap: {activeGap.title}</p> : null}
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
      {deltaItems.length ? <div className="mt-4 flex flex-wrap gap-2">{deltaItems.map(([label, delta]) => <span key={label} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{label} {delta >= 0 ? '+' : ''}{delta}</span>)}</div> : null}
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
              <article key={candidate.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${candidate.status === 'SELECTED' ? 'border-emerald-200' : candidate.status === 'DISMISSED' ? 'border-slate-200 opacity-70' : 'border-slate-200'}`}>
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
                  {candidate.status !== 'PROPOSED' ? <span className="rounded-lg bg-slate-50 px-2 py-1">{candidate.status.toLowerCase()}</span> : null}
                </div>
                {expanded ? (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Facet changes</p>
                      <div className="mt-2 space-y-2">
                        {(payload.facetChanges || []).slice(0, 5).map((change, index) => (
                          <div key={`${change.facet}-${index}`} className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                            <span className="font-bold uppercase text-slate-500">{change.change}</span> {change.facet}
                            {change.resultingFacet && change.resultingFacet !== change.facet ? <span>{' -> '}{change.resultingFacet}</span> : null}
                          </div>
                        ))}
                      </div>
                    </div>
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

function CallFitSection({ run }: { run: AnalysisRun }) {
  const alignments = run.scores?.callAlignments || []
  if (!alignments.length) return null
  const callById = new Map((run.retrievalResults?.fundingCalls || []).map((call) => [call.id, call]))
  const callFitById = new Map(
    (Array.isArray((run.report as any)?.callFit) ? ((run.report as any).callFit as CallFitEntry[]) : []).map((entry) => [entry.fundingCallId, entry])
  )
  const ordered = [...alignments].sort((a, b) => (a.role === 'anchored' ? -1 : b.role === 'anchored' ? 1 : (b.alignment || 0) - (a.alignment || 0)))
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Call fit</h2>
          <p className="mt-1 text-sm text-slate-500">How your idea's facets line up against what each call's text actually invites.</p>
        </div>
        <p className="text-xs text-slate-500">Alignment = share of assessed facets the call explicitly invites. Descriptive, not a funding prediction.</p>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {ordered.map((alignment) => {
          const call = callById.get(alignment.fundingCallId)
          const fit = callFitById.get(alignment.fundingCallId)
          return (
            <article key={alignment.fundingCallId} className={`rounded-2xl border p-5 shadow-sm ${alignment.role === 'anchored' ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{call?.agencyName || 'Funding call'}</span>
                  <h3 className="mt-1 text-base font-semibold leading-6 text-slate-900">{call?.schemeTitle || alignment.fundingCallId}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {alignment.role === 'anchored' ? <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-700">Your target call</span> : null}
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${alignment.alignment >= 60 ? 'bg-emerald-50 text-emerald-700' : alignment.alignment >= 30 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{alignment.alignment}% aligned</span>
                </div>
              </div>
              {fit?.fitSummary ? <p className="mt-3 text-sm leading-6 text-slate-600">{fit.fitSummary}</p> : null}
              {alignment.callPriorities.length ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-500">What this call asks for</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">{alignment.callPriorities.slice(0, 6).map((priority) => <span key={priority} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{priority}</span>)}</div>
                </div>
              ) : null}
              <div className="mt-3 space-y-1.5 text-xs">
                {alignment.invitedFacets.length ? <p><span className="font-bold text-emerald-700">Invited:</span> <span className="text-slate-600">{alignment.invitedFacets.join(' · ')}</span></p> : null}
                {alignment.partialFacets.length ? <p><span className="font-bold text-amber-700">Related:</span> <span className="text-slate-600">{alignment.partialFacets.join(' · ')}</span></p> : null}
                {alignment.outsideScopeFacets.length ? <p><span className="font-bold text-rose-700">Possibly out of scope:</span> <span className="text-slate-600">{alignment.outsideScopeFacets.join(' · ')}</span></p> : null}
                {alignment.unassessedFacets.length ? <p><span className="font-bold text-slate-500">Not covered by supplied call text:</span> <span className="text-slate-500">{alignment.unassessedFacets.join(' · ')}</span></p> : null}
              </div>
              {fit?.verifyBeforeApplying?.length ? (
                <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800">Verify before applying</p>
                  <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-800">{fit.verifyBeforeApplying.slice(0, 4).map((item) => <li key={item}>- {item}</li>)}</ul>
                </div>
              ) : null}
              <Link href={`/funding/calls/${alignment.fundingCallId}`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">Open call <ArrowRight className="h-3.5 w-3.5" /></Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function GapSection({ run, onStrengthen, strengthenBusyGapId }: { run: AnalysisRun; onStrengthen: (gap: IdeaCallGap) => void; strengthenBusyGapId: string | null }) {
  const gaps = Array.isArray((run.report as any)?.callGaps) ? ((run.report as any).callGaps as IdeaCallGap[]) : []
  if (!gaps.length) return null
  const targetCallId = (run.report as any)?.targetFundingCallId || null
  const targetCall = (run.retrievalResults?.fundingCalls || []).find((call) => call.id === targetCallId) || null
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Gap report{targetCall ? ` — ${targetCall.schemeTitle}` : ''}</h2>
          <p className="mt-1 text-sm text-slate-500">What is missing between this idea and the target call, and how to fix it. Strengthening a gap proposes evidence-grounded revisions of your idea.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {gaps.map((gap) => (
          <article key={gap.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${SEVERITY_STYLES[gap.severity] || SEVERITY_STYLES.minor}`}>{gap.severity}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{GAP_KIND_LABELS[gap.kind] || gap.kind.replace(/_/g, ' ')}</span>
                  {gap.grantPrepStageKey ? <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold capitalize text-teal-700">Fix in: {stageLabel(gap.grantPrepStageKey)}</span> : null}
                </div>
                <h3 className="mt-2 font-semibold leading-6 text-slate-900">{gap.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{gap.detail}</p>
                {gap.fixSuggestion ? <p className="mt-2 text-sm leading-6 text-slate-700"><span className="font-semibold text-teal-800">Suggested fix:</span> {gap.fixSuggestion}</p> : null}
                {gap.evidence.some((item) => item.quote) ? (
                  <div className="mt-2 space-y-1">
                    {gap.evidence.filter((item) => item.quote).slice(0, 2).map((item, index) => (
                      <p key={`${item.evidenceId}-${index}`} className="text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-600">{item.sourceType.replace(/_/g, ' ')}:</span> &quot;{item.quote}&quot;</p>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onStrengthen(gap)}
                disabled={Boolean(strengthenBusyGapId)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {strengthenBusyGapId === gap.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Strengthen this
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ReviewerSection({ run }: { run: AnalysisRun }) {
  const panel = Array.isArray((run.report as any)?.reviewerPanel) ? ((run.report as any).reviewerPanel as IdeaReviewerPersona[]) : []
  if (!panel.length) return null
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="font-semibold text-slate-900">Simulated review panel</h2>
        <p className="mt-1 text-sm text-slate-500">The hardest fair questions each reviewer archetype would ask about this idea against the target call — with how to pre-empt them.</p>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {panel.map((persona) => (
          <article key={persona.persona} className="rounded-2xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">{persona.personaLabel}</h3>
            {persona.overallStance ? <p className="mt-1 text-xs leading-5 text-slate-500">{persona.overallStance}</p> : null}
            <div className="mt-3 space-y-3">
              {persona.objections.map((objection, index) => (
                <div key={`${persona.persona}-${index}`} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_STYLES[objection.severity] || SEVERITY_STYLES.minor}`}>{objection.severity}</span>
                    {objection.grantPrepStageKey ? <span className="text-[10px] font-semibold capitalize text-teal-700">Address in {stageLabel(objection.grantPrepStageKey)}</span> : null}
                  </div>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-800">&quot;{objection.objection}&quot;</p>
                  {objection.preemption ? <p className="mt-1.5 text-xs leading-5 text-slate-600"><span className="font-semibold text-emerald-700">Pre-empt:</span> {objection.preemption}</p> : null}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ReportView({ report }: { report: Record<string, unknown> }) {
  const sections = [
    ['Potential differentiators', asStrings(report.differentiators), Lightbulb, 'text-emerald-700'],
    ['Risks and reviewer questions', asStrings(report.risks), AlertTriangle, 'text-amber-700'],
    ['Positioning recommendations', asStrings(report.positioningRecommendations), Target, 'text-teal-700'],
    ['Recommended next steps', asStrings(report.nextSteps), CheckCircle2, 'text-sky-700'],
  ] as const
  return <div className="space-y-5"><section className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-6"><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Executive positioning view</p><p className="mt-3 text-lg font-medium leading-8 text-slate-800">{asString(report.executiveVerdict) || 'Review the evidence and landscape signals below.'}</p>{asString(report.landscapeSummary) ? <p className="mt-4 text-sm leading-7 text-slate-600">{asString(report.landscapeSummary)}</p> : null}</section>{sections.map(([title, items, Icon, tone]) => items.length ? <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center gap-2"><Icon className={`h-5 w-5 ${tone}`} /><h3 className="font-semibold text-slate-900">{title}</h3></div><ul className="mt-4 space-y-3">{items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-600"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />{item}</li>)}</ul></section> : null)}<div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" /><p>{asString(report.evidenceDisclaimer) || 'This analysis describes available evidence and does not predict funding success.'}</p></div></div>
}

export default function IdeaAnalysisWorkspace({ runId }: { runId: string }) {
  const { token, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [run, setRun] = useState<AnalysisRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [tab, setTab] = useState<'report' | 'projects' | 'publications' | 'patents' | 'web' | 'funders'>('report')
  const [exportingIdea, setExportingIdea] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [strengthenGap, setStrengthenGap] = useState<IdeaCallGap | null>(null)
  const [strengthenBusyGapId, setStrengthenBusyGapId] = useState<string | null>(null)
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
  const assessmentByProject = useMemo(() => new Map((run?.analysis?.items || []).map((item) => [item.projectId, item])), [run?.analysis?.items])
  const topFundingCall = run?.retrievalResults?.fundingCalls?.[0] || null
  const targetCallId = (run?.report as any)?.targetFundingCallId || run?.anchorFundingCallId || topFundingCall?.id || null

  const handleStrengthen = (gap: IdeaCallGap) => {
    setStrengthenBusyGapId(gap.id)
    setStrengthenGap(gap)
    document.getElementById('refinement-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const startGrantPrep = async () => {
    if (!token || !run || handoffBusy) return
    if (run.linkedGrantPrepSessionId && run.linkedProjectId) {
      router.push(buildGrantPrepEntryUrl({
        projectId: run.linkedProjectId,
        grantOrPrepSessionId: run.linkedGrantPrepSessionId,
      }))
      return
    }
    if (!targetCallId) {
      router.push('/finder')
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
          abstract: [asString(report.executiveVerdict), asString(report.landscapeSummary)].filter(Boolean).join('\n\n'),
          domainTags: [domainTag],
          technicalField: run.structuredIdea?.domain || undefined,
          keyFeatures: asStrings(report.differentiators).slice(0, 6),
          potentialApplications: asStrings(report.positioningRecommendations).concat(asStrings(report.nextSteps)).slice(0, 6),
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

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8"><Link href="/funding/intelligence" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal-800"><ArrowLeft className="h-4 w-4" /> Landscape</Link><span className={`rounded-full px-3 py-1 text-xs font-bold ${run.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700' : run.status === 'FAILED' ? 'bg-rose-50 text-rose-700' : 'bg-teal-50 text-teal-700'}`}>{run.status === 'PROCESSING' ? 'ANALYZING' : run.status}</span></div></header>

      <section className="border-b border-slate-200 bg-white"><div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:px-8"><div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-4xl"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-teal-700"><Sparkles className="h-4 w-4" /> Idea intelligence</div><h1 className="mt-3 text-2xl font-semibold leading-tight sm:text-4xl">{run.title}</h1><p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-500">{run.ideaText}</p></div>{run.status === 'COMPLETED' ? <Link href="/funding/intelligence/idea/new" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"><Zap className="h-4 w-4 text-teal-700" /> Analyze another idea</Link> : null}</div></div></section>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {processing ? <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]"><ProgressPanel run={run} /><div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center"><div className="relative"><div className="absolute inset-0 animate-ping rounded-full bg-teal-100" /><div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-teal-50"><FileSearch className="h-7 w-7 text-teal-700" /></div></div><h2 className="mt-6 text-xl font-semibold">{STAGES[run.currentStage]?.[0] || 'Analyzing evidence'}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{STAGES[run.currentStage]?.[1] || 'Building your evidence-grounded landscape view.'}</p></div></div></div> : null}

        {run.status === 'FAILED' ? <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-7 text-center shadow-sm"><AlertTriangle className="mx-auto h-8 w-8 text-rose-500" /><h2 className="mt-4 text-xl font-semibold">Analysis paused</h2><p className="mt-2 text-sm leading-6 text-slate-500">{run.errorMessage || requestError || 'A provider failed while processing this run.'}</p><button type="button" onClick={retry} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" /> Retry from saved progress</button></div> : null}

        {run.status === 'COMPLETED' && run.scores ? <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl bg-[#0b3437] p-5 text-white shadow-lg shadow-teal-950/10"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-teal-100/70">Landscape positioning</span><Target className="h-4 w-4 text-teal-200" /></div><div className="mt-3 flex items-baseline gap-1"><span className="text-4xl font-semibold">{run.scores.landscapePositioning}</span><span className="text-sm text-teal-100/60">/100</span></div><p className="mt-3 text-[11px] leading-5 text-teal-50/60">Descriptive signal—not a funding probability.</p></div>
            <SignalCard label="Existing overlap" value={run.scores.saturation} icon={BookOpen} tone="text-rose-600" />
            <SignalCard label="Potential white space" value={run.scores.whiteSpace} icon={Lightbulb} tone="text-emerald-600" />
            <SignalCard label="Landscape momentum" value={run.scores.momentum} icon={TrendingUp} tone="text-sky-600" />
            <SignalCard label="Evidence confidence" value={run.scores.evidenceConfidence} icon={ShieldCheck} tone="text-violet-600" />
          </div>

          <CallFitSection run={run} />

          <GapSection run={run} onStrengthen={handleStrengthen} strengthenBusyGapId={strengthenBusyGapId} />

          <ReviewerSection run={run} />

          <CrossCorpusTable rows={run.scores.crossCorpusFacets || []} />

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-slate-900">Continue from this analysis</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {run.linkedGrantPrepSessionId
                    ? 'This idea has already been handed off to Grant Prep — continue where you left off.'
                    : targetCallId
                      ? 'Start Grant Prep with this validated idea locked in: the gaps and reviewer objections carry over with it.'
                      : 'Save the idea for later or move into call-specific grant preparation.'}
                </p>
                {exportMessage ? <p className="mt-2 text-xs font-semibold text-teal-700">{exportMessage}</p> : null}
                {handoffError ? <p className="mt-2 text-xs font-semibold text-rose-700">{handoffError}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={exportToIdeaBank} disabled={exportingIdea} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                  {exportingIdea ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                  Export to Idea Bank
                </button>
                <Link href="/idea-bank" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Open Idea Bank</Link>
                <button type="button" onClick={startGrantPrep} disabled={handoffBusy} className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300">
                  {handoffBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {run.linkedGrantPrepSessionId ? 'Continue in Grant Prep' : 'Start Grant Prep with this idea'} <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          <RefinementPanel run={run} token={token} strengthenGap={strengthenGap} onStrengthenHandled={() => { setStrengthenGap(null); setStrengthenBusyGapId(null) }} />

          <div className="mt-7 border-b border-slate-200"><nav className="flex gap-1 overflow-x-auto">{([
            ['report', 'Positioning brief', Sparkles],
            ['projects', `Funded projects (${run.retrievalResults?.projects.length || 0})`, Landmark],
            ['publications', `Publications (${run.retrievalResults?.publications?.length || 0})`, BookOpen],
            ['patents', `Patents (${run.retrievalResults?.patents?.length || 0})`, FileSearch],
            ['web', `Web (${run.retrievalResults?.webResults?.length || 0})`, ExternalLink],
            ['funders', `Open calls (${run.retrievalResults?.fundingCalls.length || 0})`, Target],
          ] as const).map(([value, label, Icon]) => <button type="button" key={value} onClick={() => setTab(value)} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${tab === value ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav></div>

          <div className="mt-6">
            {tab === 'report' && run.report ? <ReportView report={run.report} /> : null}
            {tab === 'projects' ? <div className="space-y-4"><FacetLegend />{run.retrievalResults?.degradedMode ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Semantic retrieval was unavailable for this run; project evidence came from keyword matching.</div> : null}{run.retrievalResults?.projects.map((project) => <EvidenceRow key={project.id} project={project} assessment={assessmentByProject.get(project.id)} />)}</div> : null}
            {tab === 'publications' ? <div className="grid gap-4 lg:grid-cols-2">{run.retrievalResults?.publications?.length ? run.retrievalResults.publications.map((item) => <SourceEvidenceCard key={item.id} eyebrow={item.source} title={item.title} meta={[item.venue, item.year, item.citationCount !== null ? `${item.citationCount} citations` : null, item.doi].filter(Boolean).join(' · ')} body={item.abstract} href={item.url} />) : <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><BookOpen className="mx-auto h-7 w-7 text-slate-300" /><h3 className="mt-3 font-semibold">No publication evidence retrieved</h3><p className="mt-2 text-sm text-slate-500">Try refining the query or adding more technical detail to the idea.</p></div>}</div> : null}
            {tab === 'patents' ? <div className="space-y-4">{run.retrievalResults?.evidenceDiagnostics?.patentnestConfigured === false ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">PatentNest is not configured. Add the server-only <span className="font-mono text-xs">PATENTNEST_API_KEY</span> to enable the Indian patent corpus; Google Patents fallback results remain available.</div> : null}<div className="grid gap-4 lg:grid-cols-2">{run.retrievalResults?.patents?.length ? run.retrievalResults.patents.map((item) => <SourceEvidenceCard key={`${item.source}-${item.id}`} eyebrow={item.source === 'patentnest' ? 'PatentNest' : 'Google Patents'} title={item.title} meta={[item.publicationNumber, item.assignee, item.publicationDate || item.filingDate].filter(Boolean).join(' · ')} body={item.abstract} href={item.url} />) : <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><FileSearch className="mx-auto h-7 w-7 text-slate-300" /><h3 className="mt-3 font-semibold">No patent evidence retrieved</h3></div>}</div></div> : null}
            {tab === 'web' ? <div className="grid gap-4 lg:grid-cols-2">{run.retrievalResults?.webResults?.length ? run.retrievalResults.webResults.map((item) => <SourceEvidenceCard key={item.id} eyebrow={item.source} title={item.title} meta={item.date || undefined} body={item.snippet} href={item.url} />) : <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><ExternalLink className="mx-auto h-7 w-7 text-slate-300" /><h3 className="mt-3 font-semibold">No web evidence retrieved</h3></div>}</div> : null}
            {tab === 'funders' ? <div className="grid gap-4 lg:grid-cols-2">{run.retrievalResults?.fundingCalls.length ? run.retrievalResults.fundingCalls.map((call) => <FundingCallCard key={call.id} call={call} />) : <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Clock3 className="mx-auto h-7 w-7 text-slate-300" /><h3 className="mt-3 font-semibold">No open calls matched strongly</h3><Link href="/finder" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700">Broaden the funding search <ArrowRight className="h-4 w-4" /></Link></div>}</div> : null}
          </div>
        </> : null}
      </div>
    </main>
  )
}
