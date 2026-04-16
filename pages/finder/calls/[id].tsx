import { useEffect, useMemo, useState } from 'react'
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

type FundingCallDetail = Record<string, any>

function formatDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatAmount(call: FundingCallDetail) {
  if (call.amount_min == null && call.amount_max == null) return null
  const currency = call.currency ? `${call.currency} ` : ''
  if (call.amount_min != null && call.amount_max != null) {
    return `${currency}${Number(call.amount_min).toLocaleString()} to ${currency}${Number(call.amount_max).toLocaleString()}`
  }
  const value = call.amount_min ?? call.amount_max
  return `${currency}${Number(value).toLocaleString()}`
}

function chips(values?: string[]) {
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

export default function FundingCallDetailsPage() {
  const router = useRouter()
  const { id } = router.query
  const { user, isLoading, authFetch } = useAuth()
  const [call, setCall] = useState<FundingCallDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = useMemo(
    () => Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.roles?.includes('SUPER_ADMIN_VIEWER')),
    [user]
  )

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
          setCall(payload.call || null)
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

  if (isLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading funding call...</div>
  }

  if (error || !call) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-12">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Funding call unavailable</div>
          <p className="mt-3 text-sm text-slate-600">{error || 'The funding call could not be loaded.'}</p>
          <Link href="/finder" className="mt-6 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Back to Finder
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <Head>
        <title>{call.scheme_title || call.title || 'Funding Call'} | Grapsi</title>
      </Head>

      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link href="/finder" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 hover:text-emerald-950">
            <FaArrowLeft />
            Back to Finder
          </Link>
          {call.official_urls?.[0] ? (
            <a
              href={call.official_urls[0]}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Official Source
              <FaExternalLinkAlt className="text-xs" />
            </a>
          ) : null}
        </div>

        <section className="rounded-[32px] border border-white/80 bg-white/85 p-8 shadow-[0_28px_80px_rgba(15,23,42,0.10)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">{call.agency_name || call.agencyName || 'Funding Call'}</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {call.scheme_title || call.title}
          </h1>
          <p className="mt-4 max-w-4xl text-base leading-8 text-slate-600">
            {call.description || call.summary || 'No description available.'}
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"><FaCalendarAlt /> Deadline</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{call.is_rolling ? 'Rolling' : formatDate(call.close_date || call.deadlineAt) || 'Not specified'}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"><FaGlobe /> Geography</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{call.geography_scope || call.geographyScope || 'Not specified'}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"><FaMapMarkerAlt /> Sponsor</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{call.sponsor_type || call.sponsorType || 'Not specified'}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Funding</div>
              <div className="mt-2 text-sm font-semibold text-slate-950">{formatAmount(call) || 'Not specified'}</div>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Eligibility and Fit</h2>
            <div className="mt-5 space-y-5 text-sm leading-7 text-slate-700">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Eligible Countries</div>
                {chips(call.eligible_countries || call.eligibleCountries) || <p>Not specified.</p>}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Institution Types</div>
                {chips(call.institution_types || call.institutionTypes) || <p>Not specified.</p>}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Career Stages</div>
                {chips(call.career_stages || call.careerStages) || <p>Not specified.</p>}
              </div>
              {call.eligibility_text ? (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Eligibility Notes</div>
                  <p>{call.eligibility_text}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Focus and Deliverables</h2>
            <div className="mt-5 space-y-5 text-sm leading-7 text-slate-700">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Funding Kinds</div>
                {chips(call.funding_kinds || call.fundingKinds) || <p>Not specified.</p>}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Disciplines</div>
                {chips(call.disciplines) || <p>Not specified.</p>}
              </div>
              {call.expected_deliverables_text ? (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Expected Deliverables</div>
                  <p>{call.expected_deliverables_text}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold text-slate-950">Links and Source Data</h2>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div className="space-y-3 text-sm text-slate-700">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Official URLs</div>
                  <div className="mt-2 space-y-2">
                    {(call.official_urls || []).length ? (
                      (call.official_urls || []).map((url: string) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="block break-all text-emerald-700 hover:text-emerald-900">
                          {url}
                        </a>
                      ))
                    ) : (
                      <p>Not available.</p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Source URL</div>
                  <div className="mt-2 break-all">{call.source_url || call.sourceUrl || 'Not available.'}</div>
                </div>
              </div>
              <div className="space-y-3 text-sm text-slate-700">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Contact Info</div>
                  <div className="mt-2">{call.contact_info || 'Not available.'}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Template / Guideline Readiness</div>
                  <div className="mt-2">
                    Template: {call.template_status || 'none'} | Guidelines: {call.guideline_status || 'none'}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {isAdmin ? (
            <section className="rounded-[28px] border border-amber-200 bg-amber-50/70 p-6 shadow-sm lg:col-span-2">
              <h2 className="text-lg font-semibold text-slate-950">Admin Diagnostics</h2>
              <pre className="mt-4 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                {JSON.stringify(call, null, 2)}
              </pre>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
