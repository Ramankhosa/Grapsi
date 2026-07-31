// @ts-nocheck
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client'
import { useRouter } from 'next/router'
import axios from 'axios'
import Link from 'next/link'
import Head from 'next/head'
import {
  FaArrowLeft,
  FaCheckCircle,
  FaChevronDown,
  FaChevronUp,
  FaExclamationTriangle,
  FaGlobe,
  FaLink,
  FaPlus,
  FaSearch,
  FaSpinner,
  FaTimesCircle,
  FaTrash,
} from 'react-icons/fa'

type FundingCallOption = {
  id: string
  title: string
  agencyName?: string | null
  summary?: string | null
  deadlineAt?: string | null
  sourceUrl?: string | null
  readiness?: 'template_manual' | 'guideline_manual' | 'call_fields'
  readinessLabel?: string
}

const DEFAULT_RUBRIC = {
  evaluationCriteria: [],
  reviewerSignals: [],
  mustAddress: [],
  avoid: [],
  formatRules: [],
}

const READINESS_STYLES: Record<string, string> = {
  template_manual: 'bg-green-100 text-green-800',
  guideline_manual: 'bg-cobalt-100 text-cobalt-800',
  call_fields: 'bg-amber-100 text-amber-800',
}

const READINESS_HELP: Record<string, string> = {
  template_manual:
    'This call has an approved application template. The reviewer will score against its exact sections, limits, and rubric.',
  guideline_manual:
    'This call has an extracted guideline pack. The reviewer will score against those rules mapped onto the standard proposal sections.',
  call_fields:
    'This call has no template or guideline pack yet. The reviewer will set up the standard proposal sections and score against the stored call record (scope, budget, duration, eligibility) plus anything you add in the manual rubric.',
}

