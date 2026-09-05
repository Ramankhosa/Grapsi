'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import BudgetGrid from '@/components/proposals/BudgetGrid'
import ChecklistPanel from '@/components/proposals/ChecklistPanel'
import FollowUpPanel from '@/components/proposals/FollowUpPanel'
import LetterList from '@/components/proposals/LetterList'
import PostAwardPanel from '@/components/proposals/PostAwardPanel'
import ProposalHistory from '@/components/proposals/ProposalHistory'
import ProposalStatusChip from '@/components/proposals/ProposalStatusChip'
import ReviewRunPanel from '@/components/proposals/ReviewRunPanel'
import TeamEditor from '@/components/proposals/TeamEditor'
import VersionList from '@/components/proposals/VersionList'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import type { BudgetHead } from '@/lib/proposals/shared'

/**
 * The officer's workbench for one application.
 *
 * Everything the applicant sees, plus the parts that are the department's:
 * the internal note, the cut-off, clearing it for submission, and what the
 * agency said afterwards.
 */

type Tab = 'work' | 'versions' | 'letters' | 'team' | 'record'

interface Dossier {
  proposal: any
  versions: any[]
  reviews: any[]
  team: any[]
  budget: any[]
  documents: any[]
  checklist: any[]
  milestones: any[]
  followUps: any[]
  outstandingRequired: string[]
  nextAction: { actor: string; text: string }
  lens: string
  settings: {
    budgetHeads: BudgetHead[]
    aiReviewEnabled: boolean
    budgetEnabled: boolean
    endorsementEnabled: boolean
    checklistEnabled: boolean
    postAwardEnabled: boolean
    teamEnabled: boolean
    agencyTrackingEnabled: boolean
    cutoffEnabled: boolean
    facultyMayRecordSubmission: boolean
  }
  capabilities: Record<string, boolean>
}

function toDateInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export default function ProposalWorkbenchPage({ params }: { params: { id: string } }) {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()

  const [data, setData] = useState<Dossier | null>(null)
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('work')
  const [busy, setBusy] = useState(false)

  const [cutoff, setCutoff] = useState('')
  const [note, setNote] = useState('')
  const [noteVisible, setNoteVisible] = useState(false)
  const [clearReason, setClearReason] = useState('')
  const [agencyStatus, setAgencyStatus] = useState('UNDER_AGENCY_REVIEW')
  const [agencyNote, setAgencyNote] = useState('')
  const [sanctionAmount, setSanctionAmount] = useState('')
  const [sanctionRef, setSanctionRef] = useState('')

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
      setCutoff(toDateInput(dossier.proposal.reviewCutoffAt))
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

  async function patch(body: Record<string, unknown>, successTitle: string) {
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not save.')
      showToast({ type: 'success', title: successTitle })
      await load()
    } catch (patchError: any) {
      showToast({ type: 'error', title: 'Could not save', description: patchError?.message })
    } finally {
      setBusy(false)
    }
  }

  async function transition(body: Record<string, unknown>, successTitle: string) {
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${params.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not update the status.')
      showToast({ type: 'success', title: successTitle })
      setClearReason('')
      await load()
    } catch (statusError: any) {
      showToast({ type: 'error', title: 'Could not update', description: statusError?.message })
    } finally {
      setBusy(false)
    }
  }

  async function addNote() {
    if (!note.trim()) return
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${params.id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim(), visibleToFaculty: noteVisible }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not save the note.')
      setNote('')
      setEvents(payload.events || [])
      showToast({ type: 'success', title: noteVisible ? 'Note sent to the researcher' : 'Internal note saved' })
    } catch (noteError: any) {
      showToast({ type: 'error', title: 'Could not save', description: noteError?.message })
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-5xl px-4 py-10">
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
        <div className="mx-auto max-w-5xl px-4 py-10">
          <div className="nk-panel p-6">
            <h1 className="nk-title text-lg">Proposal not available</h1>
            <p className="nk-sub mt-2">{error || 'This proposal could not be loaded.'}</p>
            <Link href="/funding-dept/proposals" className="nk-btn-secondary nk-btn-sm mt-4 inline-flex">
              Back to the desk
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const { proposal, capabilities, settings } = data
  const canManage = Boolean(capabilities.canManage)

  return (
    <main className="nk-ground nk-wash">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/funding-dept/proposals" className="nk-hint text-xs hover:underline">
          ← Proposal desk
        </Link>

        <header className="mt-3 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="nk-title text-xl leading-snug">{proposal.title}</h1>
              <p className="nk-sub mt-1">
                {proposal.pi?.name || proposal.pi?.email} · {proposal.agencyName}
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

        <nav className="mb-5 flex flex-wrap gap-2" aria-label="Sections">
          {(
            [
              { key: 'work', label: 'Work' },
              { key: 'versions', label: `Drafts (${data.versions.length})` },
              ...(settings.endorsementEnabled || settings.checklistEnabled
                ? [{ key: 'letters', label: 'Letters & checks' }]
                : []),
              // Absent rather than empty when the institution captures neither.
              ...(settings.teamEnabled || settings.budgetEnabled
                ? [
                    {
                      key: 'team',
                      label:
                        settings.teamEnabled && settings.budgetEnabled
                          ? 'Team & budget'
                          : settings.teamEnabled
                            ? 'Team'
                            : 'Budget',
                    },
                  ]
                : []),
              { key: 'record', label: 'Record' },
            ] as Array<{ key: Tab; label: string }>
          ).map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={tab === entry.key ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        {tab === 'work' && (
          <div className="space-y-4">
            {canManage && settings.cutoffEnabled && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-3">Cut-off for new drafts</h2>
                <p className="nk-hint mb-3 text-xs">
                  After this date the researcher cannot upload another draft without you accepting it
                  explicitly. Moving it restarts the reminders.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <input
                    type="date"
                    className="nk-input"
                    value={cutoff}
                    onChange={(event) => setCutoff(event.target.value)}
                  />
                  <button
                    type="button"
                    className="nk-btn-secondary nk-btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void patch({ reviewCutoffAt: cutoff || null }, 'Cut-off saved')
                    }
                  >
                    Save cut-off
                  </button>
                </div>
              </section>
            )}

            {canManage && ['DRAFT', 'IN_REVIEW'].includes(proposal.status) && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-2">Clear for submission</h2>
                <p className="nk-hint mb-3 text-xs">
                  Clearing tells the researcher the department is satisfied and they may submit.
                </p>
                {(data.outstandingRequired || []).length > 0 && (
                  <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-medium text-amber-900">
                      Still outstanding on the checklist
                    </p>
                    <ul className="mt-1 list-disc pl-4 text-xs text-amber-800">
                      {data.outstandingRequired.map((label: string) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <input
                  className="nk-input mb-3 w-full"
                  placeholder={
                    settings.aiReviewEnabled
                      ? 'Reason (needed only if no review has been shared)'
                      : 'Note (optional)'
                  }
                  value={clearReason}
                  maxLength={500}
                  onChange={(event) => setClearReason(event.target.value)}
                />
                <button
                  type="button"
                  className="nk-btn-primary nk-btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void transition(
                      { to: 'CLEARED', overrideReason: clearReason.trim() || null },
                      'Cleared for submission'
                    )
                  }
                >
                  Clear this proposal
                </button>
              </section>
            )}

            {canManage && proposal.status === 'CLEARED' && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-2">Reopen for another draft</h2>
                <p className="nk-hint mb-3 text-xs">
                  Puts it back with the department so the researcher can upload again.
                </p>
                <button
                  type="button"
                  className="nk-btn-secondary nk-btn-sm"
                  disabled={busy}
                  onClick={() => void transition({ to: 'IN_REVIEW' }, 'Reopened')}
                >
                  Reopen
                </button>
              </section>
            )}

            <section className="nk-panel p-5">
              <h2 className="nk-label mb-3">Follow-up with the researcher</h2>
              <FollowUpPanel
                proposalId={params.id}
                followUps={data.followUps || []}
                currentStatus={proposal.status}
                canTrackAgency={Boolean(capabilities.canTrackAgency)}
                onChanged={load}
              />
            </section>

            <section className="nk-panel p-5">
              <h2 className="nk-label mb-3">Notes</h2>
              <textarea
                className="nk-input w-full"
                rows={3}
                placeholder="What happened, what you told them, what you are waiting for"
                value={note}
                maxLength={5000}
                onChange={(event) => setNote(event.target.value)}
              />
              <label className="mt-2 flex items-center gap-2 text-sm text-nickel-700">
                <input
                  type="checkbox"
                  checked={noteVisible}
                  onChange={(event) => setNoteVisible(event.target.checked)}
                />
                The researcher can read this
              </label>
              <button
                type="button"
                className="nk-btn-primary nk-btn-sm mt-3"
                disabled={busy || !note.trim()}
                onClick={() => void addNote()}
              >
                Save note
              </button>
            </section>

            <section className="nk-panel p-5">
              <h2 className="nk-label mb-3">History</h2>
              <ProposalHistory events={events} />
            </section>
          </div>
        )}

        {tab === 'versions' && (
          <VersionList
            proposalId={params.id}
            versions={data.versions}
            canUpload={canManage}
            canOverrideCutoff={canManage}
            onChanged={load}
            renderVersionExtra={(version) =>
              capabilities.canRunReview ? (
                <ReviewRunPanel
                  proposalId={params.id}
                  versionId={version.id}
                  versionNo={version.versionNo}
                  reviewerCallId={proposal.reviewerCallId}
                  initialReview={
                    data.reviews.find((review: any) => review.versionId === version.id) || null
                  }
                  onChanged={load}
                />
              ) : null
            }
          />
        )}

        {tab === 'letters' && (
          <div className="space-y-6">
            {settings.endorsementEnabled && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-1">Letters issued</h2>
                <p className="nk-hint mb-3 text-xs">
                  The signed endorsement or forwarding letter the applicant attaches to their
                  submission.
                </p>
                <LetterList
                  proposalId={params.id}
                  letters={data.documents || []}
                  canIssue={Boolean(capabilities.canIssueLetter)}
                  onChanged={load}
                />
              </section>
            )}

            {settings.checklistEnabled && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-1">Before it can be cleared</h2>
                <p className="nk-hint mb-3 text-xs">
                  What this agency wants alongside the proposal itself.
                </p>
                <ChecklistPanel
                  proposalId={params.id}
                  items={data.checklist || []}
                  canEdit={Boolean(capabilities.canEditChecklist)}
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

        {tab === 'record' && (
          <div className="space-y-4">
            <section className="nk-panel p-5">
              <h2 className="nk-label mb-3">Submission</h2>
              {proposal.submittedAt ? (
                <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="nk-hint text-xs">Submitted</dt>
                    <dd className="nk-mono text-sm">
                      {new Date(proposal.submittedAt).toLocaleDateString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="nk-hint text-xs">Reference</dt>
                    <dd className="nk-mono text-sm">{proposal.submissionReference || '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="nk-sub text-sm">Not submitted yet.</p>
              )}
            </section>

            {capabilities.canTrackAgency &&
              ['SUBMITTED', 'UNDER_AGENCY_REVIEW', 'REVISION_REQUESTED'].includes(proposal.status) && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-3">Record what the agency said</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="nk-label" htmlFor="agency-status">
                      Status
                    </label>
                    <select
                      id="agency-status"
                      className="nk-select mt-1 w-full"
                      value={agencyStatus}
                      onChange={(event) => setAgencyStatus(event.target.value)}
                    >
                      <option value="UNDER_AGENCY_REVIEW">Under agency review</option>
                      <option value="REVISION_REQUESTED">Agency asked for changes</option>
                      <option value="SANCTIONED">Sanctioned</option>
                      <option value="REJECTED">Not funded</option>
                    </select>
                  </div>
                  {agencyStatus === 'SANCTIONED' && (
                    <>
                      <div>
                        <label className="nk-label" htmlFor="sanction-amount">
                          Sanctioned amount
                        </label>
                        <input
                          id="sanction-amount"
                          className="nk-input mt-1 w-full"
                          inputMode="decimal"
                          value={sanctionAmount}
                          onChange={(event) => setSanctionAmount(event.target.value)}
                        />
                      </div>
                      <div>
                        <label className="nk-label" htmlFor="sanction-ref">
                          Sanction order number
                        </label>
                        <input
                          id="sanction-ref"
                          className="nk-input mt-1 w-full"
                          value={sanctionRef}
                          onChange={(event) => setSanctionRef(event.target.value)}
                        />
                      </div>
                    </>
                  )}
                  <div className="sm:col-span-2">
                    <label className="nk-label" htmlFor="agency-note">
                      Note
                    </label>
                    <textarea
                      id="agency-note"
                      className="nk-input mt-1 w-full"
                      rows={2}
                      value={agencyNote}
                      maxLength={2000}
                      onChange={(event) => setAgencyNote(event.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="nk-btn-primary nk-btn-sm mt-3"
                  disabled={busy}
                  onClick={() =>
                    void transition(
                      {
                        to: agencyStatus,
                        agencyStatusNote: agencyNote.trim() || null,
                        ...(agencyStatus === 'SANCTIONED'
                          ? {
                              sanctionedAmount: Number(sanctionAmount) || null,
                              sanctionReference: sanctionRef.trim() || null,
                            }
                          : {}),
                      },
                      'Recorded'
                    )
                  }
                >
                  Record
                </button>
              </section>
            )}

            {settings.postAwardEnabled &&
              ['SANCTIONED', 'CLOSED'].includes(proposal.status) && (
                <section className="nk-panel p-5">
                  <h2 className="nk-label mb-1">After the sanction</h2>
                  <p className="nk-hint mb-3 text-xs">
                    Instalments, utilisation certificates and reports the agency expects. Due dates
                    here are chased for you.
                  </p>
                  <PostAwardPanel
                    proposalId={params.id}
                    milestones={data.milestones || []}
                    projectStartAt={proposal.projectStartAt ?? null}
                    projectEndAt={proposal.projectEndAt ?? null}
                    currency={proposal.currency}
                    canEdit={Boolean(capabilities.canTrackPostAward)}
                    onChanged={load}
                  />
                </section>
              )}

            {proposal.assignmentId && (
              <section className="nk-panel p-5">
                <h2 className="nk-label mb-2">Linked assignment</h2>
                <p className="nk-sub text-sm">
                  This proposal answers a call the department circulated, and its acceptance,
                  reminders and follow-ups live on that record.
                </p>
                <Link href="/funding-dept/assignments" className="nk-btn-secondary nk-btn-sm mt-3 inline-flex">
                  Open assignments
                </Link>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
