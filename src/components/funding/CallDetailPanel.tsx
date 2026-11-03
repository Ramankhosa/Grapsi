'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, CalendarDays, Copy, ExternalLink, Globe2, Users, Wallet } from 'lucide-react'

import WorkspaceDialog from '@/components/ui/WorkspaceDialog'
import { ImportedCallFacts } from '@/components/funding/ImportedCallFacts'
import { useAuth } from '@/lib/auth-context'

type CallRecord = Record<string, any>

function formatDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatAmount(call: CallRecord) {
  const min = call.amountMin ?? call.amount_min ?? null
  const max = call.amountMax ?? call.amount_max ?? null
  if (min == null && max == null) return null
  const currency = call.currency ? `${call.currency} ` : ''
  if (min != null && max != null && Number(min) !== Number(max)) return `${currency}${Number(min).toLocaleString()} – ${Number(max).toLocaleString()}`
  return `${currency}${Number(min ?? max).toLocaleString()}`
}

function Chips({ values }: { values?: string[] | null }) {
  if (!Array.isArray(values) || values.length === 0) return <span className="text-slate-400">Not stated</span>
  return <div className="flex flex-wrap gap-1.5">{values.map((value) => <span key={value} className="cb-badge">{value}</span>)}</div>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === false || children === '') return null
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[12px] font-medium text-slate-500">{label}</dt>
      <dd className="text-[13px] leading-6 text-slate-700">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 pt-4">
      <h3 className="cb-eyebrow mb-3">{title}</h3>
      <dl className="space-y-3">{children}</dl>
    </section>
  )
}

/**
 * A funding call read in place: deadline, award, who can apply, research focus
 * and the official links, without leaving the list it was found in. Reads the
 * same access-checked endpoint as the full page.
 */
