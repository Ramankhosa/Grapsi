'use client'

// Presentational blocks for the reviewer's final report page. Everything here
// is deterministic rendering of the stored report JSON — no model calls, no
// data fetching. The page composes these in one scrollable document joined by
// in-page anchors (the user asked for links, not tabs).

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { ReviewerProse, ReviewerText } from '@/components/reviewer/ReviewerText'

// ---------------------------------------------------------------------------
// Shared helpers

export function anchorFor(title: string): string {
  const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return `section-${slug || 'untitled'}`
}

export type ScoreBand = 'strong' | 'adequate' | 'weak' | 'none'

export function scoreBand(score: unknown): ScoreBand {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'none'
  if (score >= 7) return 'strong'
  if (score >= 5) return 'adequate'
  return 'weak'
}

const BAND_BAR: Record<ScoreBand, string> = {
  strong: 'bg-green-500',
  adequate: 'bg-amber-500',
  weak: 'bg-red-500',
  none: 'bg-nickel-300',
}
const BAND_CHIP: Record<ScoreBand, string> = {
  strong: 'bg-green-50 text-green-800 border-green-200',
  adequate: 'bg-amber-50 text-amber-800 border-amber-200',
  weak: 'bg-red-50 text-red-800 border-red-200',
  none: 'bg-nickel-50 text-nickel-600 border-nickel-200',
}
const BAND_RING: Record<ScoreBand, string> = {
  strong: '#16a34a',
  adequate: '#d97706',
  weak: '#dc2626',
  none: '#9ca3af',
}

export function Chip({ band = 'none', children, title }: { band?: ScoreBand; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${BAND_CHIP[band]}`}>
      {children}
    </span>
  )
}

export function DeltaChip({ delta, previousScore }: { delta: unknown; previousScore?: unknown }) {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return null
  const up = delta > 0
  const flat = delta === 0
  const cls = flat ? 'text-nickel-500 bg-nickel-50 border-nickel-200' : up ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'
  const label = flat ? 'no change' : `${up ? '▲ +' : '▼ '}${delta.toFixed(1)}`
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}
      title={typeof previousScore === 'number' ? `Previous version scored ${previousScore.toFixed(1)}` : undefined}
    >
      {label}
    </span>
  )
}

function fmtScore(score: unknown): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(1) : '—'
}

export function SectionLink({ title, className = '' }: { title: string; className?: string }) {
  return (
    <a href={`#${anchorFor(title)}`} className={`text-cobalt-700 hover:text-cobalt-800 hover:underline ${className}`}>
      {title}
    </a>
  )
}

export function Panel({ id, title, note, action, children, className = '' }: {
  id?: string
  title: React.ReactNode
  note?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={`nk-panel overflow-hidden scroll-mt-24 print:shadow-none ${className}`}>
      <div className="bg-nickel-800 px-6 py-3 print:bg-nickel-800 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          {note ? <p className="text-xs text-nickel-300">{note}</p> : null}
        </div>
        {action ? <div className="print:hidden">{action}</div> : null}
      </div>
      <div className="p-6">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Jump bar — sticky anchor links with scroll-spy. One page, no tabs.

export function ReportJumpBar({ items }: { items: Array<{ id: string; label: string }> }) {
  const [active, setActive] = useState<string>(items[0]?.id || '')

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target?.id) setActive(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.1] }
    )
    items.forEach((item) => {
      const element = document.getElementById(item.id)
      if (element) observer.observe(element)
    })
    return () => observer.disconnect()
  }, [items])

  return (
    <nav
      aria-label="Report sections"
      className="sticky top-0 z-20 -mx-2 mb-4 overflow-x-auto whitespace-nowrap rounded-md border border-nickel-200 bg-white/95 px-2 py-2 backdrop-blur print:hidden"
    >
      <ul className="flex items-center gap-1 text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                active === item.id ? 'bg-nickel-800 text-white' : 'text-nickel-700 hover:bg-nickel-100'
              }`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Cover — score ring, verdict chips, summary

export function ScoreRing({ score, size = 112 }: { score: unknown; size?: number }) {
  const value = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : 0
  const radius = (size - 14) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (value / 10) * circumference
  const band = scoreBand(typeof score === 'number' ? score : null)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Overall score ${fmtScore(score)} out of 10`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={BAND_RING[band]} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="48%" textAnchor="middle" className="fill-nickel-900" style={{ fontSize: size * 0.26, fontWeight: 700 }}>{fmtScore(score)}</text>
      <text x="50%" y="66%" textAnchor="middle" className="fill-nickel-500" style={{ fontSize: size * 0.11 }}>out of 10</text>
    </svg>
  )
}

