// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { countProposalWords } from '@/lib/reviewer/proposalSplit'
import ReviewerShell from '@/components/reviewer/ReviewerShell'

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
  manual: 'Moved here by you',
}

const MATCH_STYLES = {
  title: 'bg-green-100 text-green-800',
  alias: 'bg-green-100 text-green-800',
  synonym: 'bg-green-100 text-green-800',
  tokens: 'bg-cobalt-100 text-cobalt-800',
  bucket: 'bg-cobalt-100 text-cobalt-800',
  continuation: 'bg-cobalt-100 text-cobalt-800',
  excluded: 'bg-nickel-200 text-nickel-700',
  none: 'bg-amber-100 text-amber-800',
  manual: 'bg-cobalt-100 text-cobalt-800',
}

export default function ImportProposalPage() {
  const { status } = useSession()
  const router = useRouter()
  const { id } = router.query
  const fileInputRef = useRef(null)

  const [call, setCall] = useState(null)
  const [sections, setSections] = useState([])
  const [text, setText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')

  // Only for the workspace chrome — the import itself needs neither.
  useEffect(() => {
    const loadWorkspace = async () => {
      if (!id || status !== 'authenticated') return
      try {
        const [callRes, sectionsRes] = await Promise.all([
          axios.get(`/api/reviewer/calls/${id}`),
          axios.get(`/api/reviewer/calls/${id}/sections`),
        ])
        setCall(callRes.data.call)
        setSections(sectionsRes.data.sections || [])
      } catch (loadError) {
        console.error('Error loading workspace chrome:', loadError)
      }
    }
    loadWorkspace()
  }, [id, status])
  const [preview, setPreview] = useState(null)
  // Blocks, not segments: a block starts as one segment but can be split when
  // the splitter swept two sections into one and the user pulls part of the
  // text back out.
  const [blocks, setBlocks] = useState([])
  const [selection, setSelection] = useState(null)
  const [result, setResult] = useState(null)
  const [expanded, setExpanded] = useState({})
  const bodyRefs = useRef({})

  const targets = preview?.targets || []

  const seedBlocks = (segments) =>
    (segments || []).map((segment) => ({
      key: String(segment.order),
      heading: segment.heading,
      body: segment.body,
      words: segment.words,
      matchedBy: segment.matchedBy,
      target: segment.targetTitle || SKIP_VALUE,
      split: false,
    }))

  const assignedCounts = useMemo(() => {
    const counts = {}
    for (const block of blocks) {
      if (!block.target || block.target === SKIP_VALUE) continue
      counts[block.target] = (counts[block.target] || 0) + 1
    }
    return counts
  }, [blocks])

  const unassignedCount = useMemo(
    () => blocks.filter((block) => !block.target || block.target === SKIP_VALUE).length,
    [blocks]
  )

  const hasSplits = useMemo(() => blocks.some((block) => block.split), [blocks])

  /**
   * Where the current selection sits inside the block's own text.
   *
   * Measured against the rendered container rather than by searching for the
   * string, so repeating a phrase twice in one block still moves the copy the
   * user actually highlighted.
   */
  const captureSelection = (blockKey) => {
    const active = typeof window !== 'undefined' ? window.getSelection() : null
    if (!active || active.isCollapsed || active.rangeCount === 0) {
      setSelection(null)
      return
    }

    const text = active.toString()
    if (!text.trim()) {
      setSelection(null)
      return
    }

    const container = bodyRefs.current[blockKey]
    const range = active.getRangeAt(0)
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setSelection(null)
      return
    }

    const upToStart = document.createRange()
    upToStart.selectNodeContents(container)
    upToStart.setEnd(range.startContainer, range.startOffset)
    const start = upToStart.toString().length

    setSelection({ key: blockKey, start, end: start + text.length, text })
  }

  /** Pull the highlighted run out of its block and give it its own section. */
  const moveSelectionTo = (targetTitle) => {
    if (!selection) return
    const { key, start, end } = selection

    setBlocks((previous) => {
      const index = previous.findIndex((block) => block.key === key)
      if (index === -1) return previous

      const block = previous[index]
      const before = block.body.slice(0, start).trim()
      const moved = block.body.slice(start, end).trim()
      const after = block.body.slice(end).trim()
      if (!moved) return previous

      const parts = []
      const push = (body, target, isMoved) => {
        if (!body) return
        parts.push({
          ...block,
          key: `${block.key}::${parts.length}`,
          // The heading names the original section, so it stays with the first
          // piece that remains there.
          heading: parts.length === 0 ? block.heading : '',
          body,
          words: countProposalWords(body),
          matchedBy: isMoved ? 'manual' : block.matchedBy,
          target,
          split: true,
        })
      }

      push(before, block.target, false)
      push(moved, targetTitle, true)
      push(after, block.target, false)

      return [...previous.slice(0, index), ...parts, ...previous.slice(index + 1)]
    })

    setSelection(null)
    if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges()
  }

  const resetSplits = () => {
    setBlocks(seedBlocks(preview?.segments))
    setSelection(null)
  }

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
      setBlocks(seedBlocks(response.data.segments))
      setSelection(null)
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
    const payload = blocks
      .filter((block) => block.target && block.target !== SKIP_VALUE)
      .map((block) => ({
        targetTitle: block.target,
        heading: block.heading,
        body: block.body,
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
    <ReviewerShell call={call || { id }} sections={sections} title="Import proposal">
        {error ? (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="nk-panel p-6">
            <h2 className="text-lg font-semibold text-nickel-900 flex items-center">
              <FaCheck className="text-green-600 mr-2" /> Import complete
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              {result.written.map((item) => (
                <li key={item.sectionId} className="flex items-center justify-between rounded bg-nickel-50 px-4 py-2">
                  <span className="font-medium text-nickel-900">{item.title}</span>
                  <span className="text-nickel-600">
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
                className="inline-flex items-center px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700"
              >
                Review these sections
              </Link>
              <button
                type="button"
                onClick={() => {
                  setResult(null)
                  setText('')
                }}
                className="inline-flex items-center px-4 py-2 bg-nickel-100 text-nickel-700 rounded hover:bg-nickel-200"
              >
                Import another document
              </button>
            </div>
          </div>
        ) : null}

        {!preview && !result ? (
          <div className="nk-panel p-6">
            <h2 className="text-lg font-semibold text-nickel-900">Paste or upload your proposal</h2>
            <p className="mt-1 text-sm text-nickel-600">
              The splitter reads your headings and matches them to the sections this call requires.
              Nothing is saved until you approve the mapping, and no AI credits are used for the split.
            </p>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={14}
              placeholder="Paste the full proposal text, including its section headings…"
              className="mt-4 w-full rounded-md border border-nickel-300 p-3 font-mono text-sm focus:border-blue-500 focus:ring-blue-500"
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAnalyzeText}
                disabled={analyzing}
                className="inline-flex items-center px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700 disabled:bg-blue-300"
              >
                {analyzing ? <FaSpinner className="animate-spin mr-2" /> : <FaMagic className="mr-2" />}
                Split into sections
              </button>

              <span className="text-sm text-nickel-500">or</span>

              <label className="inline-flex items-center px-4 py-2 bg-nickel-100 text-nickel-700 rounded hover:bg-nickel-200 cursor-pointer">
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
            <div className="nk-panel p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-nickel-900">
                    Check the mapping before importing
                  </h2>
                  <p className="mt-1 text-sm text-nickel-600">
                    {blocks.length} block(s) · {preview.words.toLocaleString()} words
                    {preview.filename ? ` · ${preview.filename}` : ''}
                  </p>
                  {preview.splitMode === 'format' ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Split along the call&apos;s own section format
                      {preview.formatLinesRemoved > 0
                        ? ` · ${preview.formatLinesRemoved} format instruction line(s) removed`
                        : ''}
                    </p>
                  ) : preview.formatLinesRemoved > 0 ? (
                    <p className="mt-1 text-xs text-nickel-500">
                      {preview.formatLinesRemoved} format instruction line(s) removed
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="inline-flex items-center px-4 py-2 bg-nickel-100 text-nickel-700 rounded hover:bg-nickel-200"
                  >
                    Start over
                  </button>
                  {hasSplits ? (
                    <button
                      type="button"
                      onClick={resetSplits}
                      className="inline-flex items-center rounded border border-nickel-300 px-4 py-2 text-nickel-700 hover:bg-nickel-50"
                    >
                      Undo my splits
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleCommit}
                    disabled={committing}
                    className="inline-flex items-center px-4 py-2 bg-cobalt-600 text-white rounded hover:bg-cobalt-700 disabled:bg-green-300"
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
                <h3 className="text-sm font-medium text-nickel-700">Section coverage</h3>
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
                              ? 'bg-nickel-100 text-nickel-700'
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
              {blocks.map((block) => {
                const assigned = block.target || SKIP_VALUE
                const target = targets.find((item) => item.title === assigned)
                const overWordLimit =
                  target?.wordLimit && block.words > target.wordLimit ? target.wordLimit : null
                const activeSelection = selection?.key === block.key ? selection : null

                return (
                  <div key={block.key} className="nk-panel">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-nickel-100 px-5 py-4">
                      <div className="min-w-0">
                        <div className="font-medium text-nickel-900 break-words">
                          {block.heading || <span className="italic text-nickel-500">Untitled opening block</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full px-2 py-0.5 ${MATCH_STYLES[block.matchedBy]}`}>
                            {MATCH_LABELS[block.matchedBy]}
                          </span>
                          <span className="text-nickel-500">{block.words} words</span>
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
                          setBlocks((previous) =>
                            previous.map((item) =>
                              item.key === block.key ? { ...item, target: event.target.value } : item
                            )
                          )
                        }
                        className="rounded-md border border-nickel-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
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
                      <p
                        ref={(node) => {
                          bodyRefs.current[block.key] = node
                        }}
                        onMouseUp={() => captureSelection(block.key)}
                        onKeyUp={() => captureSelection(block.key)}
                        className={`whitespace-pre-line text-sm text-nickel-700 ${expanded[block.key] ? '' : 'line-clamp-3'}`}
                      >
                        {block.body}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {block.body.length > 240 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((previous) => ({ ...previous, [block.key]: !previous[block.key] }))
                            }
                            className="text-sm text-cobalt-700 hover:text-cobalt-800"
                          >
                            {expanded[block.key] ? 'Show less' : 'Show full text'}
                          </button>
                        ) : null}
                        {!activeSelection ? (
                          <span className="text-xs text-nickel-500">
                            Wrong split? Highlight the part that belongs elsewhere to move it.
                          </span>
                        ) : null}
                      </div>

                      {/* Rescue hatch for a block the splitter merged: move just
                          the highlighted run to its real section. */}
                      {activeSelection ? (
                        <div className="mt-3 rounded-md border border-cobalt-200 bg-cobalt-50 p-3">
                          <p className="text-xs text-cobalt-900">
                            Move the highlighted {countProposalWords(activeSelection.text)} word
                            {countProposalWords(activeSelection.text) === 1 ? '' : 's'} to:
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs italic text-nickel-600">
                            “{activeSelection.text.trim().slice(0, 160)}
                            {activeSelection.text.trim().length > 160 ? '…' : ''}”
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select
                              defaultValue=""
                              onChange={(event) => {
                                if (event.target.value) moveSelectionTo(event.target.value)
                              }}
                              className="rounded-md border border-cobalt-300 px-3 py-2 text-sm"
                            >
                              <option value="">Choose a section…</option>
                              {targets
                                .filter((item) => item.title !== assigned)
                                .map((item) => (
                                  <option key={item.title} value={item.title}>
                                    {item.title}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                setSelection(null)
                                if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges()
                              }}
                              className="text-sm text-nickel-600 hover:text-nickel-800"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
    </ReviewerShell>
  )
}