function RuleList({ title, items, tone = 'gray' }: { title: string; items: string[]; tone?: string }) {
  if (!items || items.length === 0) return null
  const toneClass =
    tone === 'green' ? 'bg-green-50' : tone === 'red' ? 'bg-red-50' : tone === 'blue' ? 'bg-cobalt-50' : 'bg-nickel-50'
  return (
    <div className={`rounded-md ${toneClass} p-3`}>
      <h4 className="text-sm font-medium text-nickel-700">{title}</h4>
      <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-nickel-800">
        {items.slice(0, 8).map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
      {items.length > 8 ? (
        <p className="mt-1 text-xs text-nickel-500">+ {items.length - 8} more</p>
      ) : null}
    </div>
  )
}

export default function NewReviewerCall() {
  const { status } = useSession()
  const router = useRouter()

  const [sourceMode, setSourceMode] = useState<'library' | 'url'>('library')

  // Library mode
  const [calls, setCalls] = useState<FundingCallOption[]>([])
  const [fundingCallId, setFundingCallId] = useState('')
  const [callSearch, setCallSearch] = useState('')
  const [loadingCalls, setLoadingCalls] = useState(true)

  // URL mode
  const [urls, setUrls] = useState<string[]>([''])
  const [checking, setChecking] = useState(false)
  const [checkResults, setCheckResults] = useState<any[] | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzed, setAnalyzed] = useState<{ context: any; diagnostics: any } | null>(null)

  // Shared
  const [projectTitle, setProjectTitle] = useState('')
  const [manualRubricText, setManualRubricText] = useState(JSON.stringify(DEFAULT_RUBRIC, null, 2))
  const [showRubric, setShowRubric] = useState(false)
  const [seedSections, setSeedSections] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [router, status])

  useEffect(() => {
    if (status !== 'authenticated') return

    const loadCalls = async () => {
      try {
        setLoadingCalls(true)
        const response = await axios.get('/api/reviewer/funding-calls')
        const nextCalls = response.data.calls || []
        setCalls(nextCalls)
        if (nextCalls.length > 0) {
          setFundingCallId((current) => current || nextCalls[0].id)
        }
      } catch (nextError) {
        console.error('Failed to load funding calls:', nextError)
        setError('Failed to load the funding call library. You can still start from a call URL.')
      } finally {
        setLoadingCalls(false)
      }
    }

    void loadCalls()
  }, [status])

  const filteredCalls = useMemo(() => {
    const query = callSearch.trim().toLowerCase()
    if (!query) return calls
    return calls.filter((call) =>
      `${call.title} ${call.agencyName || ''}`.toLowerCase().includes(query)
    )
  }, [calls, callSearch])

  const selectedCall = useMemo(
    () => calls.find((call) => call.id === fundingCallId) || null,
    [calls, fundingCallId]
  )

  const cleanUrls = useMemo(() => urls.map((url) => url.trim()).filter(Boolean), [urls])

  const parseRubric = () => {
    try {
      return { ok: true, value: JSON.parse(manualRubricText || '{}') }
    } catch {
      return { ok: false, value: null }
    }
  }

  const handleCheckUrls = async () => {
    if (cleanUrls.length === 0) {
      setValidationErrors({ urls: 'Enter at least one funding call URL.' })
      return
    }
    try {
      setChecking(true)
      setError('')
      setValidationErrors({})
      const response = await axios.post('/api/reviewer/validate-url', { urls: cleanUrls })
      setCheckResults(response.data.results || [])
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || 'Could not reach those URLs.')
    } finally {
      setChecking(false)
    }
  }

  const handleAnalyze = async (forceRefresh = false) => {
    if (cleanUrls.length === 0) {
      setValidationErrors({ urls: 'Enter at least one funding call URL.' })
      return
    }
    const rubric = parseRubric()
    if (!rubric.ok) {
      setValidationErrors({ manualRubric: 'Manual rubric must be valid JSON.' })
      setShowRubric(true)
      return
    }

    try {
      setAnalyzing(true)
      setError('')
      setValidationErrors({})
      const response = await axios.post('/api/reviewer/calls/analyze', {
        urls: cleanUrls,
        manualRubric: rubric.value,
        forceRefresh,
      })
      setAnalyzed(response.data)
      if (!projectTitle.trim() && response.data?.context?.title) {
        setProjectTitle(response.data.context.title)
      }
    } catch (nextError: any) {
      setAnalyzed(null)
      setError(
        nextError?.response?.data?.error ||
          'Could not extract reviewer rules from that URL. Try the PDF guidelines link for this call.'
      )
    } finally {
      setAnalyzing(false)
    }
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!projectTitle.trim()) errors.projectTitle = 'Project title is required.'
    if (sourceMode === 'library' && !fundingCallId) {
      errors.fundingCallId = 'Select a funding call.'
    }
    if (sourceMode === 'url') {
      if (cleanUrls.length === 0) errors.urls = 'Enter at least one funding call URL.'
      else if (!analyzed) errors.urls = 'Analyze the call before creating the reviewer workspace.'
    }
    if (!parseRubric().ok) errors.manualRubric = 'Manual rubric must be valid JSON.'
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    try {
      setSubmitting(true)
      setError('')
      const payload =
        sourceMode === 'library'
          ? {
              sourceMode: 'library',
              fundingCallId,
              project_title: projectTitle.trim(),
              manualRubric: parseRubric().value,
              seedSections,
            }
          : {
              sourceMode: 'url',
              sourceUrls: cleanUrls,
              analyzedContext: analyzed?.context,
              project_title: projectTitle.trim(),
              manualRubric: parseRubric().value,
              seedSections,
            }

      const response = await axios.post('/api/reviewer/calls', payload)
      router.push(`/reviewer/${response.data.call.id}`)
    } catch (nextError: any) {
      console.error('Error creating reviewer call:', nextError)
      setError(nextError?.response?.data?.error || 'Failed to create reviewer workspace.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <FaSpinner className="h-8 w-8 animate-spin text-green-600" />
      </div>
    )
  }

  const context = analyzed?.context
  const diagnostics = analyzed?.diagnostics

  return (
    <div className="nk-ground">
      <Head>
        <title>New workspace — AI Grant Reviewer</title>
      </Head>

      <header className="border-b border-nickel-200 bg-white">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <Link href="/reviewer" className="nk-eyebrow transition-colors hover:text-cobalt-700">
              Reviewer
            </Link>
            <h1 className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em] text-nickel-900">
              New workspace
            </h1>
          </div>
          <Link href="/reviewer" className="nk-btn-ghost nk-btn-sm shrink-0">
            Cancel
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        <p className="nk-sub mb-6 max-w-prose">
          Pick a stored funding call, or point us at the call's own page and its terms and
          reviewer rules will be pulled out for you.
        </p>
        <form onSubmit={handleSubmit} className="nk-panel p-6">
          {error ? (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700"
            >
              <FaExclamationTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Source mode picker */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSourceMode('library')}
              className={`flex items-start rounded-lg border-2 p-4 text-left transition-colors ${
                sourceMode === 'library'
                  ? 'border-green-600 bg-green-50'
                  : 'border-nickel-200 hover:border-nickel-300'
              }`}
            >
              <FaSearch className={`mr-3 mt-1 ${sourceMode === 'library' ? 'text-green-600' : 'text-nickel-400'}`} />
              <span>
                <span className="block font-medium text-nickel-900">Use a stored funding call</span>
                <span className="mt-1 block text-sm text-nickel-600">
                  Pick from calls already in the library. No extraction needed.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSourceMode('url')}
              className={`flex items-start rounded-lg border-2 p-4 text-left transition-colors ${
                sourceMode === 'url' ? 'border-green-600 bg-green-50' : 'border-nickel-200 hover:border-nickel-300'
              }`}
            >
              <FaGlobe className={`mr-3 mt-1 ${sourceMode === 'url' ? 'text-green-600' : 'text-nickel-400'}`} />
              <span>
                <span className="block font-medium text-nickel-900">Not in the library? Use the call URL</span>
                <span className="mt-1 block text-sm text-nickel-600">
                  We read the call page or guidelines PDF and pull out its terms and rules.
                </span>
              </span>
            </button>
          </div>

          <div className="space-y-6">
            {/* ---------------- Library mode ---------------- */}
            {sourceMode === 'library' ? (
              <div>
                <label htmlFor="fundingCallId" className="mb-1 block text-sm font-medium text-nickel-700">
                  Funding call*
                </label>

                {loadingCalls ? (
                  <div className="flex items-center rounded-md border border-nickel-300 px-3 py-2 text-sm text-nickel-500">
                    <FaSpinner className="mr-2 animate-spin" />
                    Loading funding calls...
                  </div>
                ) : calls.length === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    No funding calls are available to your account yet. Switch to{' '}
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => setSourceMode('url')}
                    >
                      the call URL route
                    </button>{' '}
                    to start from the agency's own page.
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={callSearch}
                      onChange={(event) => setCallSearch(event.target.value)}
                      placeholder="Search by scheme or agency..."
                      className="mb-2 w-full rounded-md border border-nickel-300 px-3 py-2 text-sm shadow-sm focus:border-cobalt-600 focus:ring-cobalt-500"
                    />
                    <select
                      id="fundingCallId"
                      value={fundingCallId}
                      onChange={(event) => setFundingCallId(event.target.value)}
                      size={Math.min(6, Math.max(3, filteredCalls.length))}
                      className={`w-full rounded-md border px-3 py-2 shadow-sm focus:border-cobalt-600 focus:ring-cobalt-500 ${
                        validationErrors.fundingCallId ? 'border-red-300' : 'border-nickel-300'
                      }`}
                    >
                      {filteredCalls.length === 0 ? (
                        <option value="">No calls match that search</option>
                      ) : null}
                      {filteredCalls.map((call) => (
                        <option key={call.id} value={call.id}>
                          {call.title}
                          {call.agencyName ? ` - ${call.agencyName}` : ''}
                          {call.readinessLabel ? ` [${call.readinessLabel}]` : ''}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                {validationErrors.fundingCallId ? (
                  <p className="mt-1 text-sm text-red-600">{validationErrors.fundingCallId}</p>
                ) : null}

                {selectedCall ? (
                  <div className="mt-3 rounded-md bg-nickel-50 p-3 text-sm text-nickel-700">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{selectedCall.agencyName || 'Funding agency'}</span>
                      {selectedCall.readiness ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            READINESS_STYLES[selectedCall.readiness] || 'bg-nickel-100 text-nickel-700'
                          }`}
                        >
                          {selectedCall.readinessLabel}
                        </span>
                      ) : null}
                    </div>
                    {selectedCall.deadlineAt ? (
                      <div className="mt-1 text-nickel-500">
                        Deadline: {new Date(selectedCall.deadlineAt).toLocaleDateString()}
                      </div>
                    ) : null}
                    {selectedCall.summary ? <p className="mt-2 line-clamp-3">{selectedCall.summary}</p> : null}
                    {selectedCall.readiness ? (
                      <p className="mt-2 text-xs text-nickel-500">{READINESS_HELP[selectedCall.readiness]}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ---------------- URL mode ---------------- */}
            {sourceMode === 'url' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-nickel-700">
                  Funding call URL*
                </label>
                <p className="mb-2 text-sm text-nickel-500">
                  The call page, or better, the guidelines / application format PDF. Add up to three links if the
                  terms are spread across pages.
                </p>

                <div className="space-y-2">
                  {urls.map((url, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <FaLink className="flex-shrink-0 text-nickel-400" />
                      <input
                        type="url"
                        value={url}
                        onChange={(event) => {
                          const next = [...urls]
                          next[index] = event.target.value
                          setUrls(next)
                          setAnalyzed(null)
                          setCheckResults(null)
                        }}
                        placeholder="https://agency.gov/scheme/guidelines.pdf"
                        className={`w-full rounded-md border px-3 py-2 shadow-sm focus:border-cobalt-600 focus:ring-cobalt-500 ${
                          validationErrors.urls ? 'border-red-300' : 'border-nickel-300'
                        }`}
                      />
                      {urls.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setUrls(urls.filter((_, position) => position !== index))
                            setAnalyzed(null)
                            setCheckResults(null)
                          }}
                          className="rounded p-2 text-nickel-400 hover:bg-red-50 hover:text-red-600"
                          title="Remove"
                        >
                          <FaTrash />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {urls.length < 3 ? (
                  <button
                    type="button"
                    onClick={() => setUrls([...urls, ''])}
                    className="mt-2 inline-flex items-center text-sm text-green-700 hover:text-green-800"
                  >
                    <FaPlus className="mr-1" /> Add another link
                  </button>
                ) : null}

                {validationErrors.urls ? (
                  <p className="mt-1 text-sm text-red-600">{validationErrors.urls}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCheckUrls}
                    disabled={checking || analyzing}
                    className="inline-flex items-center rounded-md border border-nickel-300 px-3 py-2 text-sm text-nickel-700 hover:bg-nickel-50 disabled:opacity-50"
                  >
                    {checking ? <FaSpinner className="mr-2 animate-spin" /> : null}
                    Check links
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAnalyze(false)}
                    disabled={analyzing || checking}
                    className="inline-flex items-center rounded-md bg-cobalt-600 px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-700 disabled:bg-gray-400"
                  >
                    {analyzing ? <FaSpinner className="mr-2 animate-spin" /> : null}
                    {analyzed ? 'Re-analyze call' : 'Analyze call'}
                  </button>
                  {analyzed?.diagnostics?.reused ? (
                    <button
                      type="button"
                      onClick={() => handleAnalyze(true)}
                      disabled={analyzing}
                      className="inline-flex items-center rounded-md border border-nickel-300 px-3 py-2 text-sm text-nickel-600 hover:bg-nickel-50 disabled:opacity-50"
                      title="Ignore the cached extraction and read the pages again"
                    >
                      Force fresh extraction
                    </button>
                  ) : null}
                </div>

                {/* Link check results */}
                {checkResults ? (
                  <ul className="mt-3 space-y-1 text-sm">
                    {checkResults.map((result, index) => (
                      <li key={index} className="flex items-start">
                        {result.ok ? (
                          <FaCheckCircle className="mr-2 mt-1 flex-shrink-0 text-green-600" />
                        ) : (
                          <FaTimesCircle className="mr-2 mt-1 flex-shrink-0 text-red-500" />
                        )}
                        <span className="text-nickel-700">
                          <span className="break-all">{result.url}</span>
                          {result.ok ? (
                            <span className="text-nickel-500">
                              {' '}
                              — {result.kind.toUpperCase()}, {result.chars.toLocaleString()} characters of text
                            </span>
                          ) : (
                            <span className="text-red-600"> — {result.message}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* Extraction preview */}
                {context ? (
                  <div className="mt-4 rounded-lg border border-green-200 bg-green-50/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-nickel-900">{context.title}</h3>
                      <div className="flex items-center gap-2 text-xs">
                        {diagnostics?.reused ? (
                          <span className="rounded-full bg-cobalt-100 px-2 py-0.5 text-cobalt-800">
                            Reused earlier extraction (no tokens spent)
                          </span>
                        ) : null}
                        {typeof diagnostics?.confidence === 'number' ? (
                          <span className="rounded-full bg-nickel-100 px-2 py-0.5 text-nickel-700">
                            Confidence {(diagnostics.confidence * 100).toFixed(0)}%
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-nickel-600">{context.agency_name}</p>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <div className="rounded-md bg-white p-2 text-center">
                        <div className="text-lg font-semibold text-nickel-900">
                          {context.template_sections?.length || 0}
                        </div>
                        <div className="text-xs text-nickel-500">sections</div>
                      </div>
                      <div className="rounded-md bg-white p-2 text-center">
                        <div className="text-lg font-semibold text-nickel-900">
                          {context.scoring_criteria?.length || context.evaluation_criteria?.length || 0}
                        </div>
                        <div className="text-xs text-nickel-500">criteria</div>
                      </div>
                      <div className="rounded-md bg-white p-2 text-center">
                        <div className="text-lg font-semibold text-nickel-900">{context.dos?.length || 0}</div>
                        <div className="text-xs text-nickel-500">must address</div>
                      </div>
                      <div className="rounded-md bg-white p-2 text-center">
                        <div className="text-lg font-semibold text-nickel-900">
                          {context.submission_rules?.length || 0}
                        </div>
                        <div className="text-xs text-nickel-500">submission rules</div>
                      </div>
                    </div>

                    {context.template_sections?.length ? (
                      <div className="mt-3 rounded-md bg-white p-3">
                        <h4 className="text-sm font-medium text-nickel-700">Sections the reviewer will score</h4>
                        <ul className="mt-1 space-y-1 text-sm text-nickel-800">
                          {context.template_sections.slice(0, 12).map((section: any) => (
                            <li key={section.key} className="flex items-baseline justify-between gap-2">
                              <span>{section.label}</span>
                              <span className="text-xs text-nickel-500">
                                {section.wordLimit
                                  ? `${section.wordLimit} words`
                                  : section.charLimit
                                    ? `${section.charLimit} chars`
                                    : section.bucketLabel}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <RuleList
                        title="Evaluation criteria"
                        items={(context.scoring_criteria || []).map((criterion: any) =>
                          criterion.weight !== null && criterion.weight !== undefined
                            ? `${criterion.label} (${criterion.weight})`
                            : criterion.label
                        )}
                        tone="blue"
                      />
                      <RuleList title="Must address" items={context.dos} tone="green" />
                      <RuleList title="Avoid" items={context.donts} tone="red" />
                      <RuleList title="Format rules" items={context.format_rules} />
                    </div>

                    {diagnostics?.warnings?.length ? (
                      <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                        <div className="font-medium">Worth checking</div>
                        <ul className="mt-1 list-inside list-disc">
                          {diagnostics.warnings.map((warning: string, index: number) => (
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <p className="mt-3 text-xs text-nickel-500">
                      Anything missing or wrong? Add corrections in the manual rubric below — they take priority
                      over the extracted rules.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ---------------- Shared fields ---------------- */}
            <div>
              <label htmlFor="projectTitle" className="mb-1 block text-sm font-medium text-nickel-700">
                Project title*
              </label>
              <input
                id="projectTitle"
                type="text"
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                className={`w-full rounded-md border px-3 py-2 shadow-sm focus:border-cobalt-600 focus:ring-cobalt-500 ${
                  validationErrors.projectTitle ? 'border-red-300' : 'border-nickel-300'
                }`}
                placeholder="Enter your proposal title"
              />
              {validationErrors.projectTitle ? (
                <p className="mt-1 text-sm text-red-600">{validationErrors.projectTitle}</p>
              ) : null}
            </div>

            <div className="rounded-md border border-nickel-200">
              <button
                type="button"
                onClick={() => setShowRubric(!showRubric)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-medium text-nickel-700">
                    Manual reviewer rubric (optional)
                  </span>
                  <span className="mt-0.5 block text-xs text-nickel-500">
                    Extra criteria, signals, must-address points, and format rules. Layered on top of the call's own
                    rules.
                  </span>
                </span>
                {showRubric ? <FaChevronUp className="text-nickel-400" /> : <FaChevronDown className="text-nickel-400" />}
              </button>
              {showRubric ? (
                <div className="border-t border-nickel-200 p-4">
                  <textarea
                    id="manualRubric"
                    value={manualRubricText}
                    onChange={(event) => setManualRubricText(event.target.value)}
                    rows={10}
                    className={`w-full rounded-md border px-3 py-2 font-mono text-sm shadow-sm focus:border-cobalt-600 focus:ring-cobalt-500 ${
                      validationErrors.manualRubric ? 'border-red-300' : 'border-nickel-300'
                    }`}
                  />
                  {validationErrors.manualRubric ? (
                    <p className="mt-1 text-sm text-red-600">{validationErrors.manualRubric}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <label className="flex items-start gap-2 text-sm text-nickel-700">
              <input
                type="checkbox"
                checked={seedSections}
                onChange={(event) => setSeedSections(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-nickel-300 text-green-600 focus:ring-cobalt-500"
              />
              <span>
                Create empty sections up front from the call's structure
                <span className="block text-xs text-nickel-500">
                  You then paste your draft into each one. Uncheck to add sections manually as you go.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-8">
            <button
              type="submit"
              disabled={
                submitting ||
                analyzing ||
                (sourceMode === 'library' && (loadingCalls || calls.length === 0))
              }
              className="flex w-full items-center justify-center rounded-md bg-cobalt-600 px-4 py-3 font-medium text-white hover:bg-cobalt-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? (
                <>
                  <FaSpinner className="mr-2 animate-spin" />
                  Creating reviewer workspace...
                </>
              ) : (
                'Create reviewer workspace'
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
