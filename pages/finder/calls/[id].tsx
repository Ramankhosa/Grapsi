import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  FaArrowLeft,
  FaCalendarAlt,
  FaExternalLinkAlt,
  FaGlobe,
  FaMapMarkerAlt,
} from 'react-icons/fa'

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
        <span key={value} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
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
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="text-sm leading-7 text-slate-700">{value || <p>Not specified.</p>}</div>
    </div>
  )
}

function RulePreviewList({ items, emptyText = 'Not available.' }: { items?: FundingRulePreview[] | null; emptyText?: string }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-sm text-slate-600">{emptyText}</p>
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.key || 'rule'}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-medium text-slate-900">{item.text}</div>
          {item.importance ? (
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
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
    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">{title}</summary>
      <pre className="mt-4 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
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
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading funding call...</div>
  }

  if (error || !call) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-12">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Funding call unavailable</div>
          <p className="mt-3 text-sm text-slate-600">{error || 'The funding call could not be loaded.'}</p>
          <Link href={finderBackHref} className="mt-6 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <Head>
        <title>{call.title || 'Funding Call'} | Grapsi</title>
      </Head>

      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link href={finderBackHref} className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 hover:text-emerald-950">
            <FaArrowLeft />
            Back to Finder
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/funding/intelligence/idea/new?callId=${encodeURIComponent(call.id)}`}
              className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800"
            >
              Validate an idea against this call
            </Link>
            {(call.catalogStatus === 'PUBLISHED' || call.status === 'PUBLISHED') ? (
              <button
                type="button"
                onClick={() => void handleStartGrantPrep()}
                disabled={startingGrantPrep}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {startingGrantPrep ? 'Opening Grant Prep...' : 'Write Grant'}
              </button>
            ) : null}
            {officialSourceUrl ? (
              <a
                href={officialSourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Official Source
                <FaExternalLinkAlt className="text-xs" />
              </a>
            ) : null}
          </div>
        </div>

        <section className="rounded-[32px] border border-white/80 bg-white/85 p-8 shadow-[0_28px_80px_rgba(15,23,42,0.10)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">
            {call.agencyName || 'Funding Call'}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {call.title}
          </h1>
          <p className="mt-4 max-w-4xl text-base leading-8 text-slate-600">
            {call.description || call.summary || 'No description available.'}
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"><FaCalendarAlt /> Deadline</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{call.isRolling ? 'Rolling' : formatDate(call.deadlineAt) || 'Not specified'}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"><FaGlobe /> Geography</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{geography || 'Not specified'}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"><FaMapMarkerAlt /> Sponsor</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{call.agencyName || labelize(call.sponsorTypeLabel || call.sponsorType) || 'Not specified'}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Funding</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{formatAmount(call) || 'Not specified'}</div>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Basic Information</h2>
            <div className="mt-5 grid gap-5 text-sm leading-7 text-slate-700 md:grid-cols-2">
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

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Eligibility and Fit</h2>
            <div className="mt-5 space-y-5 text-sm leading-7 text-slate-700">
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

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Focus and Deliverables</h2>
            <div className="mt-5 space-y-5 text-sm leading-7 text-slate-700">
              <DefinitionItem label="Funding Kinds" value={chips(call.fundingKinds) || null} />
              <DefinitionItem label="Disciplines" value={chips(call.disciplines) || null} />
              <DefinitionItem label="Expected Deliverables" value={call.expectedDeliverablesText ? <p>{call.expectedDeliverablesText}</p> : null} />
            </div>
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Links and Source Data</h2>
            <div className="mt-5 space-y-5 text-sm leading-7 text-slate-700">
              <DefinitionItem
                label="Official URLs"
                value={(call.officialUrls || []).length ? (
                  <div className="space-y-2">
                    {(call.officialUrls || []).map((url: string) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="block break-all text-emerald-700 hover:text-emerald-900">
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

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold text-slate-950">Template Workspace</h2>
            {templateWorkspace ? (
              <div className="mt-5 space-y-6">
                <div className="text-sm text-slate-600">Workspace ID: <span className="font-medium text-slate-900">{templateWorkspace.id}</span></div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{labelize(templateWorkspace.status) || 'none'}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Revision</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{templateWorkspace.currentRevisionNo ?? 'Not specified'}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sections / Questions</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">
                      {templateWorkspace.topLevelSectionCount ?? 0} sections · {templateWorkspace.questionCount ?? 0} questions
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Assets / Revisions</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">
                      {templateWorkspace.assetCount ?? 0} assets · {templateWorkspace.revisionCount ?? 0} revisions
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Top-level Template Sections</div>
                    {(templateWorkspace.sectionOutline || []).length ? (
                      <div className="grid gap-3">
                        {(templateWorkspace.sectionOutline || []).map((section) => (
                          <div key={section.key} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-sm font-semibold text-slate-900">{section.label}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{section.key}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600">No template sections stored.</p>
                    )}
                  </div>
                  <div className="grid gap-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attachments</div>
                      <div className="mt-2 text-sm font-semibold text-slate-950">{templateWorkspace.attachmentCount ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Submission Rules</div>
                      <div className="mt-2 text-sm font-semibold text-slate-950">{templateWorkspace.submissionRuleCount ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Evaluation Criteria</div>
                      <div className="mt-2 text-sm font-semibold text-slate-950">{templateWorkspace.evaluationCriteriaCount ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Compiled Template</div>
                      <div className="mt-2 text-sm font-semibold text-slate-950">{templateWorkspace.hasCompiledTemplate ? 'Available' : 'Not generated'}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-600">No template workspace is stored for this call yet.</p>
            )}
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold text-slate-950">Guideline Workspace</h2>
            {guidelineWorkspace ? (
              <div className="mt-5 space-y-6">
                <div className="text-sm text-slate-600">Workspace ID: <span className="font-medium text-slate-900">{guidelineWorkspace.id}</span></div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{labelize(guidelineWorkspace.status) || 'none'}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Revision</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{guidelineWorkspace.currentRevisionNo ?? 'Not specified'}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Priorities / Must Address</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">
                      {guidelineWorkspace.priorityCount ?? 0} priorities · {guidelineWorkspace.mustAddressCount ?? 0} must address
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Signals / Criteria</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">
                      {guidelineWorkspace.reviewerSignalCount ?? 0} reviewer signals · {guidelineWorkspace.evaluationCriteriaCount ?? 0} criteria
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Priorities</div>
                    <RulePreviewList items={guidelineWorkspace.prioritiesPreview} />
                  </div>
                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Must Address</div>
                    <RulePreviewList items={guidelineWorkspace.mustAddressPreview} />
                  </div>
                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Evaluation Criteria</div>
                    <RulePreviewList items={guidelineWorkspace.evaluationCriteriaPreview} />
                  </div>
                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reviewer Signals</div>
                    <RulePreviewList items={guidelineWorkspace.reviewerSignalsPreview} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-950">
                    Budget Rules: {guidelineWorkspace.budgetRuleCount ?? 0}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-950">
                    Duration Rules: {guidelineWorkspace.durationRuleCount ?? 0}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-950">
                    Deliverables: {guidelineWorkspace.deliverableRuleCount ?? 0}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-950">
                    Submission: {guidelineWorkspace.submissionRuleCount ?? 0}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-950">
                    Avoid / Format: {(guidelineWorkspace.avoidCount ?? 0) + (guidelineWorkspace.formatRuleCount ?? 0)}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-600">No guideline workspace is stored for this call yet.</p>
            )}
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold text-slate-950">Stored Data</h2>
            <p className="mt-2 text-sm text-slate-600">
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
