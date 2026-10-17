/**
 * The facts an imported catalogue call carries beyond a curated call: where
 * it came from (with attribution), how fresh that source is, its deadline
 * stages, eligibility by requirement, and the award as the funder states it.
 * Shown on the finder call page when the API returns `catalogImport`.
 */
import { ExternalLink, Info } from 'lucide-react'

import { ELIGIBILITY_BADGE } from './eligibilityBadge'

export type ImportedCallFactsView = {
  source: { key: string; name: string; attribution: string | null; url: string | null; lastCheckedAt: string | null; available: boolean }
  enrichmentLevel: string | null
  opportunityStatus: string | null
  lifecycleNeedsCheck: boolean
  sourceClosedAt: string | null
  entryClosesAt: string | null
  finalDeadlineAt: string | null
  deadlines: Array<{ kind: string; label: string | null; dueDate: string; timezone: string | null }>
  award: {
    text: string | null
    currency: string | null
    min: number | null
    max: number | null
    timeBasis: string | null
    recipientBasis: string | null
    usdEstimateMin: number | null
    usdEstimateMax: number | null
    fxAsOf: string | null
    indirectCostPolicy: string | null
    indirectCostNote: string | null
  }
  eligibility: Array<{ dimension: string; label: string; summary: string }>
  viewerEligibility?: { verdict: 'ELIGIBLE' | 'NEEDS_CHECK' | 'INELIGIBLE'; countries: string[] } | null
  requiresNomination: boolean | null
  nominationNote: string | null
  requiredQualifications: string[]
  targetGroups: string[]
  membershipRequirements: string[]
  additionalBenefits: string[]
  sdgGoals: number[]
  programmeFramework: string | null
  titleNative: string | null
}

const STAGE_LABEL: Record<string, string> = {
  OPEN: 'Opens',
  LETTER_OF_INTENT: 'Letter of intent',
  PREPROPOSAL: 'Pre-proposal',
  FULL_APPLICATION: 'Full application',
  OTHER: 'Deadline',
}

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  OPEN: { text: 'Open', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  FORTHCOMING: { text: 'Opening soon', tone: 'bg-cobalt-50 text-cobalt-800 border-cobalt-200' },
  ROLLING: { text: 'Rolling submissions', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  CLOSED: { text: 'Closed', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  UNKNOWN: { text: 'Dates not stated', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
}

const BASIS_LABEL: Record<string, string> = {
  PER_YEAR: 'per year',
  PER_MONTH: 'per month',
  TOTAL: 'in total',
  ONE_OFF: 'one-off',
  PER_PERSON: 'per person',
  PER_TEAM_MEMBER: 'per team member',
  PER_INSTITUTION: 'per institution',
  PER_AWARD: 'per award',
}

function formatDay(value: string | null) {
  if (!value) return null
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatUsd(min: number | null, max: number | null) {
  const fmt = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${v}`)
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}`
  const value = max ?? min
  return value != null ? fmt(value) : null
}

function Chips({ values }: { values: string[] }) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className="cb-badge">
          {value}
        </span>
      ))}
    </div>
  )
}

