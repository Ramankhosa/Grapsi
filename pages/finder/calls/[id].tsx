import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { ArrowLeft, CalendarDays, ExternalLink, Globe2, MapPin } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'

type FundingRulePreview = {
  key?: string | null
  text?: string | null
  importance?: string | null
}

type FundingWorkspaceSummary = {
  id: string
  status?: string | null
  currentRevisionNo?: number | null
  revisionCount?: number
  runCount?: number
  assetCount?: number
  topLevelSectionCount?: number
  questionCount?: number
  attachmentCount?: number
  submissionRuleCount?: number
  evaluationCriteriaCount?: number
  hasCompiledTemplate?: boolean
  sectionOutline?: Array<{ key: string; label: string }>
  rawJson?: Record<string, unknown> | null
  summaryJson?: Record<string, unknown> | null
  priorityCount?: number
  mustAddressCount?: number
  reviewerSignalCount?: number
  avoidCount?: number
  budgetRuleCount?: number
  durationRuleCount?: number
  deliverableRuleCount?: number
  formatRuleCount?: number
  prioritiesPreview?: FundingRulePreview[]
  mustAddressPreview?: FundingRulePreview[]
  evaluationCriteriaPreview?: FundingRulePreview[]
  reviewerSignalsPreview?: FundingRulePreview[]
}

type FundingCallBundle = {
  call: Record<string, any>
  templateWorkspace?: FundingWorkspaceSummary | null
  guidelineWorkspace?: FundingWorkspaceSummary | null
}

function formatDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatAmount(call: Record<string, any>) {
  const amountMin = call.amountMin ?? call.amount_min ?? null
  const amountMax = call.amountMax ?? call.amount_max ?? null
  if (amountMin == null && amountMax == null) return null
  const currency = call.currency ? `${call.currency} ` : ''
  if (amountMin != null && amountMax != null) {
    return `${currency}${Number(amountMin).toLocaleString()} to ${currency}${Number(amountMax).toLocaleString()}`
  }
  const value = amountMin ?? amountMax
  return `${currency}${Number(value).toLocaleString()}`
}

function chips(values?: string[] | null) {
  if (!Array.isArray(values) || values.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className="cb-badge">
          {value}
        </span>
      ))}
    </div>
  )
}

function labelize(value?: string | null) {
  if (!value) return null
  return value.replace(/_/g, ' ')
}

function DefinitionItem({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div>
      <div className="mb-2 cb-eyebrow">{label}</div>
      <div className="text-[13px] leading-6 text-muted">{value || <p>Not specified.</p>}</div>
    </div>
  )
}

