'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import type { FundingCallDetail } from '@/types/funding'

type FundingCallDetailPageProps = {
  callId: string
  backHref?: string
  backLabel?: string
  requireSuperAdmin?: boolean
}

export default function FundingCallDetailPage({
  callId,
  backHref = '/funding/imports',
  backLabel = 'Back to funding imports',
  requireSuperAdmin = false,
}: FundingCallDetailPageProps) {
  const { token, user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const isSuperAdmin = useMemo(
    () =>
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('SUPER_ADMIN_VIEWER') ||
      user?.platformPermissions?.includes('platform.support.read') ||
      user?.platformPermissions?.includes('funding.publisher.write'),
    [user?.platformPermissions, user?.roles]
  )
  const isSuperAdminWriter = useMemo(
    () => Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.platformPermissions?.includes('funding.publisher.write')),
    [user?.platformPermissions, user?.roles]
  )

  const [call, setCall] = useState<FundingCallDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const formattedFunding = useMemo(() => {
    if (!call) return null
    const formatter = new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 0,
    })

    if (typeof call.amountMin === 'number' && typeof call.amountMax === 'number') {
      return `${call.currency || ''} ${formatter.format(call.amountMin)} - ${formatter.format(call.amountMax)}`.trim()
    }

    if (typeof call.amountMax === 'number') {
      return `${call.currency || ''} ${formatter.format(call.amountMax)}`.trim()
    }

    if (typeof call.amountMin === 'number') {
      return `${call.currency || ''} ${formatter.format(call.amountMin)}`.trim()
    }

    return null
  }, [call])

  const fetchCall = useCallback(async () => {
    if (!token) {
      return
    }

    try {
      const response = await fetch(`/api/funding/calls/${callId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || 'Failed to fetch funding call')
      }
      setCall(body.call)
      setError(null)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch funding call')
    } finally {
      setLoading(false)
    }
  }, [callId, token])

  useEffect(() => {
    if (!requireSuperAdmin || authLoading) {
      return
    }

    if (!user) {
      router.replace('/login')
      return
    }

    if (!isSuperAdmin) {
      router.replace('/dashboard')
    }
  }, [authLoading, isSuperAdmin, requireSuperAdmin, router, user])

  useEffect(() => {
    fetchCall()
  }, [fetchCall])

  const performModerationAction = async (action: 'publish' | 'archive') => {
    if (!token) {
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/super-admin/funding/calls/${callId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || `Failed to ${action} funding call`)
      }
      await fetchCall()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Failed to ${action} funding call`)
    } finally {
      setSaving(false)
    }
  }

  if (requireSuperAdmin && (authLoading || !isSuperAdmin)) {
    return <div className="p-8 text-sm text-gray-600">Checking platform access...</div>
  }

  if (!token) {
    return <div className="p-8 text-sm text-gray-600">Log in to access funding calls.</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={backHref} className="text-sm text-slate-500 hover:text-slate-700">
              {backLabel}
            </Link>
            <h1 className="mt-2 text-3xl font-semibold">{call?.title || 'Funding Call'}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {call?.agencyName || 'Unknown agency'} - {call?.visibility || '...'} - {call?.status || '...'}
            </p>
          </div>

          {call && isSuperAdminWriter && call.visibility === 'GLOBAL_PUBLISHED' ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => performModerationAction('publish')}
                disabled={saving || call.status === 'PUBLISHED'}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                Publish
              </button>
              <button
                type="button"
                onClick={() => performModerationAction('archive')}
                disabled={saving || call.status === 'ARCHIVED'}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Archive
              </button>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Loading funding call...</p>
          </div>
        ) : null}

        {call ? (
          <>
            <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Core Details</h2>
                <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="font-medium text-slate-500">Agency</p>
                    <p className="mt-1 text-slate-800">{call.agencyName || 'Not available'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Source URL</p>
                    <p className="mt-1 break-all text-slate-800">{call.sourceUrl || 'Not available'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Program Identifier</p>
                    <p className="mt-1 text-slate-800">{call.programIdentifier || 'Not available'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Deadline</p>
                    <p className="mt-1 text-slate-800">
                      {call.deadlineAt ? new Date(call.deadlineAt).toLocaleString() : 'Not detected'}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Source Domain</p>
                    <p className="mt-1 text-slate-800">{call.sourceDomain || 'Not available'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Funding</p>
                    <p className="mt-1 text-slate-800">{formattedFunding || 'Not detected'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Project Duration</p>
                    <p className="mt-1 text-slate-800">{call.projectDurationText || 'Not detected'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Contact</p>
                    <p className="mt-1 break-all text-slate-800">{call.contactInfo || 'Not available'}</p>
                  </div>
                </div>

                {call.description || call.summary ? (
                  <div className="mt-6">
                    <p className="font-medium text-slate-500">Description</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {call.description || call.summary}
                    </p>
                  </div>
                ) : null}

                {call.eligibilityText ? (
                  <div className="mt-6">
                    <p className="font-medium text-slate-500">Eligibility</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{call.eligibilityText}</p>
                  </div>
                ) : null}

                {call.expectedDeliverablesText && call.expectedDeliverablesText !== '[object Object]' ? (
                  <div className="mt-6">
                    <p className="font-medium text-slate-500">Expected Deliverables</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {call.expectedDeliverablesText}
                    </p>
                  </div>
                ) : null}

                {call.extractedFacts?.keywords?.length ? (
                  <div className="mt-6">
                    <p className="font-medium text-slate-500">Keywords</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {call.extractedFacts.keywords.map((keyword) => (
                        <span key={keyword} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Call Facts</h2>
                <div className="mt-4 space-y-5">
                  <div>
                    <p className="font-medium text-slate-500">Disciplines</p>
                    {call.disciplines?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {call.disciplines.map((value) => (
                          <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                            {value}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Not detected</p>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Institution Types</p>
                    {call.institutionTypes?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {call.institutionTypes.map((value) => (
                          <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                            {value}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Not detected</p>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Citizenship Requirements</p>
                    {call.citizenshipRequirements?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {call.citizenshipRequirements.map((value) => (
                          <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                            {value}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Not detected</p>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Application Languages</p>
                    {call.applicationLanguages?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {call.applicationLanguages.map((value) => (
                          <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                            {value}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Not detected</p>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">Official URLs</p>
                    {call.officialUrls?.length ? (
                      <div className="mt-2 space-y-2">
                        {call.officialUrls.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block break-all text-sm text-sky-700 hover:text-sky-900"
                          >
                            {url}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Not detected</p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Import Assets</h2>
              <div className="mt-4 space-y-3">
                {call.assets.map((asset) => (
                  <div key={asset.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {asset.kind}
                      </span>
                      <span className="text-xs text-slate-400">{new Date(asset.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{asset.fileName || asset.mimeType || 'Stored asset'}</p>
                    {asset.textPreview ? <p className="mt-2 text-xs text-slate-500">{asset.textPreview}</p> : null}
                  </div>
                ))}
                {call.assets.length === 0 ? <p className="text-sm text-slate-500">No assets attached yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Recent Import Jobs</h2>
              <div className="mt-4 space-y-3">
                {call.recentJobs.map((job) => (
                  <div key={job.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{job.normalizedFacts?.title || call.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {job.status} - {job.inputType} - {new Date(job.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{job.outcome || 'n/a'}</span>
                    </div>
                    {job.errorMessage ? <p className="mt-3 text-sm text-rose-700">{job.errorMessage}</p> : null}
                  </div>
                ))}
                {call.recentJobs.length === 0 ? <p className="text-sm text-slate-500">No recent jobs for this call.</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
