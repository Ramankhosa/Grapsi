'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import BudgetGrid from '@/components/proposals/BudgetGrid'
import ChecklistPanel from '@/components/proposals/ChecklistPanel'
import FrozenReviewReport from '@/components/proposals/FrozenReviewReport'
import LetterList from '@/components/proposals/LetterList'
import PostAwardPanel from '@/components/proposals/PostAwardPanel'
import ProposalHistory from '@/components/proposals/ProposalHistory'
import ProposalStatusChip from '@/components/proposals/ProposalStatusChip'
import TeamEditor from '@/components/proposals/TeamEditor'
import VersionList from '@/components/proposals/VersionList'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import type { BudgetHead } from '@/lib/proposals/shared'

/**
 * One proposal, as the applicant sees it.
 *
 * The same dossier the department works from, minus its internal notes and its
 * unshared review runs. Tabs rather than one long page because the four things
 * here are consulted at different moments: the drafts weekly, the budget once,
 * the reviews when one lands.
 */

type Tab = 'overview' | 'versions' | 'reviews' | 'letters' | 'team' | 'submission'

interface Dossier {
  proposal: any
  versions: any[]
  reviews: any[]
  team: any[]
  budget: any[]
  documents: any[]
  checklist: any[]
  milestones: any[]
  nextAction: { actor: string; text: string }
  lens: string
  settings: {
    budgetHeads: BudgetHead[]
    aiReviewEnabled: boolean
    budgetEnabled: boolean
    teamEnabled: boolean
    agencyTrackingEnabled: boolean
    cutoffEnabled: boolean
    endorsementEnabled: boolean
    checklistEnabled: boolean
    postAwardEnabled: boolean
    facultyMayRecordSubmission: boolean
  }
  capabilities: Record<string, boolean>
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function ProposalDetailPage({ params }: { params: { id: string } }) {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()

  const [data, setData] = useState<Dossier | null>(null)
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  const [openReportId, setOpenReportId] = useState<string | null>(null)
  const [report, setReport] = useState<any>(null)
  const [reportLoading, setReportLoading] = useState(false)

  const [submissionRef, setSubmissionRef] = useState('')
  const [submissionUrl, setSubmissionUrl] = useState('')
  const [submissionDate, setSubmissionDate] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [dossierResponse, eventsResponse] = await Promise.all([
        authFetch(`/api/proposals/${params.id}`),
        authFetch(`/api/proposals/${params.id}/events`),
      ])
      const dossier = await dossierResponse.json()
      if (!dossierResponse.ok) throw new Error(dossier?.error || 'Could not load this proposal.')
      setData(dossier)
      if (eventsResponse.ok) {
        const payload = await eventsResponse.json()
        setEvents(payload.events || [])
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load this proposal.')
    } finally {
      setLoading(false)
    }
  }, [authFetch, params.id])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  /** Fetch the frozen copy of one shared review, on demand. */
  async function openReport(reviewId: string) {
    if (openReportId === reviewId) {
      setOpenReportId(null)
      setReport(null)
      return
    }
    setOpenReportId(reviewId)
    setReport(null)
    setReportLoading(true)
    try {
      const response = await authFetch(`/api/proposals/${params.id}/reviews/${reviewId}/report`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Could not load the report.')
      setReport(payload)
    } catch (reportError: any) {
      showToast({ type: 'error', title: 'Could not open', description: reportError?.message })
      setOpenReportId(null)
    } finally {
      setReportLoading(false)
    }
  }

  async function downloadDocx(reviewId: string) {
    try {
      const response = await authFetch(`/api/proposals/${params.id}/reviews/${reviewId}/docx`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || 'Could not download the document.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'grant-review.docx'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (docxError: any) {
      showToast({ type: 'error', title: 'Download failed', description: docxError?.message })
    }
  }

  async function recordSubmission() {
    if (!submissionRef.trim() && !submissionUrl.trim()) {
      showToast({ type: 'error', title: 'Add the reference number or the portal link' })
      return
    }
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${params.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'SUBMITTED',
          submissionReference: submissionRef.trim() || null,
          submissionUrl: submissionUrl.trim() || null,
          submittedAt: submissionDate || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not record the submission.')
      showToast({ type: 'success', title: 'Submission recorded' })
      await load()
    } catch (submitError: any) {
      showToast({ type: 'error', title: 'Could not record', description: submitError?.message })
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="nk-panel p-6">
            <p className="nk-sub">Loading…</p>
          </div>
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="nk-panel p-6">
            <h1 className="nk-title text-lg">Proposal not available</h1>
            <p className="nk-sub mt-2">{error || 'This proposal could not be loaded.'}</p>
            <Link href="/proposals" className="nk-btn-secondary nk-btn-sm mt-4 inline-flex">
              Back to my proposals
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const { proposal, capabilities, settings } = data

  // A stage this institution has switched off is absent, not disabled: an
  // empty tab labelled "Budget" invites somebody to ask why it does nothing.
  const showTeamOrBudget = settings.teamEnabled || settings.budgetEnabled
  const tabs: Array<{ key: Tab; label: string; badge?: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'versions', label: 'Drafts', badge: data.versions.length ? String(data.versions.length) : undefined },
    ...(settings.aiReviewEnabled
      ? [
          {
            key: 'reviews' as Tab,
            label: 'Reviews',
            badge: data.reviews.length ? String(data.reviews.length) : undefined,
          },
        ]
      : []),
    ...(settings.endorsementEnabled || settings.checklistEnabled
      ? [
          {
            key: 'letters' as Tab,
            label: 'Letters & checks',
            badge: data.documents.length ? String(data.documents.length) : undefined,
          },
        ]
      : []),
    ...(showTeamOrBudget
      ? [
          {
            key: 'team' as Tab,
            label: settings.teamEnabled && settings.budgetEnabled
              ? 'Team & budget'
              : settings.teamEnabled
                ? 'Team'
                : 'Budget',
          },
        ]
      : []),
    { key: 'submission', label: 'Submission' },
  ]

  return (
    <main className="nk-ground nk-wash">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/proposals" className="nk-hint text-xs hover:underline">
          ← My proposals
        </Link>

        <header className="mt-3 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="nk-title text-xl leading-snug">{proposal.title}</h1>
              <p className="nk-sub mt-1">
                {proposal.agencyName}
                {proposal.schemeTitle ? ` · ${proposal.schemeTitle}` : ''}
                {proposal.school?.name ? ` · ${proposal.school.name}` : ''}
              </p>
            </div>
            <ProposalStatusChip status={proposal.status} />
          </div>

          {data.nextAction?.text && (
            <p className="nk-panel-quiet mt-4 px-3 py-2 text-sm text-nickel-800">
              <span className="nk-label mr-2">Next</span>
              {data.nextAction.text}
            </p>
          )}
        </header>

        <nav className="mb-5 flex flex-wrap gap-2" aria-label="Proposal sections">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={tab === entry.key ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'}
            >
              {entry.label}
              {entry.badge ? ` (${entry.badge})` : ''}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="nk-panel p-5">
              <h2 className="nk-label mb-3">The application</h2>
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="nk-hint text-xs">Principal investigator</dt>
                  <dd className="text-sm text-nickel-800">{proposal.pi?.name || proposal.pi?.email}</dd>
                </div>
                <div>
                  <dt className="nk-hint text-xs">Agency deadline</dt>
                  <dd className="nk-mono text-sm">{formatDate(proposal.agencyDeadlineAt)}</dd>
                </div>
                {settings.cutoffEnabled && (
                  <div>
                    <dt className="nk-hint text-xs">Department cut-off for new drafts</dt>
                    <dd className="nk-mono text-sm">{formatDate(proposal.reviewCutoffAt)}</dd>
                  </div>
                )}
                {settings.budgetEnabled && (
                  <div>
                    <dt className="nk-hint text-xs">Amount requested</dt>
                    <dd className="nk-mono text-sm">
                      {proposal.requestedAmount != null
                        ? `${proposal.currency} ${Number(proposal.requestedAmount).toLocaleString()}`
                        : '—'}
                    </dd>
                  </div>
                )}
              </dl>

              {proposal.fundingCall && (
                <p className="nk-hint mt-4 text-xs">
                  Answering{' '}
                  <Link href={`/finder/calls/${proposal.fundingCall.id}`} className="underline">
                    {proposal.fundingCall.title}
                  </Link>
                </p>
              )}
            </div>

            <div className="nk-panel p-5">
              <h2 className="nk-label mb-3">What has happened</h2>
              <ProposalHistory events={events} />
            </div>
          </div>
        )}

        {tab === 'versions' && (
          <VersionList
            proposalId={params.id}
            versions={data.versions}
            canUpload={Boolean(capabilities.canUploadVersion)}
            canOverrideCutoff={Boolean(capabilities.canManage)}
            onChanged={load}
          />
        )}

        {tab === 'reviews' && (
          <div className="space-y-3">
            {data.reviews.length === 0 ? (
              <div className="nk-panel p-6">
                <p className="nk-sub text-sm">
                  No review has been shared with you yet. The funding department will send one once
                  they have read your draft.
                </p>
              </div>
            ) : (
              data.reviews.map((review) => (
                <div key={review.id} className="nk-panel p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="nk-title text-sm">
                      Review of version {review.versionNo ?? '—'}
                    </h3>
                    {review.overallScore != null && (
                      <span className="nk-readout">{Number(review.overallScore).toFixed(1)}</span>
                    )}
                  </div>
                  {review.recommendation && (
                    <p className="nk-sub mt-1 text-sm">{review.recommendation}</p>
                  )}
                  {review.officerNote && (
                    <p className="nk-panel-quiet mt-3 p-3 text-sm text-nickel-800">
                      {review.officerNote}
                    </p>
                  )}
                  <p className="nk-hint mt-3 text-xs">
                    Shared {new Date(review.sharedAt).toLocaleString()}
                    {review.sharedBy ? ` by ${review.sharedBy}` : ''}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="nk-btn-secondary nk-btn-sm"
                      onClick={() => void openReport(review.id)}
                    >
                      {openReportId === review.id ? 'Hide the full review' : 'Read the full review'}
                    </button>
                    {review.hasDocx && (
                      <button
                        type="button"
                        className="nk-btn-ghost nk-btn-sm"
                        onClick={() => void downloadDocx(review.id)}
                      >
                        Download as Word
                      </button>
                    )}
                  </div>

                  {openReportId === review.id && (
                    <div className="mt-4 border-t border-hairline pt-4">
                      {reportLoading && <p className="nk-sub text-sm">Loading the review…</p>}
                      {report?.report && (
                        <FrozenReviewReport
                          report={report.report}
                          officerNote={report.officerNote}
                          sharedAt={report.sharedAt}
                        />
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'letters' && (
          <div className="space-y-6">
            {settings.endorsementEnabled && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-1">Letters from the department</h2>
                <p className="nk-hint mb-3 text-xs">
                  Your endorsement or forwarding letter. Download it and attach the signed copy to
                  your submission.
                </p>
                {/* Read-only on this side: the institution issues its own letters. */}
                <LetterList
                  proposalId={params.id}
                  letters={data.documents || []}
                  canIssue={false}
                  onChanged={load}
                />
              </section>
            )}

            {settings.checklistEnabled && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-1">What to send with the proposal</h2>
                <p className="nk-hint mb-3 text-xs">
                  The department ticks each line as it reaches them. Anything still outstanding holds
                  up your clearance.
                </p>
                <ChecklistPanel
                  proposalId={params.id}
                  items={data.checklist || []}
                  canEdit={false}
                  onChanged={load}
                />
              </section>
            )}
          </div>
        )}

        {tab === 'team' && (
          <div className="space-y-6">
            {settings.teamEnabled && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-3">Investigators</h2>
                <TeamEditor
                  proposalId={params.id}
                  team={data.team}
                  canEdit={Boolean(capabilities.canEditTeam)}
                  onChanged={load}
                />
              </section>
            )}

            {settings.budgetEnabled && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-3">Budget</h2>
                <BudgetGrid
                  proposalId={params.id}
                  budget={data.budget}
                  heads={settings.budgetHeads}
                  currency={proposal.currency}
                  durationMonths={proposal.durationMonths}
                  canEdit={Boolean(capabilities.canEditBudget)}
                  onChanged={load}
                />
              </section>
            )}
          </div>
        )}

        {tab === 'submission' && (
          <div className="nk-panel p-5">
            <h2 className="nk-label mb-3">Submission to the agency</h2>
            {proposal.submittedAt ? (
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="nk-hint text-xs">Submitted on</dt>
                  <dd className="nk-mono text-sm">{formatDate(proposal.submittedAt)}</dd>
                </div>
                <div>
                  <dt className="nk-hint text-xs">Reference</dt>
                  <dd className="nk-mono text-sm">{proposal.submissionReference || '—'}</dd>
                </div>
                {proposal.sanctionedAmount != null && (
                  <div>
                    <dt className="nk-hint text-xs">Sanctioned</dt>
                    <dd className="nk-mono text-sm">
                      {proposal.currency} {Number(proposal.sanctionedAmount).toLocaleString()}
                    </dd>
                  </div>
                )}
                {proposal.agencyStatusNote && (
                  <div className="sm:col-span-2">
                    <dt className="nk-hint text-xs">Latest from the agency</dt>
                    <dd className="text-sm text-nickel-800">{proposal.agencyStatusNote}</dd>
                  </div>
                )}
              </dl>
            ) : proposal.status !== 'CLEARED' ? (
              <p className="nk-sub text-sm">
                Once the funding department clears this proposal you can record the date you submitted it
                and its reference number.
              </p>
            ) : !capabilities.canRecordSubmission ? (
              <p className="nk-sub text-sm">
                Your institution records agency submissions through the funding department. Tell your
                officer once it has gone in.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="nk-sub text-sm">
                  Cleared to submit. Record it here so the department can follow the outcome.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="nk-label" htmlFor="submission-ref">
                      Reference number
                    </label>
                    <input
                      id="submission-ref"
                      className="nk-input mt-1 w-full"
                      value={submissionRef}
                      onChange={(event) => setSubmissionRef(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="nk-label" htmlFor="submission-date">
                      Date submitted
                    </label>
                    <input
                      id="submission-date"
                      type="date"
                      className="nk-input mt-1 w-full"
                      value={submissionDate}
                      onChange={(event) => setSubmissionDate(event.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="nk-label" htmlFor="submission-url">
                      Portal link (optional)
                    </label>
                    <input
                      id="submission-url"
                      className="nk-input mt-1 w-full"
                      value={submissionUrl}
                      onChange={(event) => setSubmissionUrl(event.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="nk-btn-primary nk-btn-sm"
                  disabled={busy}
                  onClick={() => void recordSubmission()}
                >
                  {busy ? 'Recording…' : 'Record submission'}
                </button>
              </div>
            )}

            {/* Post-award sits here rather than in its own tab: the certificate is
                usually the applicant's to prepare, and it is the same story as the
                submission it follows. */}
            {settings.postAwardEnabled && ['SANCTIONED', 'CLOSED'].includes(proposal.status) && (
              <div className="mt-6 border-t border-hairline pt-5">
                <h2 className="nk-label mb-1">What the agency expects next</h2>
                <p className="nk-hint mb-3 text-xs">
                  Utilisation certificates and progress reports are usually yours to prepare. The
                  department will remind you before each falls due.
                </p>
                <PostAwardPanel
                  proposalId={params.id}
                  milestones={data.milestones || []}
                  projectStartAt={proposal.projectStartAt ?? null}
                  projectEndAt={proposal.projectEndAt ?? null}
                  currency={proposal.currency}
                  canEdit={false}
                  onChanged={load}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