function RulePreviewList({ items, emptyText = 'Not available.' }: { items?: FundingRulePreview[] | null; emptyText?: string }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-[13px] text-muted">{emptyText}</p>
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.key || 'rule'}-${index}`} className="cb-card-inset px-4 py-3">
          <div className="text-[13px] font-medium text-ink">{item.text}</div>
          {item.importance ? (
            <div className="mt-0.5 text-[12px] text-muted">
              Importance: {labelize(item.importance)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  if (!value) {
    return null
  }

  return (
    <details className="cb-card-inset p-4">
      <summary className="cursor-pointer text-[13px] font-medium text-ink">{title}</summary>
      <pre className="mt-3 overflow-auto rounded-lg bg-ink p-4 text-[12px] leading-6 text-white">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

export default function FundingCallDetailsPage() {
  const router = useRouter()
  const { id } = router.query
  const projectId = typeof router.query.projectId === 'string' ? router.query.projectId : null
  const { user, isLoading, authFetch } = useAuth()
  const [details, setDetails] = useState<FundingCallBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingGrantPrep, setStartingGrantPrep] = useState(false)

  const isAdmin = useMemo(
    () => Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.roles?.includes('SUPER_ADMIN_VIEWER')),
    [user]
  )

  const call = details?.call || null
  const templateWorkspace = details?.templateWorkspace || null
  const guidelineWorkspace = details?.guidelineWorkspace || null
  const finderBackHref = projectId ? `/finder?projectId=${encodeURIComponent(projectId)}` : '/finder'

  useEffect(() => {
    if (!isLoading && !user) {
      const callbackUrl = typeof router.asPath === 'string' ? router.asPath : '/finder'
      router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
    }
  }, [isLoading, router, user])

  useEffect(() => {
    if (!user || typeof id !== 'string') return

    let active = true
    setLoading(true)
    setError(null)

    authFetch(`/api/funding/calls/${id}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload?.error || payload?.message || 'Failed to load funding call')
        }
        if (active) {
          setDetails(payload)
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load funding call')
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [authFetch, id, user])

  async function handleStartGrantPrep() {
    if (!call?.id) return

    setStartingGrantPrep(true)
    setError(null)
    try {
      const response = await authFetch(
        projectId
          ? `/api/projects/${encodeURIComponent(projectId)}/grants`
          : `/api/funding/calls/${encodeURIComponent(call.id)}/start-grant-prep`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            engagementMode: 'guided',
            ...(projectId ? { fundingCallId: call.id } : {}),
          }),
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Failed to start grant prep')
      }
      await router.push(payload.launchUrl || payload.prepUrl || (projectId ? `/projects/${projectId}/grants` : '/projects'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start grant prep')
    } finally {
      setStartingGrantPrep(false)
    }
  }

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-inset">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-cobalt-600 border-t-transparent" />
      </div>
    )
  }

  if (error || !call) {
    return (
      <div className="min-h-screen bg-inset px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-ground p-6">
          <div className="cb-title">Funding call unavailable</div>
          <p className="mt-2 text-[13px] text-muted">{error || 'The funding call could not be loaded.'}</p>
          <Link href={finderBackHref} className="cb-btn-primary mt-5">
            Back to Finder
          </Link>
        </div>
      </div>
    )
  }

  const officialSourceUrl = call.officialUrls?.[0] || call.sourceUrl || null
  const geography = call.geography || call.geographyScope || null
  const templateReadyText = call.templateStatus || call.template_status || 'none'
  const guidelineReadyText = call.guidelineStatus || call.guideline_status || 'none'

  return (
    <div className="cb-page min-h-screen bg-inset px-4 py-6 text-ink sm:px-6 lg:px-8">
      <Head>
        <title>{call.title || 'Funding Call'} | Grapsi</title>
      </Head>

      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href={finderBackHref} className="cb-btn-ghost cb-btn-sm -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Finder
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {(call.catalogStatus === 'PUBLISHED' || call.status === 'PUBLISHED') ? (
              <button
                type="button"
                onClick={() => void handleStartGrantPrep()}
                disabled={startingGrantPrep}
                className="cb-btn-primary cb-btn-sm"
              >
                {startingGrantPrep ? 'Opening Grant Prep…' : 'Write grant'}
              </button>
            ) : null}
            <Link
              href={`/funding/intelligence/idea/new?callId=${encodeURIComponent(call.id)}`}
              className="cb-btn-secondary cb-btn-sm"
            >
              Validate an idea
            </Link>
            {officialSourceUrl ? (
              <a href={officialSourceUrl} target="_blank" rel="noreferrer" className="cb-btn-ghost cb-btn-sm">
                Official source
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        </div>

        <section className="cb-card p-5 sm:p-6">
          <div className="cb-eyebrow">{call.agencyName || 'Funding call'}</div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
            {call.title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            {call.description || call.summary || 'No description available.'}
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="cb-card-inset p-4">
              <div className="cb-eyebrow flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Deadline</div>
              <div className="mt-1.5 text-[13px] font-medium text-ink">{call.isRolling ? 'Rolling' : formatDate(call.deadlineAt) || 'Not specified'}</div>
            </div>
            <div className="cb-card-inset p-4">
              <div className="cb-eyebrow flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" /> Geography</div>
              <div className="mt-1.5 text-[13px] font-medium text-ink">{geography || 'Not specified'}</div>
            </div>
            <div className="cb-card-inset p-4">
              <div className="cb-eyebrow flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Sponsor</div>
              <div className="mt-1.5 text-[13px] font-medium text-ink">{call.agencyName || labelize(call.sponsorTypeLabel || call.sponsorType) || 'Not specified'}</div>
            </div>
            <div className="cb-card-inset p-4">
              <div className="cb-eyebrow">Funding</div>
              <div className="mt-1.5 text-[13px] font-medium text-ink">{formatAmount(call) || 'Not specified'}</div>
            </div>
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="cb-card p-4 sm:p-5">
            <h2 className="cb-title">Basic Information</h2>
            <div className="mt-5 grid gap-5 text-[13px] leading-6 text-muted md:grid-cols-2">
              <DefinitionItem label="Call ID" value={call.id} />
              <DefinitionItem label="Agency" value={call.agencyName} />
              <DefinitionItem label="Visibility" value={labelize(call.visibility)} />
              <DefinitionItem label="Catalog Status" value={labelize(call.catalogStatus || call.status)} />
              <DefinitionItem label="Funding Status" value={labelize(call.status)} />
              <DefinitionItem label="Duration" value={call.projectDurationText || 'Not specified'} />
              <DefinitionItem label="Funder Country" value={call.funderCountry} />
              <DefinitionItem label="Source Type" value={labelize(call.sourceType || call.inputType)} />
              <DefinitionItem label="Updated" value={formatDateTime(call.updatedAt)} />
            </div>
          </section>

          <section className="cb-card p-4 sm:p-5">
            <h2 className="cb-title">Eligibility and Fit</h2>
            <div className="mt-5 space-y-5 text-[13px] leading-6 text-muted">
              <DefinitionItem label="Eligible Countries" value={chips(call.eligibleCountries) || null} />
              <DefinitionItem label="Host Countries" value={chips(call.hostCountries) || null} />
              <DefinitionItem label="Institution Types" value={chips(call.institutionTypes) || null} />
              <DefinitionItem label="Citizenship Requirements" value={chips(call.citizenshipRequirements) || null} />
              <DefinitionItem label="Residency Requirements" value={chips(call.residencyRequirements) || null} />
              <DefinitionItem label="Career Stages" value={chips(call.careerStages) || null} />
              <DefinitionItem label="Application Languages" value={chips(call.applicationLanguages) || null} />
              <DefinitionItem label="Eligibility Notes" value={call.eligibilityText ? <p>{call.eligibilityText}</p> : null} />
            </div>
          </section>

          <section className="cb-card p-4 sm:p-5">
            <h2 className="cb-title">Focus and Deliverables</h2>
            <div className="mt-5 space-y-5 text-[13px] leading-6 text-muted">
              <DefinitionItem label="Funding Kinds" value={chips(call.fundingKinds) || null} />
              <DefinitionItem label="Disciplines" value={chips(call.disciplines) || null} />
              <DefinitionItem label="Expected Deliverables" value={call.expectedDeliverablesText ? <p>{call.expectedDeliverablesText}</p> : null} />
            </div>
          </section>

          <section className="cb-card p-4 sm:p-5">
            <h2 className="cb-title">Links and Source Data</h2>
            <div className="mt-5 space-y-5 text-[13px] leading-6 text-muted">
              <DefinitionItem
                label="Official URLs"
                value={(call.officialUrls || []).length ? (
                  <div className="space-y-2">
                    {(call.officialUrls || []).map((url: string) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="block break-all text-cobalt-700 hover:text-cobalt-800 hover:underline">
                        {url}
                      </a>
                    ))}
                  </div>
                ) : null}
              />
              <DefinitionItem label="Source URL" value={call.sourceUrl || null} />
              <DefinitionItem label="Contact Info" value={call.contactInfo || null} />
              <DefinitionItem label="Uploaded By" value={call.uploadedBy || null} />
              <DefinitionItem
                label="Template / Guideline Readiness"
                value={`Template: ${labelize(templateReadyText) || 'none'} | Guidelines: ${labelize(guidelineReadyText) || 'none'}`}
              />
            </div>
          </section>

          <section className="cb-card p-4 sm:p-5 lg:col-span-2">
            <h2 className="cb-title">Template Workspace</h2>
            {templateWorkspace ? (
              <div className="mt-5 space-y-6">
                <div className="text-[13px] text-muted">Workspace ID: <span className="font-medium text-ink">{templateWorkspace.id}</span></div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Status</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">{labelize(templateWorkspace.status) || 'none'}</div>
                  </div>
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Revision</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">{templateWorkspace.currentRevisionNo ?? 'Not specified'}</div>
                  </div>
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Sections / Questions</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">
                      {templateWorkspace.topLevelSectionCount ?? 0} sections · {templateWorkspace.questionCount ?? 0} questions
                    </div>
                  </div>
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Assets / Revisions</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">
                      {templateWorkspace.assetCount ?? 0} assets · {templateWorkspace.revisionCount ?? 0} revisions
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 cb-eyebrow">Top-level Template Sections</div>
                    {(templateWorkspace.sectionOutline || []).length ? (
                      <div className="grid gap-3">
                        {(templateWorkspace.sectionOutline || []).map((section) => (
                          <div key={section.key} className="cb-card-inset px-4 py-3">
                            <div className="text-[13px] font-medium text-ink">{section.label}</div>
                            <div className="mt-0.5 text-[12px] text-muted">{section.key}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13px] text-muted">No template sections stored.</p>
                    )}
                  </div>
                  <div className="grid gap-4">
                    <div className="cb-card-inset p-4">
                      <div className="cb-eyebrow">Attachments</div>
                      <div className="mt-1.5 text-[13px] font-medium text-ink">{templateWorkspace.attachmentCount ?? 0}</div>
                    </div>
                    <div className="cb-card-inset p-4">
                      <div className="cb-eyebrow">Submission Rules</div>
                      <div className="mt-1.5 text-[13px] font-medium text-ink">{templateWorkspace.submissionRuleCount ?? 0}</div>
                    </div>
                    <div className="cb-card-inset p-4">
                      <div className="cb-eyebrow">Evaluation Criteria</div>
                      <div className="mt-1.5 text-[13px] font-medium text-ink">{templateWorkspace.evaluationCriteriaCount ?? 0}</div>
                    </div>
                    <div className="cb-card-inset p-4">
                      <div className="cb-eyebrow">Compiled Template</div>
                      <div className="mt-1.5 text-[13px] font-medium text-ink">{templateWorkspace.hasCompiledTemplate ? 'Available' : 'Not generated'}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-5 text-[13px] text-muted">No template workspace is stored for this call yet.</p>
            )}
          </section>

          <section className="cb-card p-4 sm:p-5 lg:col-span-2">
            <h2 className="cb-title">Guideline Workspace</h2>
            {guidelineWorkspace ? (
              <div className="mt-5 space-y-6">
                <div className="text-[13px] text-muted">Workspace ID: <span className="font-medium text-ink">{guidelineWorkspace.id}</span></div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Status</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">{labelize(guidelineWorkspace.status) || 'none'}</div>
                  </div>
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Revision</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">{guidelineWorkspace.currentRevisionNo ?? 'Not specified'}</div>
                  </div>
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Priorities / Must Address</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">
                      {guidelineWorkspace.priorityCount ?? 0} priorities · {guidelineWorkspace.mustAddressCount ?? 0} must address
                    </div>
                  </div>
                  <div className="cb-card-inset p-4">
                    <div className="cb-eyebrow">Signals / Criteria</div>
                    <div className="mt-1.5 text-[13px] font-medium text-ink">
                      {guidelineWorkspace.reviewerSignalCount ?? 0} reviewer signals · {guidelineWorkspace.evaluationCriteriaCount ?? 0} criteria
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 cb-eyebrow">Priorities</div>
                    <RulePreviewList items={guidelineWorkspace.prioritiesPreview} />
                  </div>
                  <div>
                    <div className="mb-3 cb-eyebrow">Must Address</div>
                    <RulePreviewList items={guidelineWorkspace.mustAddressPreview} />
                  </div>
                  <div>
                    <div className="mb-3 cb-eyebrow">Evaluation Criteria</div>
                    <RulePreviewList items={guidelineWorkspace.evaluationCriteriaPreview} />
                  </div>
                  <div>
                    <div className="mb-3 cb-eyebrow">Reviewer Signals</div>
                    <RulePreviewList items={guidelineWorkspace.reviewerSignalsPreview} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-5">
                  <div className="cb-card-inset p-4 text-[13px] font-medium text-ink">
                    Budget Rules: {guidelineWorkspace.budgetRuleCount ?? 0}
                  </div>
                  <div className="cb-card-inset p-4 text-[13px] font-medium text-ink">
                    Duration Rules: {guidelineWorkspace.durationRuleCount ?? 0}
                  </div>
                  <div className="cb-card-inset p-4 text-[13px] font-medium text-ink">
                    Deliverables: {guidelineWorkspace.deliverableRuleCount ?? 0}
                  </div>
                  <div className="cb-card-inset p-4 text-[13px] font-medium text-ink">
                    Submission: {guidelineWorkspace.submissionRuleCount ?? 0}
                  </div>
                  <div className="cb-card-inset p-4 text-[13px] font-medium text-ink">
                    Avoid / Format: {(guidelineWorkspace.avoidCount ?? 0) + (guidelineWorkspace.formatRuleCount ?? 0)}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-5 text-[13px] text-muted">No guideline workspace is stored for this call yet.</p>
            )}
          </section>

          <section className="cb-card p-4 sm:p-5 lg:col-span-2">
            <h2 className="cb-title">Stored Data</h2>
            <p className="mt-2 text-[13px] text-muted">
              These panels show the stored funding-call record and any attached guideline/template JSON so you can verify what exists in the database.
            </p>
            <div className="mt-5 space-y-4">
              <JsonPanel title="Funding Call Payload" value={call} />
              <JsonPanel title="Template JSON" value={templateWorkspace?.rawJson || null} />
              <JsonPanel title="Guideline JSON" value={guidelineWorkspace?.rawJson || null} />
              {isAdmin ? <JsonPanel title="Guideline Summary JSON" value={guidelineWorkspace?.summaryJson || null} /> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
