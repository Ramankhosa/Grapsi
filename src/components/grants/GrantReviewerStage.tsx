'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ExternalLink, RefreshCw, RotateCcw, Save } from 'lucide-react'

type ReviewerSectionLink = {
  id?: string
  grantSectionKey: string
  grantSectionLabel: string
  sourceContentHash: string
  order: number
}

type ReviewerSection = {
  id: string
  section_title: string
  status: string
  version: number
  sourceStale?: boolean
  reviewerBucketKey?: string | null
  grant_section_links?: ReviewerSectionLink[]
}

type ReviewerState = {
  call: {
    id: string
    project_title: string
    agency_name: string
    reviewerMode?: string
  } | null
  sections: ReviewerSection[]
  diagnostics: {
    draftedSectionCount: number
    mappedSectionCount: number
    staleSectionCount: number
    rulesSource: string
  }
}

const BUCKET_OPTIONS = [
  ['summary', 'Summary / Abstract'],
  ['problem_need', 'Problem, Need & Call Fit'],
  ['objectives', 'Objectives & Specific Aims'],
  ['methodology', 'Methodology / Approach'],
  ['workplan', 'Workplan & Timeline'],
  ['budget', 'Budget & Justification'],
  ['evaluation', 'Evaluation Plan'],
  ['impact_outcomes', 'Impact & Outcomes'],
  ['team', 'Team & Capability'],
  ['sustainability_risk', 'Sustainability, Risk & Mitigation'],
  ['attachments_submission', 'Attachments & Submission Requirements'],
  ['other', 'Other Proposal Material'],
] as const

function statusClass(status: string, stale?: boolean) {
  if (stale) return 'bg-amber-100 text-amber-900'
  if (status === 'reviewed') return 'bg-emerald-100 text-emerald-800'
  if (status === 'draft') return 'bg-slate-100 text-slate-700'
  return 'bg-blue-100 text-blue-800'
}

export default function GrantReviewerStage({
  projectId,
  grantId,
  authToken,
  hasFrozenBlueprint,
  draftedSectionCount,
}: {
  projectId: string
  grantId: string
  authToken: string | null
  hasFrozenBlueprint: boolean
  draftedSectionCount: number
}) {
  const [state, setState] = useState<ReviewerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<Record<string, string>>({})

  const headers = useMemo(() => ({
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    'Content-Type': 'application/json',
  }), [authToken])

  const loadState = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/reviewer`, {
        headers,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to load reviewer state')
      }
      setState(payload)
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load reviewer state')
    } finally {
      setLoading(false)
    }
  }, [grantId, headers, projectId])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const refreshReviewer = useCallback(async (createRevisions = false) => {
    try {
      setRefreshing(true)
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/reviewer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ createRevisions }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to prepare reviewer mappings')
      }
      setState(payload)
      setAssignments({})
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to prepare reviewer mappings')
    } finally {
      setRefreshing(false)
    }
  }, [grantId, headers, projectId])

  const applyAssignments = useCallback(async () => {
    const payload = Object.entries(assignments)
      .map(([grantSectionKey, reviewerBucketKey]) => ({ grantSectionKey, reviewerBucketKey }))
      .filter((assignment) => assignment.grantSectionKey && assignment.reviewerBucketKey)

    if (payload.length === 0) return

    try {
      setRefreshing(true)
      const response = await fetch(`/api/projects/${projectId}/grants/${grantId}/reviewer`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ assignments: payload }),
      })
      const nextState = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(nextState.message || 'Failed to update mappings')
      }
      setState(nextState)
      setAssignments({})
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update mappings')
    } finally {
      setRefreshing(false)
    }
  }, [assignments, grantId, headers, projectId])

  const linkedSections = useMemo(() => {
    const rows: Array<{ sectionKey: string; label: string; bucketKey: string; reviewerSectionTitle: string }> = []
    for (const section of state?.sections || []) {
      for (const link of section.grant_section_links || []) {
        rows.push({
          sectionKey: link.grantSectionKey,
          label: link.grantSectionLabel,
          bucketKey: section.reviewerBucketKey || 'other',
          reviewerSectionTitle: section.section_title,
        })
      }
    }
    return rows.sort((left, right) => left.label.localeCompare(right.label))
  }, [state?.sections])

  if (loading) {
    return <div className="p-6 text-sm text-slate-600">Loading reviewer mapping...</div>
  }

  const disabledReason = !hasFrozenBlueprint
    ? 'Freeze the grant blueprint before preparing reviewer mappings.'
    : draftedSectionCount <= 0
      ? 'Draft at least one grant section before preparing reviewer mappings.'
      : null

  return (
    <div className="space-y-6 p-6">
      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{error}</span>
        </div>
      ) : null}

      {disabledReason ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {disabledReason}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Grant Reviewer</h2>
          <p className="mt-1 text-sm text-slate-600">
            {state?.call ? `${state.call.agency_name} reviewer workspace` : 'No reviewer workspace prepared yet'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state?.call ? (
            <a
              href={`/reviewer/${state.call.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" />
              Open full reviewer
            </a>
          ) : null}
          {(state?.diagnostics?.staleSectionCount ?? 0) > 0 ? (
            <button
              type="button"
              onClick={() => refreshReviewer(true)}
              disabled={Boolean(disabledReason) || refreshing}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:bg-slate-300"
            >
              <RotateCcw className="h-4 w-4" />
              Create mapped revisions
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => refreshReviewer(false)}
            disabled={Boolean(disabledReason) || refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {state?.call ? 'Refresh mappings' : 'Prepare reviewer'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-medium uppercase text-slate-500">Draft sections</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">
            {state?.diagnostics?.draftedSectionCount || draftedSectionCount}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-medium uppercase text-slate-500">Reviewer sections</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">
            {state?.diagnostics?.mappedSectionCount || 0}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-medium uppercase text-slate-500">Stale reviews</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">
            {state?.diagnostics?.staleSectionCount || 0}
          </div>
        </div>
      </div>

      {state?.sections?.length ? (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
            Reviewer Sections
          </div>
          <div className="divide-y divide-slate-200">
            {state.sections.map((section) => (
              <div key={section.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-slate-950">
                    {section.section_title}
                    {section.version > 1 ? <span className="ml-2 text-xs text-slate-500">v{section.version}</span> : null}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(section.status, section.sourceStale)}`}>
                    {section.sourceStale ? 'stale' : section.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(section.grant_section_links || []).map((link) => (
                    <span key={link.grantSectionKey} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                      {link.grantSectionLabel}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {linkedSections.length ? (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Section Mapping</div>
            <button
              type="button"
              onClick={applyAssignments}
              disabled={Object.keys(assignments).length === 0 || refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
            >
              <Save className="h-3.5 w-3.5" />
              Apply
            </button>
          </div>
          <div className="divide-y divide-slate-200">
            {linkedSections.map((row) => (
              <div key={row.sectionKey} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_280px] md:items-center">
                <div>
                  <div className="font-medium text-slate-950">{row.label}</div>
                  <div className="text-xs text-slate-500">{row.sectionKey}</div>
                </div>
                <select
                  value={assignments[row.sectionKey] || row.bucketKey}
                  onChange={(event) => setAssignments((current) => ({
                    ...current,
                    [row.sectionKey]: event.target.value,
                  }))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                >
                  {BUCKET_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
