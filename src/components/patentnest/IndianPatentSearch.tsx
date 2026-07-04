'use client'

import { FormEvent, useState } from 'react'
import {
  AlertCircle,
  CalendarDays,
  FileSearch,
  Hash,
  Loader2,
  MapPin,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react'

import type {
  PatentNestApiResponse,
  PatentNestErrorResponse,
  PatentNestPatentRecord,
  PatentNestSearchData,
} from '@/lib/patentnest/types'

interface UiError {
  message: string
  requestId?: string
  retryAfter?: string | null
}

function getAuthHeaders(json = false): HeadersInit {
  const token = window.localStorage.getItem('auth_token')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function readApiError(response: Response): Promise<UiError> {
  let body: PatentNestErrorResponse | undefined
  try {
    body = (await response.json()) as PatentNestErrorResponse
  } catch {
    // The proxy normally returns JSON, but retain a useful fallback for malformed responses.
  }

  return {
    message: body?.error?.message || 'Indian patent request failed. Please try again.',
    requestId: response.headers.get('x-request-id') || body?.error?.requestId,
    retryAfter: response.headers.get('retry-after'),
  }
}

function displayDate(value?: string | null): string {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date)
}

function score(value?: number | null): string {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value * 100)}%`
}

function ErrorPanel({ error }: { error: UiError }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-medium">Unable to load patents</p>
          <p className="mt-1 text-sm text-red-800">{error.message}</p>
          {error.retryAfter && (
            <p className="mt-1 text-xs text-red-700">Try again after {error.retryAfter} seconds.</p>
          )}
          {error.requestId && (
            <p className="mt-2 font-mono text-xs text-red-700">Request ID: {error.requestId}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function PatentCard({ patent }: { patent: PatentNestPatentRecord }) {
  const applicants = patent.applicants || []
  const inventors = patent.inventors || []
  const classifications = patent.classifications || []

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
          {patent.country && <span className="rounded-full bg-orange-50 px-2.5 py-1 text-orange-800">{patent.country}</span>}
          {patent.kind && <span className="rounded-full bg-slate-100 px-2.5 py-1">Kind {patent.kind}</span>}
          {patent.extractionConfidence !== null && patent.extractionConfidence !== undefined && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">
              {score(patent.extractionConfidence)} extraction confidence
            </span>
          )}
        </div>
        <h2 className="mt-3 text-xl font-semibold leading-snug text-slate-950">
          {patent.title || 'Untitled Indian patent'}
        </h2>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <Hash className="h-4 w-4" /> Publication: {patent.publicationNumber || 'Not available'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileSearch className="h-4 w-4" /> Application: {patent.applicationNumber || 'Not available'}
          </span>
        </div>
      </div>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Abstract</h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
            {patent.abstract || 'No abstract is available for this record.'}
          </p>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <UsersRound className="h-4 w-4 text-orange-700" /> Applicants
            </h3>
            {applicants.length ? (
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {applicants.map((applicant, index) => (
                  <li key={`${applicant.name}-${applicant.sequence ?? index}`}>
                    <span className="font-medium">{applicant.name}</span>
                    {applicant.address && (
                      <span className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {applicant.address}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Not available</p>
            )}
          </section>

          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <UserRound className="h-4 w-4 text-orange-700" /> Inventors
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {inventors.length ? inventors.join(', ') : 'Not available'}
            </p>
          </section>
        </div>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">Classifications</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {classifications.length ? (
              classifications.map((classification) => (
                <span key={classification} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-700">
                  {classification}
                </span>
              ))
            ) : (
              <span className="text-sm text-slate-500">Not available</span>
            )}
          </div>
        </section>

        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" /> Filing date
            </p>
            <p className="mt-1 font-medium text-slate-800">{displayDate(patent.filingDate)}</p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" /> Publication date
            </p>
            <p className="mt-1 font-medium text-slate-800">{displayDate(patent.publicationDate)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pages / claims</p>
            <p className="mt-1 font-medium text-slate-800">
              {patent.numberOfPages ?? '—'} / {patent.numberOfClaims ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Source</p>
            <p className="mt-1 font-medium text-slate-800">{patent.source?.name || 'Not available'}</p>
            {(patent.source?.document || patent.source?.page != null) && (
              <p className="text-xs text-slate-500">
                {[patent.source?.document, patent.source?.page != null ? `page ${patent.source.page}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>

        {patent.relevance && (
          <section className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-blue-950">Search relevance</h3>
            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
              <div><span className="text-blue-700">Overall</span><p className="font-semibold text-blue-950">{score(patent.relevance.score)}</p></div>
              <div><span className="text-blue-700">Semantic</span><p className="font-semibold text-blue-950">{score(patent.relevance.semanticScore)}</p></div>
              <div><span className="text-blue-700">Text</span><p className="font-semibold text-blue-950">{score(patent.relevance.textScore)}</p></div>
            </div>
            {!!patent.relevance.matchedFields?.length && (
              <p className="mt-2 text-xs text-blue-700">Matched: {patent.relevance.matchedFields.join(', ')}</p>
            )}
          </section>
        )}
      </div>
    </article>
  )
}

