// @ts-nocheck
import { useMemo, useRef, useState } from 'react'
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client'
import { useRouter } from 'next/router'
import axios from 'axios'
import Link from 'next/link'
import Head from 'next/head'
import {
  FaArrowLeft,
  FaCheck,
  FaExclamationTriangle,
  FaFileUpload,
  FaMagic,
  FaSpinner,
} from 'react-icons/fa'

const SKIP_VALUE = '__skip__'

const MATCH_LABELS = {
  title: 'Matched section title',
  alias: 'Matched a call template heading',
  synonym: 'Recognised section name',
  tokens: 'Matched on keywords',
  bucket: 'Matched by topic',
  continuation: 'Continues the block above',
  excluded: 'Reference or annexure — not imported',
  none: 'Not matched — choose a section',
}

const MATCH_STYLES = {
  title: 'bg-green-100 text-green-800',
  alias: 'bg-green-100 text-green-800',
  synonym: 'bg-green-100 text-green-800',
  tokens: 'bg-blue-100 text-blue-800',
  bucket: 'bg-blue-100 text-blue-800',
  continuation: 'bg-blue-100 text-blue-800',
  excluded: 'bg-gray-200 text-gray-700',
  none: 'bg-amber-100 text-amber-800',
}

export default function ImportProposalPage() {
  const { status } = useSession()
  const router = useRouter()
  const { id } = router.query
  const fileInputRef = useRef(null)

  const [text, setText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [assignments, setAssignments] = useState({})
  const [result, setResult] = useState(null)
  const [expanded, setExpanded] = useState({})

  const targets = preview?.targets || []

  const assignedCounts = useMemo(() => {
    const counts = {}
    for (const segment of preview?.segments || []) {
      const target = assignments[segment.order]
      if (!target || target === SKIP_VALUE) continue
      counts[target] = (counts[target] || 0) + 1
    }
    return counts
  }, [preview, assignments])

  const unassignedCount = useMemo(
    () =>
      (preview?.segments || []).filter(
        (segment) => !assignments[segment.order] || assignments[segment.order] === SKIP_VALUE
      ).length,
    [preview, assignments]
  )

  const runPreview = async (payload, isFile) => {
    setAnalyzing(true)
    setError('')
    setResult(null)

    try {
      const response = isFile
        ? await axios.post(`/api/reviewer/calls/${id}/import-proposal`, payload, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        : await axios.post(`/api/reviewer/calls/${id}/import-proposal`, payload)

      setPreview(response.data)
      // Seed the dropdowns with what the matcher decided; the user overrides
      // only what it got wrong.
      const seeded = {}
      for (const segment of response.data.segments || []) {
        seeded[segment.order] = segment.targetTitle || SKIP_VALUE
      }
      setAssignments(seeded)
    } catch (nextError) {
      setError(
        nextError?.response?.data?.error ||
          'Could not read that proposal. Paste the text directly if the file is a scan.'
      )
      setPreview(null)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleAnalyzeText = () => {
    if (!text.trim()) {
      setError('Paste your proposal text first, or upload the file.')
      return
    }
    runPreview({ text }, false)
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    await runPreview(form, true)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCommit = async () => {
    const payload = (preview?.segments || [])
      .filter((segment) => assignments[segment.order] && assignments[segment.order] !== SKIP_VALUE)
      .map((segment) => ({
        targetTitle: assignments[segment.order],
        heading: segment.heading,
        body: segment.body,
      }))

    if (payload.length === 0) {
      setError('Assign at least one block to a section before importing.')
      return
    }

    setCommitting(true)
    setError('')

    try {
      const response = await axios.post(`/api/reviewer/calls/${id}/import-proposal`, {
        action: 'commit',
        assignments: payload,
      })
      setResult(response.data)
      setPreview(null)
    } catch (nextError) {
      setError(nextError?.response?.data?.error || 'Failed to import the sections.')
    } finally {
      setCommitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>Import Full Proposal - AI Grant Reviewer</title>
      </Head>

      <header className="bg-gradient-to-r from-blue-800 to-blue-600 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Import Full Proposal</h1>
              <p className="mt-1 text-blue-100">
                Split one document into the sections this call asks for
              </p>
            </div>
            <Link
              href={`/reviewer/${id}`}
              className="flex items-center text-white bg-white/10 px-4 py-2 rounded-md hover:bg-white/20 transition-all"
            >
              <FaArrowLeft className="mr-2" />
              Back to Project
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error ? (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <FaCheck className="text-green-600 mr-2" /> Import complete
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              {result.written.map((item) => (
                <li key={item.sectionId} className="flex items-center justify-between rounded bg-gray-50 px-4 py-2">
                  <span className="font-medium text-gray-900">{item.title}</span>
                  <span className="text-gray-600">
                    {item.mode === 'filled'
                      ? 'filled the empty section'
                      : item.mode === 'revision'
                        ? `saved as version ${item.version}`
                        : 'created a new section'}
                  </span>
                </li>
              ))}
            </ul>
            {result.skipped?.length > 0 ? (
              <p className="mt-4 text-sm text-amber-700">
                {result.skipped.length} assignment(s) were skipped for having no usable text.
              </p>
            ) : null}
            <div className="mt-6 flex gap-3">
              <Link
                href={`/reviewer/${id}`}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Review these sections
              </Link>
              <button
                type="button"
                onClick={() => {
                  setResult(null)
                  setText('')
                }}
                className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Import another document
              </button>
            </div>
          </div>
        ) : null}

        {!preview && !result ? (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900">Paste or upload your proposal</h2>
            <p className="mt-1 text-sm text-gray-600">
              The splitter reads your headings and matches them to the sections this call requires.
              Nothing is saved until you approve the mapping, and no AI credits are used for the split.
            </p>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={14}
              placeholder="Paste the full proposal text, including its section headings…"
              className="mt-4 w-full rounded-md border border-gray-300 p-3 font-mono text-sm focus:border-blue-500 focus:ring-blue-500"
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAnalyzeText}
                disabled={analyzing}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300"
              >
                {analyzing ? <FaSpinner className="animate-spin mr-2" /> : <FaMagic className="mr-2" />}
                Split into sections
              </button>

              <span className="text-sm text-gray-500">or</span>

              <label className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 cursor-pointer">
                <FaFileUpload className="mr-2" />
                Upload PDF / DOCX / TXT
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={analyzing}
                />
              </label>
            </div>
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Check the mapping before importing
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {preview.segments.length} block(s) found · {preview.words.toLocaleString()} words
                    {preview.filename ? ` · ${preview.filename}` : ''}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  >
                    Start over
                  </button>
                  <button
                    type="button"
                    onClick={handleCommit}
                    disabled={committing}
                    className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-300"
                  >
                    {committing ? <FaSpinner className="animate-spin mr-2" /> : <FaCheck className="mr-2" />}
                    Import assigned sections
                  </button>
                </div>
              </div>

              {unassignedCount > 0 ? (
                <div className="mt-4 flex items-start rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <FaExclamationTriangle className="mr-2 mt-0.5 flex-shrink-0" />
                  <span>
                    {unassignedCount} block(s) are unassigned and will not be imported. Pick a section
                    for anything the splitter could not place — title pages and annexures are usually
                    fine to leave out.
                  </span>
                </div>
              ) : null}

              {/* Coverage against the call's own required sections */}
              <div className="mt-5">
                <h3 className="text-sm font-medium text-gray-700">Section coverage</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {targets.map((target) => {
                    const count = assignedCounts[target.title] || 0
                    return (
                      <span
                        key={target.title}
                        className={`rounded-full px-3 py-1 text-xs ${
                          count > 0
                            ? 'bg-green-100 text-green-800'
                            : target.hasContent
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-red-50 text-red-700'
                        }`}
                        title={
                          target.wordLimit
                            ? `Call limit: ${target.wordLimit} words`
                            : target.charLimit
                              ? `Call limit: ${target.charLimit} characters`
                              : undefined
                        }
                      >
                        {target.title}
                        {count > 0 ? ` · ${count} block${count > 1 ? 's' : ''}` : target.hasContent ? ' · already filled' : ' · empty'}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {preview.segments.map((segment) => {
                const assigned = assignments[segment.order] || SKIP_VALUE
                const target = targets.find((item) => item.title === assigned)
                const overWordLimit =
                  target?.wordLimit && segment.words > target.wordLimit ? target.wordLimit : null

                return (
                  <div key={segment.order} className="bg-white rounded-lg shadow">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 break-words">
                          {segment.heading || <span className="italic text-gray-500">Untitled opening block</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full px-2 py-0.5 ${MATCH_STYLES[segment.matchedBy]}`}>
                            {MATCH_LABELS[segment.matchedBy]}
                          </span>
                          <span className="text-gray-500">{segment.words} words</span>
                          {overWordLimit ? (
                            <span className="text-red-700">
                              over the call's {overWordLimit}-word limit for this section
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <select
                        value={assigned}
                        onChange={(event) =>
                          setAssignments((prev) => ({ ...prev, [segment.order]: event.target.value }))
                        }
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value={SKIP_VALUE}>Do not import</option>
                        {targets.map((item) => (
                          <option key={item.title} value={item.title}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="px-5 py-4">
                      <p className={`whitespace-pre-line text-sm text-gray-700 ${expanded[segment.order] ? '' : 'line-clamp-3'}`}>
                        {segment.body}
                      </p>
                      {segment.body.length > 240 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [segment.order]: !prev[segment.order] }))
                          }
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                        >
                          {expanded[segment.order] ? 'Show less' : 'Show full text'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
