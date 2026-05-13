'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import type { FundingCallSummary, FundingImportInputType, FundingImportJobView, FundingVisibility } from '@/types/funding'

type ImportMode = FundingImportInputType

type FundingImportsPageProps = {
  basePath?: string
  title?: string
  description?: string
  requireSuperAdmin?: boolean
}

const POLL_INTERVAL_MS = 15000

export default function FundingImportsPage({
  basePath = '/funding',
  title = 'Funding Imports',
  description = 'Import funding calls from URLs, uploaded files, or pasted text. Patent workflows stay untouched.',
  requireSuperAdmin = false,
}: FundingImportsPageProps = {}) {
  const { token, user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const isSuperAdmin = useMemo(
    () =>
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('SUPER_ADMIN_VIEWER') ||
      user?.platformPermissions?.includes('platform.support.read') ||
      user?.platformPermissions?.includes('funding.operations.write') ||
      user?.platformPermissions?.includes('funding.publisher.write'),
    [user?.platformPermissions, user?.roles]
  )
  const canCreateGlobalImport = useMemo(
    () => Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.platformPermissions?.includes('funding.operations.write')),
    [user?.platformPermissions, user?.roles]
  )
  const canSubmitImport = !requireSuperAdmin || canCreateGlobalImport

  const [jobs, setJobs] = useState<FundingImportJobView[]>([])
  const [calls, setCalls] = useState<FundingCallSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ImportMode>('url')
  const [visibility, setVisibility] = useState<FundingVisibility>('TENANT_PRIVATE')
  const [sourceUrl, setSourceUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const fetchData = useCallback(async () => {
    if (!token) {
      return
    }

    try {
      const [jobsResponse, callsResponse] = await Promise.all([
        fetch('/api/funding/imports', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/funding/calls', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (!jobsResponse.ok) {
        throw new Error('Failed to load funding imports')
      }
      if (!callsResponse.ok) {
        throw new Error('Failed to load funding calls')
      }

      const jobsBody = await jobsResponse.json()
      const callsBody = await callsResponse.json()
      setJobs(jobsBody.jobs || [])
      setCalls(callsBody.calls || [])
      setError(null)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load funding data')
    } finally {
      setLoading(false)
    }
  }, [token])

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
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!token) {
      return
    }

    const intervalId = window.setInterval(() => {
      fetchData()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [fetchData, token])

  const submitImport = async () => {
    if (!token || !canSubmitImport) {
      return
    }

    setSubmitting(true)
    try {
      let response: Response

      if (mode === 'file') {
        if (!selectedFile) {
          throw new Error('Choose a file to import')
        }

        const formData = new FormData()
        formData.append('file', selectedFile)
        formData.append('visibility', visibility)
        formData.append('inputType', 'file')

        response = await fetch('/api/funding/imports', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
      } else {
        response = await fetch('/api/funding/imports', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputType: mode,
            visibility,
            sourceUrl: mode === 'url' ? sourceUrl : undefined,
            rawText: mode === 'text' ? rawText : undefined,
          }),
        })
      }

      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || 'Funding import failed')
      }

      setSourceUrl('')
      setRawText('')
      setSelectedFile(null)
      await fetchData()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Funding import failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRetry = async (jobId: string) => {
    if (!token) {
      return
    }

    const response = await fetch(`/api/funding/imports/${jobId}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await response.json()

    if (!response.ok) {
      setError(body.error || 'Retry failed')
      return
    }

    await fetchData()
  }

  const handleResolveDuplicate = async (jobId: string, resolution: 'reuse_existing' | 'create_new', fundingCallId?: string) => {
    if (!token) {
      return
    }

    const response = await fetch(`/api/funding/imports/${jobId}/resolve-duplicate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resolution, fundingCallId }),
    })
    const body = await response.json()

    if (!response.ok) {
      setError(body.error || 'Duplicate resolution failed')
      return
    }

    await fetchData()
  }

  if (requireSuperAdmin && (authLoading || !isSuperAdmin)) {
    return <div className="p-8 text-sm text-gray-600">Checking platform access...</div>
  }

  if (!token) {
    return <div className="p-8 text-sm text-gray-600">Log in to access funding imports.</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">{title}</h1>
            <p className="mt-2 text-sm text-slate-600">{description}</p>
          </div>
          <button
            type="button"
            onClick={() => fetchData()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div className="space-y-3">
              <label className="block text-sm font-medium">Import mode</label>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as ImportMode)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="url">URL</option>
                <option value="file">File</option>
                <option value="text">Pasted Text</option>
              </select>

              <label className="block text-sm font-medium">Visibility</label>
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as FundingVisibility)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={!canCreateGlobalImport}
              >
                <option value="TENANT_PRIVATE">Tenant Private</option>
                <option value="GLOBAL_PUBLISHED">Global Catalog</option>
              </select>
              {!canCreateGlobalImport ? (
                <p className="text-xs text-slate-500">Global imports require funding operations access.</p>
              ) : null}
            </div>

            <div className="space-y-4">
              {mode === 'url' ? (
                <textarea
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://agency.example.org/grants/program-2026"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              ) : null}

              {mode === 'text' ? (
                <textarea
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                  placeholder="Paste the funding call text here..."
                  rows={8}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              ) : null}

              {mode === 'file' ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-4">
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.html,.htm"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    className="block w-full text-sm"
                  />
                  {selectedFile ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Selected: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => submitImport()}
                  disabled={submitting || !canSubmitImport || (visibility === 'GLOBAL_PUBLISHED' && !canCreateGlobalImport)}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {submitting ? 'Importing...' : 'Start Import'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Import Jobs</h2>
                <p className="text-sm text-slate-500">Recent ingest runs, duplicate review, and retry state.</p>
              </div>
            </div>

            {loading ? <p className="text-sm text-slate-500">Loading imports...</p> : null}

            <div className="space-y-4">
              {jobs.map((job) => (
                <article key={job.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium uppercase text-slate-700">
                          {job.status.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-slate-500">{job.inputType}</span>
                        <span className="text-xs text-slate-500">{job.visibility}</span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900">{job.normalizedFacts?.title || job.sourceLocator || 'Funding import job'}</p>
                      <p className="mt-1 text-xs text-slate-500">{job.sourceLocator || 'No source locator'}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {job.resultFundingCallId ? (
                        <Link
                          href={`${basePath}/calls/${job.resultFundingCallId}`}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-100"
                        >
                          View Call
                        </Link>
                      ) : null}
                      {job.status === 'FAILED' || job.status === 'NEEDS_REVIEW' ? (
                        <button
                          type="button"
                          onClick={() => handleRetry(job.id)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-100"
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {job.errorMessage ? (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{job.errorMessage}</p>
                  ) : null}

                  {job.normalizedFacts?.summary ? (
                    <p className="mt-3 text-sm text-slate-600">{job.normalizedFacts.summary}</p>
                  ) : null}

                  {job.status === 'NEEDS_REVIEW' && job.duplicateCandidates.length > 0 ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-amber-900">Potential duplicates</h3>
                          <p className="text-xs text-amber-700">Choose an existing call or create a fresh one.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleResolveDuplicate(job.id, 'create_new')}
                          className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
                        >
                          Create New Call
                        </button>
                      </div>

                      <div className="space-y-2">
                        {job.duplicateCandidates.map((candidate) => (
                          <div key={candidate.fundingCallId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3">
                            <div>
                              <p className="text-sm font-medium text-slate-900">{candidate.title}</p>
                              <p className="text-xs text-slate-500">
                                {candidate.agencyName || 'Unknown agency'} - {candidate.reason} - score {candidate.score}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleResolveDuplicate(job.id, 'reuse_existing', candidate.fundingCallId)}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-100"
                            >
                              Reuse Existing
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}

              {!loading && jobs.length === 0 ? (
                <p className="text-sm text-slate-500">No funding imports yet.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Recent Funding Calls</h2>
            <p className="mt-1 text-sm text-slate-500">Visible calls created or reused by recent imports.</p>

            <div className="mt-4 space-y-3">
              {calls.map((call) => (
                <Link
                  key={call.id}
                  href={`${basePath}/calls/${call.id}`}
                  className="block rounded-xl border border-slate-200 p-4 hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{call.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {call.agencyName || 'Unknown agency'} - {call.visibility} - {call.status}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400">{new Date(call.updatedAt).toLocaleString()}</span>
                  </div>
                  {call.summary ? <p className="mt-2 text-sm text-slate-600">{call.summary}</p> : null}
                </Link>
              ))}

              {!loading && calls.length === 0 ? (
                <p className="text-sm text-slate-500">No funding calls are visible yet.</p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