export default function IndianPatentSearch() {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(20)
  const [publicationNumber, setPublicationNumber] = useState('')
  const [searchData, setSearchData] = useState<PatentNestSearchData | null>(null)
  const [patent, setPatent] = useState<PatentNestPatentRecord | null>(null)
  const [searching, setSearching] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [searchError, setSearchError] = useState<UiError | null>(null)
  const [lookupError, setLookupError] = useState<UiError | null>(null)

  async function submitSearch(event: FormEvent) {
    event.preventDefault()
    const normalized = query.trim()
    if (normalized.length < 2 || normalized.length > 2_000) {
      setSearchError({ message: 'Enter a search query containing 2 to 2,000 characters.' })
      return
    }

    setSearching(true)
    setSearchError(null)
    setSearchData(null)
    try {
      const response = await fetch('/api/patentnest/search', {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ query: normalized, limit }),
      })
      if (!response.ok) throw await readApiError(response)
      const body = (await response.json()) as PatentNestApiResponse<PatentNestSearchData>
      setSearchData(body.data)
    } catch (error) {
      setSearchError(
        error && typeof error === 'object' && 'message' in error
          ? (error as UiError)
          : { message: 'Indian patent search failed. Please try again.' }
      )
    } finally {
      setSearching(false)
    }
  }

  async function submitLookup(event: FormEvent) {
    event.preventDefault()
    const normalized = publicationNumber.trim()
    if (!normalized) {
      setLookupError({ message: 'Enter an Indian patent publication number.' })
      return
    }

    setLookingUp(true)
    setLookupError(null)
    setPatent(null)
    try {
      const response = await fetch(`/api/patentnest/patents/${encodeURIComponent(normalized)}`, {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw await readApiError(response)
      const body = (await response.json()) as PatentNestApiResponse<PatentNestPatentRecord>
      setPatent(body.data)
    } catch (error) {
      setLookupError(
        error && typeof error === 'object' && 'message' in error
          ? (error as UiError)
          : { message: 'Patent lookup failed. Please try again.' }
      )
    } finally {
      setLookingUp(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl sm:px-10">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-300">PatentNest corpus</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Indian patent intelligence</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
          Search the Indian Patent Journal corpus by technical concept, or retrieve a known record by publication number.
        </p>

        <form onSubmit={submitSearch} className="mt-7 grid gap-3 sm:grid-cols-[1fr_110px_auto]">
          <label className="sr-only" htmlFor="patent-query">Patent search query</label>
          <input
            id="patent-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={2_000}
            placeholder="e.g. battery thermal management for electric vehicles"
            className="min-w-0 rounded-xl border border-white/15 bg-white px-4 py-3 text-sm text-slate-950 outline-none ring-orange-400 placeholder:text-slate-400 focus:ring-2"
          />
          <label className="sr-only" htmlFor="patent-limit">Result limit</label>
          <select
            id="patent-limit"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            className="rounded-xl border border-white/15 bg-white px-3 py-3 text-sm text-slate-900 outline-none ring-orange-400 focus:ring-2"
          >
            {[10, 20, 30, 40, 50].map((value) => <option key={value} value={value}>{value} results</option>)}
          </select>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {searching ? 'Searching…' : 'Search corpus'}
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <form onSubmit={submitLookup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-800">
            Retrieve by publication number
            <input
              value={publicationNumber}
              onChange={(event) => setPublicationNumber(event.target.value)}
              maxLength={100}
              placeholder="IN20282005A"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 font-mono text-sm outline-none ring-orange-500 focus:ring-2"
            />
          </label>
          <button
            type="submit"
            disabled={lookingUp}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
            {lookingUp ? 'Retrieving…' : 'Retrieve patent'}
          </button>
        </form>
      </div>

      <div className="mt-6 space-y-5">
        {searchError && <ErrorPanel error={searchError} />}
        {lookupError && <ErrorPanel error={lookupError} />}

        {searching && (
          <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600">
            <Loader2 className="mr-3 h-5 w-5 animate-spin text-orange-600" /> Searching the Indian patent corpus…
          </div>
        )}
        {lookingUp && (
          <div className="flex min-h-32 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600">
            <Loader2 className="mr-3 h-5 w-5 animate-spin text-orange-600" /> Retrieving patent record…
          </div>
        )}

        {patent && <PatentCard patent={patent} />}

        {searchData && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 className="text-lg font-semibold text-slate-950">
                {searchData.count} {searchData.count === 1 ? 'result' : 'results'}
              </h2>
              <p className="text-sm text-slate-500">Query: “{searchData.query}”</p>
            </div>
            {searchData.results.length ? (
              searchData.results.map((result, index) => (
                <PatentCard key={result.publicationNumber || `${result.title}-${index}`} patent={result} />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <FileSearch className="mx-auto h-8 w-8 text-slate-400" />
                <h3 className="mt-3 font-semibold text-slate-900">No matching Indian patents</h3>
                <p className="mt-1 text-sm text-slate-500">Try broader technical terms or fewer constraints.</p>
              </div>
            )}
          </>
        )}

        {!searching && !lookingUp && !searchData && !patent && !searchError && !lookupError && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
            Search results and retrieved records will appear here.
          </div>
        )}
      </div>
    </div>
  )
}