const DECISION_LABELS: Record<string, string> = {
  fund: 'Fund',
  fund_with_revisions: 'Fund with revisions',
  revise_and_resubmit: 'Revise and resubmit',
  do_not_fund: 'Do not fund',
}
const DECISION_BAND: Record<string, ScoreBand> = {
  fund: 'strong', fund_with_revisions: 'strong', revise_and_resubmit: 'adequate', do_not_fund: 'weak',
}
const COMPETITIVENESS_LABELS: Record<string, string> = {
  top_tier: 'Top tier', competitive: 'Competitive', borderline: 'Borderline', not_competitive: 'Not competitive',
}
export const NOVELTY_LABELS: Record<string, string> = {
  generic: 'Generic',
  incremental: 'Incremental',
  differentiated: 'Differentiated',
  novel_within_evidence: 'Novel within available evidence',
  unassessed: 'Not assessed',
}
const NOVELTY_BAND: Record<string, ScoreBand> = {
  generic: 'weak', incremental: 'adequate', differentiated: 'strong', novel_within_evidence: 'strong', unassessed: 'none',
}

export function ReportCover({ overall, projectTitle, agencyName, generatedAt, reviewedCount, pendingDrafts, scoredVersions }: {
  overall: any
  projectTitle: string
  agencyName?: string | null
  generatedAt?: string | null
  reviewedCount: number
  pendingDrafts: Record<string, number>
  scoredVersions: Record<string, number>
}) {
  const decision = overall?.funding_recommendation?.decision
  const competitiveness = overall?.funding_recommendation?.competitiveness
  const novelty = overall?.novelty_assessment
  const compliance = overall?.compliance
  const missing = compliance?.requiredSections?.missing?.length || 0
  const overLimits = (compliance?.limits || []).filter((limit: any) => limit?.status === 'over').length
  const revised = Object.entries(scoredVersions || {}).filter(([, version]) => Number(version) > 1)
  const pending = Object.entries(pendingDrafts || {})

  return (
    <div className="flex flex-wrap items-start gap-6">
      <ScoreRing score={overall?.overall_score} />
      <div className="min-w-[240px] flex-1">
        <p className="text-xs uppercase tracking-wide text-nickel-500">Panel report</p>
        <h1 className="mt-0.5 text-2xl font-bold leading-snug text-nickel-900">{projectTitle}</h1>
        <p className="mt-1 text-sm text-nickel-500">
          {[agencyName, generatedAt ? `Generated ${new Date(generatedAt).toLocaleDateString()}` : null, `${reviewedCount} section${reviewedCount === 1 ? '' : 's'} scored`]
            .filter(Boolean).join(' · ')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {decision ? <Chip band={DECISION_BAND[decision] || 'none'}>{DECISION_LABELS[decision] || decision}</Chip> : null}
          {competitiveness ? <Chip>{COMPETITIVENESS_LABELS[competitiveness] || competitiveness}</Chip> : null}
          {typeof overall?.score_basis?.weightedScore === 'number' ? <Chip title="Deterministic weighted score across the call's criteria">Weighted {overall.score_basis.weightedScore.toFixed(2)}</Chip> : null}
          {novelty ? (
            <a href="#novelty" className="no-underline">
              <Chip band={NOVELTY_BAND[novelty.verdict] || 'none'} title="Reference only — computed against retrieved prior work">
                Novelty: {NOVELTY_LABELS[novelty.verdict] || novelty.verdict}{novelty.confidence ? ` · ${novelty.confidence} confidence` : ''}
              </Chip>
            </a>
          ) : null}
          {compliance ? (
            <a href="#compliance" className="no-underline">
              <Chip band={missing || overLimits ? 'weak' : 'strong'}>
                {missing || overLimits ? `Compliance: ${missing ? `${missing} missing` : ''}${missing && overLimits ? ', ' : ''}${overLimits ? `${overLimits} over limit` : ''}` : 'Compliance: all clear'}
              </Chip>
            </a>
          ) : null}
        </div>
        {revised.length || pending.length ? (
          <p className="mt-3 text-xs text-nickel-500">
            {revised.length ? `Scored revised versions: ${revised.map(([title, version]) => `${title} v${version}`).join(', ')}. ` : ''}
            {pending.length ? (
              <span className="text-amber-700">
                Newer drafts awaiting review: {pending.map(([title, version]) => `${title} v${version}`).join(', ')} — this report describes the last reviewed version of each.
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {overall?.funding_recommendation?.rationale ? (
        <p className="basis-full text-sm italic text-nickel-700">{overall.funding_recommendation.rationale}</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Novelty & positioning

export function NoveltyBlock({ novelty }: { novelty: any }) {
  if (!novelty) return null
  const band = NOVELTY_BAND[novelty.verdict] || 'none'
  const done = Array.isArray(novelty.already_done) ? novelty.already_done : []
  const signals = Array.isArray(novelty.generic_signals) ? novelty.generic_signals : []
  const claims = Array.isArray(novelty.distinctive_claims) ? novelty.distinctive_claims : []
  const changes = Array.isArray(novelty.what_would_make_it_distinctive) ? novelty.what_would_make_it_distinctive : []
  const coverage = novelty.evidence_coverage
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip band={band}>{NOVELTY_LABELS[novelty.verdict] || novelty.verdict}</Chip>
        {novelty.confidence ? <Chip>{novelty.confidence} confidence</Chip> : null}
        <Chip band={coverage === 'strong' ? 'strong' : coverage === 'partial' ? 'adequate' : 'weak'} title="How much retrieved evidence the verdict could lean on">
          evidence coverage: {coverage || 'unknown'}
        </Chip>
        {novelty.verdict === 'unassessed' ? <span className="text-xs text-nickel-500">Not enough evidence or text to judge — see the landscape below.</span> : null}
      </div>
      {novelty.positioning_summary ? <p className="text-nickel-800">{novelty.positioning_summary}</p> : null}

      {done.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-nickel-700">Already done</h3>
          <div className="overflow-x-auto rounded-md border border-nickel-200">
            <table className="min-w-full text-sm">
              <thead className="bg-nickel-50 text-left text-xs uppercase tracking-wide text-nickel-500">
                <tr><th className="px-3 py-2">Work</th><th className="px-3 py-2">Overlaps your aspects</th><th className="px-3 py-2">Leaves open</th></tr>
              </thead>
              <tbody className="divide-y divide-nickel-100">
                {done.map((item: any, index: number) => (
                  <tr key={`done-${index}`}>
                    <td className="px-3 py-2 text-nickel-900">
                      <span className="mr-2 rounded bg-nickel-100 px-1.5 py-0.5 text-[11px] uppercase text-nickel-600">{item.kind === 'patent' ? 'patent' : 'funded'}</span>
                      <a href="#landscape" className="text-cobalt-700 hover:underline">{item.title || item.ref}</a>
                    </td>
                    <td className="px-3 py-2 text-nickel-700">{item.overlap || '—'}</td>
                    <td className="px-3 py-2 text-nickel-700">{item.leaves_open || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {signals.length ? (
          <div className="rounded-md bg-red-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-red-800">Why it reads as generic</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-nickel-800">{signals.map((item: string, index: number) => <li key={`sig-${index}`}>{item}</li>)}</ul>
          </div>
        ) : null}
        {claims.length ? (
          <div className="rounded-md bg-green-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-green-800">What is distinctive already</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-nickel-800">{claims.map((item: string, index: number) => <li key={`claim-${index}`}>{item}</li>)}</ul>
          </div>
        ) : null}
        {changes.length ? (
          <div className="rounded-md bg-nickel-50 p-4 md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-nickel-800">What would make it distinctive</h3>
            <ul className="space-y-2 text-sm">
              {changes.map((item: any, index: number) => (
                <li key={`change-${index}`} className="flex flex-wrap items-baseline gap-2">
                  <span className="text-nickel-900">{item.change}</span>
                  {item.why ? <span className="text-nickel-500">— {item.why}</span> : null}
                  {item.section ? <SectionLink title={item.section} className="text-xs" /> : null}
                  {item.effort ? <Chip>{item.effort}</Chip> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-nickel-500">Reference only — judged against retrieved funded projects and Indian patents; not part of the score.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scores

export type ScoreRow = {
  title: string
  version: number
  score: number | null
  delta: number | null
  previousScore: number | null
  improvement: boolean | null
  pendingDraft: number | null
  inReport: boolean
  headline?: string | null
}

export function SectionScoreBars({ rows }: { rows: ScoreRow[] }) {
  if (!rows.length) return <p className="text-sm text-nickel-500">No reviewed sections yet.</p>
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const band = scoreBand(row.score)
        const width = row.score === null ? 0 : Math.max(2, Math.min(100, (row.score / 10) * 100))
        return (
          <div key={`${row.title}-${row.version}`} className="grid grid-cols-[minmax(120px,1.2fr)_minmax(0,3fr)_auto] items-center gap-3 text-sm">
            <div className="truncate">
              <SectionLink title={row.title} className="font-medium" />
              <span className="ml-2 text-xs text-nickel-500">v{row.version}</span>
              {row.inReport ? null : <span className="ml-2 text-[11px] text-amber-700">not in report</span>}
              {row.pendingDraft ? <span className="ml-2 text-[11px] text-amber-700">v{row.pendingDraft} awaiting review</span> : null}
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-nickel-100" title={row.headline || undefined}>
              <div className={`h-full rounded-full ${BAND_BAR[band]}`} style={{ width: `${width}%` }} />
            </div>
            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
              <span className="w-8 text-right font-semibold text-nickel-900">{fmtScore(row.score)}</span>
              <DeltaChip delta={row.delta} previousScore={row.previousScore} />
            </div>
          </div>
        )
      })}
      <p className="pt-1 text-xs text-nickel-500">Green 7 and above · amber 5 to 6.9 · red below 5. Deltas compare a revised section with the version reviewed before it.</p>
    </div>
  )
}

export function CriterionBars({ rows }: { rows: any[] }) {
  if (!rows?.length) return null
  return (
    <div className="space-y-2">
      {rows.map((row: any, index: number) => {
        const score = typeof row?.score === 'number' ? row.score : null
        const weight = typeof row?.weight === 'number' ? row.weight : null
        const band = scoreBand(score)
        const contribution = weight !== null && score !== null ? (weight / 100) * score : null
        return (
          <div key={`crit-${index}`} className="grid grid-cols-[minmax(140px,1.4fr)_minmax(0,3fr)_auto] items-center gap-3 text-sm">
            <div className="truncate">
              <span className="font-medium text-nickel-900">{row.criterion}</span>
              {weight !== null ? <span className="ml-2 text-xs text-nickel-500">{weight}%</span> : null}
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-nickel-100" title={row.verdict || undefined}>
              <div className={`h-full rounded-full ${score === null ? 'bg-nickel-200' : 'bg-purple-500'}`} style={{ width: `${score === null ? 0 : Math.max(2, (score / 10) * 100)}%` }} />
            </div>
            <div className="whitespace-nowrap text-right">
              <span className={`font-semibold ${band === 'none' ? 'text-nickel-500' : 'text-nickel-900'}`}>{score === null ? 'Not evidenced' : score.toFixed(1)}</span>
              {contribution !== null ? <span className="ml-2 text-xs text-nickel-500">→ {contribution.toFixed(2)} pts</span> : null}
            </div>
            {row.verdict || row.evidence_sections?.length ? (
              <p className="col-span-3 -mt-1 text-xs text-nickel-600">
                {row.verdict}
                {row.evidence_sections?.length ? <span className="ml-1 text-nickel-500">(from {row.evidence_sections.map((title: string, i: number) => <span key={title}>{i ? ', ' : ''}<SectionLink title={title} /></span>)})</span> : null}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Priority actions, consistency, compliance

const IMPACT_BAND: Record<string, ScoreBand> = { high: 'weak', medium: 'adequate', low: 'none' }

export function PriorityActions({ actions }: { actions: any[] }) {
  if (!actions?.length) return <p className="text-sm text-nickel-500">The panel did not rank priority actions for this report.</p>
  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {actions.map((action: any, index: number) => (
        <li key={`action-${index}`} className="rounded-md border border-nickel-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-nickel-900 text-xs font-bold text-white">{action.rank ?? index + 1}</span>
            {action.section ? <SectionLink title={action.section} className="font-medium" /> : null}
            <Chip band={IMPACT_BAND[action.impact] || 'none'}>{action.impact || '—'} impact</Chip>
            <Chip>{action.effort || '—'} effort</Chip>
          </div>
          {action.issue ? <p className="mt-2 text-sm text-nickel-600">{action.issue}</p> : null}
          <p className="mt-1 text-nickel-900">{action.action}</p>
          {action.expected_gain ? <p className="mt-1 text-sm text-green-700">Expected gain: {action.expected_gain}</p> : null}
        </li>
      ))}
    </ol>
  )
}

export function ConsistencyFlags({ flags }: { flags: any[] }) {
  if (!flags?.length) return <p className="text-sm text-green-700">No contradictions were found between sections.</p>
  return (
    <ul className="space-y-2">
      {flags.map((flag: any, index: number) => (
        <li key={`flag-${index}`} className="flex flex-wrap items-start gap-2 rounded-md border border-nickel-200 p-3 text-sm">
          <Chip band={flag.severity === 'high' ? 'weak' : flag.severity === 'low' ? 'none' : 'adequate'}>{flag.severity || 'medium'}</Chip>
          <span className="flex-1 text-nickel-900">{flag.issue}</span>
          {Array.isArray(flag.sections) && flag.sections.length ? (
            <span className="text-xs text-nickel-600">
              {flag.sections.map((title: string, i: number) => <span key={title}>{i ? ' ↔ ' : ''}<SectionLink title={title} /></span>)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function Bar({ ratio, band }: { ratio: number; band: ScoreBand }) {
  return (
    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-nickel-100">
      <div className={`h-full rounded-full ${BAND_BAR[band]}`} style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
    </div>
  )
}

export function ComplianceBars({ compliance }: { compliance: any }) {
  if (!compliance) return <p className="text-sm text-nickel-500">No compliance facts were computed for this report.</p>
  const coverage = Number(compliance.requiredSections?.coveragePercent ?? 100)
  const missing: string[] = compliance.requiredSections?.missing || []
  const limits: any[] = Array.isArray(compliance.limits) ? compliance.limits : []
  const deadline = compliance.deadline
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="flex justify-between"><span className="font-medium text-nickel-900">Required sections drafted</span><span>{coverage}%</span></div>
        <Bar ratio={coverage / 100} band={coverage >= 100 ? 'strong' : coverage >= 70 ? 'adequate' : 'weak'} />
        {missing.length ? <p className="mt-1 text-xs text-red-700">Missing: {missing.join('; ')}</p> : <p className="mt-1 text-xs text-green-700">All required sections are present.</p>}
      </div>
      {limits.length ? limits.map((limit: any, index: number) => {
        const ratio = limit.limit ? limit.actual / limit.limit : 0
        return (
          <div key={`limit-${index}`}>
            <div className="flex justify-between">
              <span className="font-medium text-nickel-900"><SectionLink title={limit.section} /> <span className="text-xs text-nickel-500">{limit.rule}</span></span>
              <span className={limit.status === 'over' ? 'text-red-700' : limit.status === 'near' ? 'text-amber-700' : 'text-nickel-700'}>
                {Number(limit.actual).toLocaleString()} / {Number(limit.limit).toLocaleString()} {limit.unit}
              </span>
            </div>
            <Bar ratio={ratio} band={limit.status === 'over' ? 'weak' : limit.status === 'near' ? 'adequate' : 'strong'} />
          </div>
        )
      }) : <p className="text-xs text-nickel-500">The call did not state numeric length limits.</p>}
      <div>
        <div className="flex justify-between"><span className="font-medium text-nickel-900">Deadline</span>
          <span className={deadline?.status === 'passed' ? 'text-red-700' : deadline?.status === 'closing' ? 'text-amber-700' : 'text-nickel-700'}>
            {deadline?.date ? `${new Date(deadline.date).toLocaleDateString()} · ${deadline.status === 'passed' ? 'passed' : `${deadline.daysRemaining} days left`}` : 'not recorded'}
          </span>
        </div>
        {deadline?.date && typeof deadline.daysRemaining === 'number' ? (
          <Bar ratio={deadline.status === 'passed' ? 1 : Math.max(0.02, 1 - Math.min(1, deadline.daysRemaining / 90))} band={deadline.status === 'passed' ? 'weak' : deadline.status === 'closing' ? 'adequate' : 'strong'} />
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section card

export function SectionReviewCard({ section, inReportVersion, pendingDraft, expanded, onToggleExpand, compact = false }: {
  section: any
  inReportVersion: number | null
  pendingDraft: number | null
  expanded: boolean
  onToggleExpand: () => void
  compact?: boolean
}) {
  const review = section?.ai_review_json || {}
  const score = typeof review.score === 'number' ? review.score : null
  const band = scoreBand(score)
  const recommendations = (Array.isArray(review.recommendations) && review.recommendations.length ? review.recommendations : review.suggestions) || []
  const addressed = Array.isArray(review.addressed_previous_points) ? review.addressed_previous_points : []
  const complianceFlags = (Array.isArray(review.compliance_flags) ? review.compliance_flags : []).filter((flag: any) => flag?.status && flag.status !== 'met')
  const criterionScores = Array.isArray(review.criterion_scores) ? review.criterion_scores : []
  const version = Number(section.version || 1)
  const inReport = inReportVersion !== null && inReportVersion === version

  return (
    <article className={`rounded-md border border-nickel-200 bg-white ${compact ? '' : 'print:break-before-page'}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-nickel-200 bg-nickel-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`font-semibold text-nickel-900 ${compact ? 'text-base' : 'text-lg'}`}><ReviewerText value={section.section_title} fallback="Untitled section" /></h3>
          <Chip title={review.revision_of_version ? `Revision of v${review.revision_of_version}` : undefined}>
            v{version}{review.revision_of_version ? ` · revision of v${review.revision_of_version}` : ''}
          </Chip>
          <DeltaChip delta={review.score_delta} previousScore={review.previous_score} />
          {typeof review.improvement_over_previous === 'boolean' && version > 1 ? (
            <span className="text-xs text-nickel-500">{review.improvement_over_previous ? 'substantive improvement' : 'not yet a substantive improvement'}</span>
          ) : null}
          {inReport ? <Chip band="strong">in report</Chip> : inReportVersion !== null ? <Chip title={`The report scored v${inReportVersion}`}>report uses v{inReportVersion}</Chip> : null}
          {pendingDraft ? <Chip band="adequate">v{pendingDraft} awaiting review</Chip> : null}
        </div>
        <div className={`rounded-full border px-3 py-1 text-sm font-semibold ${BAND_CHIP[band]}`}>{fmtScore(score)} / 10</div>
      </header>

      <div className={`space-y-5 ${compact ? 'p-4' : 'p-6'}`}>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-nickel-700">Section content</h4>
            <button type="button" onClick={onToggleExpand} className="text-xs text-cobalt-700 hover:underline print:hidden">{expanded ? 'Show less' : 'Show more'}</button>
          </div>
          <div className={`relative overflow-hidden rounded-md border border-nickel-200 p-3 text-sm text-nickel-800 ${expanded ? '' : 'max-h-28 print:max-h-none'}`}>
            {!expanded ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent print:hidden" /> : null}
            <div className="whitespace-pre-line"><ReviewerText value={section.user_input} /></div>
          </div>
        </div>

        {review.summary ? (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-nickel-700">Reviewer read</h4>
            <ReviewerProse value={review.summary} className="text-sm text-nickel-800" />
          </div>
        ) : null}

        {criterionScores.length ? (
          <div className="flex flex-wrap gap-2">
            {criterionScores.map((item: any, index: number) => (
              <Chip key={`cs-${index}`} band={scoreBand(item?.score)} title={item?.evidence || undefined}>{item?.criterion}: {fmtScore(item?.score)}</Chip>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md bg-green-50 p-4">
            <h4 className="mb-2 text-sm font-semibold text-green-800">Strengths</h4>
            <ul className="space-y-1 text-sm text-nickel-800">
              {(review.strengths || []).length ? (review.strengths || []).map((item: any, index: number) => <li key={`s-${index}`} className="flex gap-2"><span className="text-green-600">•</span><span><ReviewerText value={item} /></span></li>) : <li className="text-nickel-500">None recorded.</li>}
            </ul>
          </div>
          <div className="rounded-md bg-red-50 p-4">
            <h4 className="mb-2 text-sm font-semibold text-red-800">Weaknesses</h4>
            <ul className="space-y-1 text-sm text-nickel-800">
              {(review.weaknesses || []).length ? (review.weaknesses || []).map((item: any, index: number) => <li key={`w-${index}`} className="flex gap-2"><span className="text-red-600">•</span><span><ReviewerText value={item} /></span></li>) : <li className="text-nickel-500">None recorded.</li>}
            </ul>
          </div>
        </div>

        <div className="rounded-md bg-amber-50 p-4">
          <h4 className="mb-2 text-sm font-semibold text-amber-800">Recommendations</h4>
          <ol className="space-y-1 text-sm text-nickel-800">
            {recommendations.length ? recommendations.map((item: any, index: number) => <li key={`r-${index}`} className="flex gap-2"><span className="font-semibold text-amber-700">{index + 1}.</span><span><ReviewerText value={item} /></span></li>) : <li className="text-nickel-500">No specific recommendations.</li>}
          </ol>
        </div>

        {addressed.length ? (
          <div>
            <h4 className="mb-2 text-sm font-semibold text-nickel-700">Previous remarks — what this revision addressed</h4>
            <ul className="space-y-1 text-sm">
              {addressed.map((item: any, index: number) => {
                const status = String(item?.status || '')
                const icon = status === 'addressed' ? '✓' : status === 'partially' ? '◐' : '✗'
                const color = status === 'addressed' ? 'text-green-700' : status === 'partially' ? 'text-amber-700' : 'text-red-700'
                return (
                  <li key={`ap-${index}`} className="flex gap-2">
                    <span className={`w-4 font-bold ${color}`}>{icon}</span>
                    <span className="text-nickel-800">{item?.point}{item?.evidence ? <span className="text-nickel-500"> — {item.evidence}</span> : null}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {complianceFlags.length ? (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-nickel-700">Rules not yet met in this section</h4>
            <ul className="list-disc space-y-1 pl-5 text-sm text-nickel-800">
              {complianceFlags.map((flag: any, index: number) => <li key={`cf-${index}`}>{flag.rule} — <span className={flag.status === 'missing' ? 'text-red-700' : 'text-amber-700'}>{flag.status}</span>{flag.detail ? `: ${flag.detail}` : ''}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end gap-4 text-xs print:hidden">
          <a href="#scores" className="text-cobalt-700 hover:underline">↑ Scores</a>
          <a href="#top" className="text-cobalt-700 hover:underline">↑ Top</a>
        </div>
      </div>
    </article>
  )
}

export function EmptySections({ callId }: { callId: string }) {
  return (
    <div className="rounded-md border border-dashed border-nickel-300 p-8 text-center">
      <h3 className="text-lg font-medium text-nickel-900">No reviewed sections available</h3>
      <p className="mt-1 text-sm text-nickel-600">Review at least one section before reading the report in detail.</p>
      <Link href={`/reviewer/${callId}`} className="nk-btn-primary nk-btn-sm mt-4 inline-flex">Back to the workspace</Link>
    </div>
  )
}
