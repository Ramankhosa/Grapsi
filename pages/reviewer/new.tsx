// @ts-nocheck
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client'
import { useRouter } from 'next/router'
import axios from 'axios'
import Link from 'next/link'
import Head from 'next/head'
import { FaArrowLeft, FaExclamationTriangle, FaSpinner } from 'react-icons/fa'

type FundingCallOption = {
  id: string
  title: string
  agencyName?: string | null
  summary?: string | null
  deadlineAt?: string | null
  templateStatus?: string
}

const DEFAULT_RUBRIC = {
  evaluationCriteria: [],
  reviewerSignals: [],
  mustAddress: [],
  avoid: [],
  formatRules: [],
}

export default function NewReviewerCall() {
  const { status } = useSession()
  const router = useRouter()
  const [calls, setCalls] = useState<FundingCallOption[]>([])
  const [fundingCallId, setFundingCallId] = useState('')
  const [projectTitle, setProjectTitle] = useState('')
  const [manualRubricText, setManualRubricText] = useState(JSON.stringify(DEFAULT_RUBRIC, null, 2))
  const [seedSections, setSeedSections] = useState(true)
  const [loadingCalls, setLoadingCalls] = useState(true)
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
        setError('Failed to load approved funding templates.')
      } finally {
        setLoadingCalls(false)
      }
    }

    void loadCalls()
  }, [status])

  const selectedCall = useMemo(
    () => calls.find((call) => call.id === fundingCallId) || null,
    [calls, fundingCallId]
  )

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!fundingCallId) errors.fundingCallId = 'Select an approved funding template.'
    if (!projectTitle.trim()) errors.projectTitle = 'Project title is required.'
    try {
      JSON.parse(manualRubricText || '{}')
    } catch {
      errors.manualRubric = 'Manual rubric must be valid JSON.'
    }
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    try {
      setSubmitting(true)
      setError('')
      const response = await axios.post('/api/reviewer/calls', {
        fundingCallId,
        project_title: projectTitle.trim(),
        manualRubric: JSON.parse(manualRubricText || '{}'),
        seedSections,
      })
      router.push(`/reviewer/${response.data.call.id}`)
    } catch (nextError) {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>New Template Reviewer - AI Grant Reviewer</title>
      </Head>

      <header className="bg-gradient-to-r from-green-800 to-green-600 shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-3xl font-bold text-white">New Template Reviewer</h1>
            <p className="mt-1 text-green-100">Start from an approved funding template</p>
          </div>
          <Link
            href="/reviewer"
            className="flex items-center rounded-md bg-white/10 px-4 py-2 text-white transition-all hover:bg-white/20"
          >
            <FaArrowLeft className="mr-2" />
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <form onSubmit={handleSubmit} className="rounded-lg bg-white p-6 shadow-md">
          {error ? (
            <div className="mb-6 flex items-center rounded-md bg-red-50 p-4 text-red-600">
              <FaExclamationTriangle className="mr-2" />
              {error}
            </div>
          ) : null}

          <div className="space-y-6">
            <div>
              <label htmlFor="fundingCallId" className="mb-1 block text-sm font-medium text-gray-700">
                Approved Funding Template*
              </label>
              {loadingCalls ? (
                <div className="flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-500">
                  <FaSpinner className="mr-2 animate-spin" />
                  Loading templates...
                </div>
              ) : (
                <select
                  id="fundingCallId"
                  value={fundingCallId}
                  onChange={(event) => setFundingCallId(event.target.value)}
                  className={`w-full rounded-md border px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 ${
                    validationErrors.fundingCallId ? 'border-red-300' : 'border-gray-300'
                  }`}
                >
                  {calls.length === 0 ? (
                    <option value="">No approved templates available</option>
                  ) : null}
                  {calls.map((call) => (
                    <option key={call.id} value={call.id}>
                      {call.title} {call.agencyName ? `- ${call.agencyName}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {validationErrors.fundingCallId ? (
                <p className="mt-1 text-sm text-red-600">{validationErrors.fundingCallId}</p>
              ) : null}
              {selectedCall ? (
                <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                  <div className="font-medium">{selectedCall.agencyName || 'Funding agency'}</div>
                  {selectedCall.deadlineAt ? (
                    <div className="mt-1 text-gray-500">Deadline: {new Date(selectedCall.deadlineAt).toLocaleDateString()}</div>
                  ) : null}
                  {selectedCall.summary ? (
                    <p className="mt-2 line-clamp-3">{selectedCall.summary}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor="projectTitle" className="mb-1 block text-sm font-medium text-gray-700">
                Project Title*
              </label>
              <input
                id="projectTitle"
                type="text"
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                className={`w-full rounded-md border px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 ${
                  validationErrors.projectTitle ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Enter your proposal title"
              />
              {validationErrors.projectTitle ? (
                <p className="mt-1 text-sm text-red-600">{validationErrors.projectTitle}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="manualRubric" className="mb-1 block text-sm font-medium text-gray-700">
                Manual Reviewer Rubric
              </label>
              <textarea
                id="manualRubric"
                value={manualRubricText}
                onChange={(event) => setManualRubricText(event.target.value)}
                rows={12}
                className={`w-full rounded-md border px-3 py-2 font-mono text-sm shadow-sm focus:border-green-500 focus:ring-green-500 ${
                  validationErrors.manualRubric ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              {validationErrors.manualRubric ? (
                <p className="mt-1 text-sm text-red-600">{validationErrors.manualRubric}</p>
              ) : null}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={seedSections}
                onChange={(event) => setSeedSections(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              Seed reviewer sections from template buckets
            </label>
          </div>

          <div className="mt-8">
            <button
              type="submit"
              disabled={submitting || loadingCalls || calls.length === 0}
              className="flex w-full items-center justify-center rounded-md bg-green-600 px-4 py-3 font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? (
                <>
                  <FaSpinner className="mr-2 animate-spin" />
                  Creating Reviewer...
                </>
              ) : (
                'Create Reviewer'
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