export function ImportedCallFacts({ facts, promotedToDsr = false }: { facts: ImportedCallFactsView; promotedToDsr?: boolean }) {
  const status = facts.opportunityStatus ? STATUS_LABEL[facts.opportunityStatus] : null
  const usd = formatUsd(facts.award.usdEstimateMin, facts.award.usdEstimateMax)
  const bases = [facts.award.timeBasis, facts.award.recipientBasis].map((b) => (b ? BASIS_LABEL[b] : null)).filter(Boolean)
  const extras: Array<{ label: string; values: string[] }> = [
    { label: 'Required qualifications', values: facts.requiredQualifications },
    { label: 'Aimed at', values: facts.targetGroups },
    { label: 'Membership', values: facts.membershipRequirements },
    { label: 'Additional benefits', values: facts.additionalBenefits },
  ].filter((group) => group.values.length > 0)

  return (
    <section className="cb-card mt-4 p-4 sm:p-5" aria-labelledby="imported-call-facts">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="imported-call-facts" className="cb-title">
            Key facts
          </h2>
          <p className="mt-1 text-[12px] text-muted">
            {facts.source.attribution || `From ${facts.source.name}`}
            {facts.source.url ? (
              <>
                {' · '}
                <a href={facts.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cobalt-700 hover:underline">
                  View listing <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : null}
            {facts.source.lastCheckedAt ? ` · Source last checked ${formatDay(facts.source.lastCheckedAt)}` : null}
            {!facts.source.available ? ' · Listing no longer available at the source' : null}
          </p>
        </div>
        {status ? <span className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${status.tone}`}>{status.text}</span> : null}
      </div>

      {facts.enrichmentLevel === 'LITE' ? (
        <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {promotedToDsr
              ? 'No official guidelines yet: check the funder’s page for the full rules. Grant Prep works from the details above until they are fetched.'
              : 'Official guidelines not yet fetched. Check the funder’s page for the full rules before you apply; Grant Prep becomes available once the guidelines are added.'}
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <div className="cb-eyebrow mb-2">Deadlines</div>
          {facts.deadlines.length === 0 ? (
            <p className="text-[13px] text-muted">{facts.opportunityStatus === 'ROLLING' ? 'Applications accepted on a rolling basis.' : 'No dates stated.'}</p>
          ) : (
            <ul className="space-y-1.5 text-[13px]">
              {facts.deadlines.map((d) => (
                <li key={`${d.kind}-${d.dueDate}`} className="flex justify-between gap-3">
                  <span className="text-muted">{d.label || STAGE_LABEL[d.kind] || 'Deadline'}</span>
                  <span className="font-medium text-ink tabular-nums">{formatDay(d.dueDate)}</span>
                </li>
              ))}
            </ul>
          )}
          {facts.lifecycleNeedsCheck && facts.deadlines.some((d) => d.kind === 'LETTER_OF_INTENT' || d.kind === 'PREPROPOSAL') ? (
            <p className="mt-2 text-[12px] text-muted">An earlier stage closes first; new applicants usually need to meet it.</p>
          ) : null}
        </div>

        <div>
          <div className="cb-eyebrow mb-2">Award</div>
          <p className="text-[13px] font-medium text-ink">{facts.award.text || 'Not stated'}</p>
          {usd ? (
            <p className="mt-1 text-[12px] text-muted">
              ≈ {usd} USD{bases.length > 0 ? ` ${bases.join(', ')}` : ''} (estimate{facts.award.fxAsOf ? `, rates of ${formatDay(facts.award.fxAsOf)}` : ''})
            </p>
          ) : null}
          {facts.award.indirectCostPolicy && facts.award.indirectCostPolicy !== 'UNSPECIFIED' ? (
            <p className="mt-1 text-[12px] text-muted">
              Indirect costs: {facts.award.indirectCostPolicy === 'INCLUDED' ? 'included' : facts.award.indirectCostPolicy === 'DIRECT_ONLY' ? 'direct costs only' : 'co-funding'}
              {facts.award.indirectCostNote ? ` (${facts.award.indirectCostNote})` : ''}
            </p>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <div className="cb-eyebrow mb-2">Who can apply</div>
          <dl className="space-y-1.5 text-[13px]">
            {facts.viewerEligibility ? (
              <div className="grid gap-1 sm:grid-cols-[11rem_1fr]">
                <dt className="text-muted">For your profile</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${ELIGIBILITY_BADGE[facts.viewerEligibility.verdict].className}`}
                    title={ELIGIBILITY_BADGE[facts.viewerEligibility.verdict].title}
                  >
                    {ELIGIBILITY_BADGE[facts.viewerEligibility.verdict].label}
                  </span>
                  <span className="text-[12px] text-muted">based on {facts.viewerEligibility.countries.join(', ')}</span>
                </dd>
              </div>
            ) : null}
            {facts.eligibility.map((row) => (
              <div key={row.dimension} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
                <dt className="text-muted">{row.label}</dt>
                <dd className="text-ink">{row.summary}</dd>
              </div>
            ))}
            {facts.requiresNomination ? (
              <div className="grid gap-1 sm:grid-cols-[11rem_1fr]">
                <dt className="text-muted">Nomination</dt>
                <dd className="text-ink">{facts.nominationNote || 'Required'}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {extras.map((group) => (
          <div key={group.label}>
            <div className="cb-eyebrow mb-2">{group.label}</div>
            <Chips values={group.values} />
          </div>
        ))}

        {facts.programmeFramework || facts.sdgGoals.length > 0 ? (
          <div className="md:col-span-2 text-[12px] text-muted">
            {facts.programmeFramework ? <span>{facts.programmeFramework}</span> : null}
            {facts.programmeFramework && facts.sdgGoals.length > 0 ? ' · ' : null}
            {facts.sdgGoals.length > 0 ? <span>UN SDG {facts.sdgGoals.join(', ')}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