export default function CallDetailPanel({
  callId,
  fallbackTitle,
  onClose,
  onFindPeople,
}: {
  callId: string
  fallbackTitle?: string
  onClose: () => void
  /** Offered when the reader can look for colleagues aligned with this call. */
  onFindPeople?: (call: { id: string; title: string }) => void
}) {
  const { authFetch } = useAuth()
  const [call, setCall] = useState<CallRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setCall(null)
    setError(null)
    ;(async () => {
      try {
        const response = await authFetch(`/api/funding/calls/${encodeURIComponent(callId)}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.call) throw new Error(payload.error || 'This call could not be loaded.')
        if (!cancelled) setCall(payload.call)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'This call could not be loaded.')
      }
    })()
    return () => { cancelled = true }
  }, [authFetch, callId, retry])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const title = call?.title || call?.schemeTitle || fallbackTitle || 'Funding call'
  const fullPage = `/finder/calls/${encodeURIComponent(callId)}`
  const official = call?.officialUrls?.[0] || call?.sourceUrl || null
  const imported = call?.catalogImport || null
  const deadline = call?.isRolling ? 'Rolling — applications accepted year-round'
    : formatDate(imported?.entryClosesAt || call?.deadlineAt || call?.closeDate) || 'Not stated — check the funder guidance'
  const finalDeadline = imported?.finalDeadlineAt && imported.finalDeadlineAt !== imported.entryClosesAt ? formatDate(imported.finalDeadlineAt) : null

  async function copyLink() {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${fullPage}`)
      setCopied(true)
    } catch { setCopyError('This browser could not copy the link. Open the full page and copy its address.') }
  }

  return (
    <WorkspaceDialog open onOpenChange={(open) => { if (!open) onClose() }} title={title}
      description={call?.agencyName || undefined} sheet sheetWidth="w-[min(96vw,600px)]">
      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-800">{error}<button type="button" className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
      ) : !call ? (
        <div role="status" aria-label="Loading call" className="animate-pulse space-y-3">
          <div className="h-16 rounded-xl bg-slate-100" /><div className="h-3 w-4/5 rounded bg-slate-100" /><div className="h-3 w-3/5 rounded bg-slate-100" />
        </div>
      ) : (
        <div className="min-w-0">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3.5">
              <div className="flex items-center gap-1.5 text-[12px] text-slate-500"><CalendarDays className="h-3.5 w-3.5" />Entry deadline</div>
              <div className="mt-1 text-[13px] font-semibold text-slate-900">{deadline}</div>
              {finalDeadline ? <div className="mt-0.5 text-[12px] text-slate-500">Final deadline {finalDeadline}</div> : null}
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <div className="flex items-center gap-1.5 text-[12px] text-slate-500"><Wallet className="h-3.5 w-3.5" />Funding</div>
              <div className="mt-1 text-[13px] font-semibold text-slate-900">{formatAmount(call) || 'Amount not stated'}</div>
            </div>
          </div>

          <p className="mt-4 whitespace-pre-line text-[13px] leading-6 text-slate-600">
            {call.description || call.summary || 'No description available.'}
          </p>

          {imported ? <div className="mt-4"><ImportedCallFacts facts={imported} promotedToDsr={call.visibility === 'GLOBAL_PUBLISHED'} /></div> : null}

          <div className="mt-4 space-y-4">
            <Section title="Who can apply">
              <Row label="Open to applicants from"><Chips values={call.eligibleCountries} /></Row>
              <Row label="Citizenship"><Chips values={call.citizenshipRequirements} /></Row>
              <Row label="Residence"><Chips values={call.residencyRequirements} /></Row>
              <Row label="Work carried out in"><Chips values={call.hostCountries} /></Row>
              <Row label="Career stage"><Chips values={call.careerStages} /></Row>
              <Row label="Applying organisation"><Chips values={call.institutionTypes} /></Row>
              <Row label="Application language"><Chips values={call.applicationLanguages} /></Row>
              <Row label="Eligibility notes">{call.eligibilityText ? <span className="whitespace-pre-line">{call.eligibilityText}</span> : null}</Row>
            </Section>
            <Section title="Research and funding">
              <Row label="Funding type"><Chips values={call.fundingKinds} /></Row>
              <Row label="Disciplines"><Chips values={call.disciplines} /></Row>
              <Row label="Project length">{call.projectDurationText || null}</Row>
              <Row label="Geographic scope">{call.geography || call.geographyScope ? <span className="inline-flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5 text-slate-400" />{call.geography || call.geographyScope}</span> : null}</Row>
              <Row label="Funder country">{call.funderCountry || null}</Row>
              <Row label="Deliverables">{call.expectedDeliverablesText || null}</Row>
            </Section>
            <Section title="Links and contact">
              <Row label="Official pages">{(call.officialUrls || []).length ? (
                <span className="block space-y-1">{(call.officialUrls as string[]).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block break-all text-cobalt-700 hover:underline">{url}</a>
                ))}</span>) : null}</Row>
              <Row label="Contact">{call.contactInfo || null}</Row>
            </Section>
          </div>

          {copyError && <p role="status" className="mt-4 text-sm text-amber-800">{copyError}</p>}
          <div className="sticky -bottom-5 -mx-5 -mb-5 mt-6 flex flex-wrap gap-2 border-t border-slate-200 bg-white px-5 py-3">
            {onFindPeople ? (
              <button type="button" className="cb-btn-primary cb-btn-sm" onClick={() => onFindPeople({ id: callId, title })}>
                <Users className="h-3.5 w-3.5" />Find aligned people
              </button>
            ) : null}
            <a href={fullPage} target="_blank" rel="noreferrer" className="cb-btn-secondary cb-btn-sm">Open full page<ArrowUpRight className="h-3.5 w-3.5" /></a>
            {official ? <a href={official} target="_blank" rel="noreferrer" className="cb-btn-ghost cb-btn-sm">Official source<ExternalLink className="h-3.5 w-3.5" /></a> : null}
            <button type="button" className="cb-btn-ghost cb-btn-sm" onClick={() => void copyLink()}><Copy className="h-3.5 w-3.5" />{copied ? 'Link copied' : 'Copy link'}</button>
          </div>
        </div>
      )}
    </WorkspaceDialog>
  )
}
