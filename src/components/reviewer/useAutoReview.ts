// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { compareSectionTitles, groupReviewerSections } from '@/lib/reviewer/sectionGrouping'

/**
 * Runs the whole review end to end: every section in proposal order, then the
 * cross-section panel report. Context summaries are produced by the section
 * reviews themselves.
 *
 * The redesigned workspace lost this. Each stage had become a separate page the
 * user had to find and trigger in the right order — and the final compilation
 * was a fourth manual step, so a "finished" review often had no report at all.
 * This restores one action, and reports honestly what it is doing while it runs:
 * every number on screen is a real count of completed work, never a timer
 * pretending to be progress.
 *
 * Orchestration is client-side, so the tab has to stay open. That is the same
 * constraint the old flow had; it is now stated in the UI instead of implied.
 */

const REVIEW_MAX_ATTEMPTS = 3
const BETWEEN_SECTIONS_MS = 4000
const RATE_LIMIT_BUFFER_MS = 2000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function isRateLimited(error) {
  return error?.response?.status === 429 || error?.response?.data?.code === 'GEMINI_RATE_LIMITED'
}

function retryAfterMs(error) {
  const body = Number(error?.response?.data?.retryAfterMs)
  if (Number.isFinite(body) && body > 0) return body
  const header = Number(error?.response?.headers?.['retry-after'])
  if (Number.isFinite(header) && header > 0) return header * 1000
  return 60000
}

function hasText(value) {
  const text = String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /[a-z0-9]/i.test(text)
}

// There is deliberately no context-summary phase. Each review returns its own
// context summary and later reviews only read summaries of already-reviewed
// sections, so pre-generating summaries paid for model calls whose output was
// never consumed.
export const AUTO_PHASES = [
  { key: 'reviews', label: 'Section reviews', blurb: 'Each section scored against this call\'s own rules.' },
  { key: 'report', label: 'Panel report', blurb: 'Cross-section consistency and the funding verdict.' },
]

export default function useAutoReview({ callId, onSectionsChanged, onFinished }) {
  const [phase, setPhase] = useState('idle')
  const [steps, setSteps] = useState([])
  const [log, setLog] = useState([])
  const [error, setError] = useState('')
  const [startedAt, setStartedAt] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [detail, setDetail] = useState('')
  const [waitingUntil, setWaitingUntil] = useState(null)

  const cancelRef = useRef(false)
  const runningRef = useRef(false)

  const running = ['preparing', 'reviews', 'report'].includes(phase)

  // One ticking clock for the whole run: elapsed time is the honest signal that
  // something is still happening during a long model call.
  useEffect(() => {
    if (!running || !startedAt) return
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000)
    return () => clearInterval(id)
  }, [running, startedAt])

  // Leaving mid-run abandons the queue, so say so.
  useEffect(() => {
    if (!running) return
    const warn = event => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const say = useCallback(message => {
    setDetail(message)
    setLog(entries => [
      ...entries.slice(-199),
      { at: new Date().toLocaleTimeString(), message },
    ])
  }, [])

  const patchStep = useCallback((key, changes) => {
    setSteps(current => current.map(step => (step.key === key ? { ...step, ...changes } : step)))
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
    say('Stopping after the current step…')
  }, [say])

  /** Wait, but visibly — a silent 60s pause reads as a hang. */
  const waitVisibly = useCallback(async (ms, reason) => {
    const until = Date.now() + ms
    setWaitingUntil(until)
    say(reason)
    while (Date.now() < until) {
      if (cancelRef.current) break
      await sleep(500)
    }
    setWaitingUntil(null)
  }, [say])

  const start = useCallback(async ({ rerunAll = false } = {}) => {
    if (runningRef.current) return
    runningRef.current = true
    cancelRef.current = false

    setError('')
    setLog([])
    setSteps([])
    setStartedAt(Date.now())
    setElapsedMs(0)
    setPhase('preparing')

    const finish = (nextPhase, message) => {
      setPhase(nextPhase)
      if (message) say(message)
      runningRef.current = false
      setWaitingUntil(null)
    }

    try {
      // A full re-run no longer clears reviews up front. Each section is
      // re-reviewed with `force` and keeps its existing review until the new
      // one lands, so stopping the run halfway leaves nothing stranded.
      say('Reading your sections…')
      const response = await axios.get(`/api/reviewer/calls/${callId}/sections`)
      const raw = response.data.sections || []

      // One version per title — reviewing superseded drafts wastes model calls
      // and pollutes the report.
      const groups = groupReviewerSections(raw)
      const current = groups.map(group => group.current)
      const withContent = current.filter(section => hasText(section.user_input))
      const empty = current.length - withContent.length

      if (withContent.length === 0) {
        finish('error', 'There is nothing to review yet — add a section first.')
        setError('No section has any content yet.')
        return
      }
      if (empty > 0) {
        say(`Skipping ${empty} empty section${empty === 1 ? '' : 's'}.`)
      }

      const ordered = [...withContent].sort((a, b) =>
        compareSectionTitles(a.section_title, b.section_title)
      )

      const needsReview = rerunAll
        ? ordered
        : ordered.filter(section => section.status !== 'reviewed')

      setSteps([
        ...needsReview.map(section => ({
          key: `rev:${section.id}`,
          kind: 'review',
          title: section.section_title,
          status: 'pending',
        })),
        { key: 'report', kind: 'report', title: 'Panel report', status: 'pending' },
      ])

      // ── Phase 1: section reviews ────────────────────────────────────────
      // Reviews run in proposal order; each review's own returned context
      // summary is what later sections read, so no pre-summarisation pass is
      // needed (or ever consumed when one ran).
      setPhase('reviews')
      if (needsReview.length === 0) {
        say('Every section is already reviewed.')
      }
      let reviewed = 0
      let failed = 0

      for (const [index, section] of needsReview.entries()) {
        if (cancelRef.current) return finish('cancelled', 'Stopped.')
        const key = `rev:${section.id}`
        patchStep(key, { status: 'active' })
        say(`Reviewing ${section.section_title} (${index + 1} of ${needsReview.length}) against the call's rules…`)

        let done = false
        let skippedUnchanged = false
        for (let attempt = 1; attempt <= REVIEW_MAX_ATTEMPTS && !done; attempt++) {
          try {
            const result = await axios.post(
              `/api/reviewer/calls/${callId}/section-review-with-dependencies`,
              // The run compiles the report itself at the end. Without
              // skipReportRefresh the API would rebuild the whole panel report
              // after every section. On a full re-run, skipIfUnchanged keeps
              // the existing review of any section whose text has not changed
              // instead of paying for an identical one.
              { sectionId: section.id, skipReportRefresh: true, skipIfUnchanged: rerunAll === true }
            )
            const score = result?.data?.review?.score
            patchStep(key, {
              status: 'done',
              score: typeof score === 'number' ? score : null,
            })
            skippedUnchanged = result?.data?.skipped_unchanged === true
            const used = result?.data?.used_dependency_sections || []
            say(
              skippedUnchanged
                ? `${section.section_title} unchanged — kept its existing review.`
                : used.length
                  ? `${section.section_title} reviewed — read alongside ${used.join(', ')}.`
                  : `${section.section_title} reviewed.`
            )
            reviewed++
            done = true
          } catch (reviewError) {
            if (isRateLimited(reviewError) && attempt < REVIEW_MAX_ATTEMPTS) {
              const wait = retryAfterMs(reviewError) + RATE_LIMIT_BUFFER_MS
              patchStep(key, { status: 'active', detail: 'Rate limited — waiting' })
              await waitVisibly(
                wait,
                `The model is rate limited. Waiting ${Math.ceil(wait / 1000)}s, then retrying ${section.section_title} (attempt ${attempt + 1} of ${REVIEW_MAX_ATTEMPTS}).`
              )
              if (cancelRef.current) return finish('cancelled', 'Stopped.')
              continue
            }
            patchStep(key, {
              status: 'failed',
              detail: reviewError?.response?.data?.error || 'Review failed',
            })
            say(`Could not review ${section.section_title}. Moving on.`)
            failed++
            done = true
          }
        }

        if (onSectionsChanged) await onSectionsChanged()

        // No pause after a skipped section — no model call happened.
        if (index < needsReview.length - 1 && !cancelRef.current && !skippedUnchanged) {
          await waitVisibly(BETWEEN_SECTIONS_MS, 'Pausing briefly so the model is not rate limited…')
        }
      }

      // ── Phase 2: the panel report ───────────────────────────────────────
      if (cancelRef.current) return finish('cancelled', 'Stopped.')

      setPhase('report')
      patchStep('report', { status: 'active' })

      if (reviewed === 0 && failed > 0) {
        patchStep('report', { status: 'skipped', detail: 'No section review succeeded' })
        setError('No section could be reviewed, so there is nothing to compile.')
        finish('error', 'Stopped — no section review succeeded.')
        return
      }

      say('Compiling the panel report: comparing sections against each other, checking the budget against the workplan, and forming the funding verdict…')

      // The report gets the same rate-limit patience the sections get. It used
      // to be a single unprotected attempt, so one transient 429 at the very
      // last step discarded the value of every section review that preceded it.
      let reportOk = false
      let reportFailure = ''

      for (let attempt = 1; attempt <= REVIEW_MAX_ATTEMPTS && !reportOk; attempt++) {
        try {
          await axios.post(`/api/reviewer/calls/${callId}/final-review`)
          patchStep('report', { status: 'done' })
          reportOk = true
        } catch (reportError) {
          if (isRateLimited(reportError) && attempt < REVIEW_MAX_ATTEMPTS) {
            const wait = retryAfterMs(reportError) + RATE_LIMIT_BUFFER_MS
            patchStep('report', { status: 'active', detail: 'Rate limited — waiting' })
            await waitVisibly(
              wait,
              `The model is rate limited. Waiting ${Math.ceil(wait / 1000)}s, then compiling the report again (attempt ${attempt + 1} of ${REVIEW_MAX_ATTEMPTS}).`
            )
            if (cancelRef.current) return finish('cancelled', 'Stopped.')
            continue
          }
          reportFailure = reportError?.response?.data?.error || 'Could not compile the report'
        }
      }

      if (!reportOk) {
        patchStep('report', { status: 'failed', detail: reportFailure })
        setError('The sections were reviewed, but the panel report could not be compiled. You can retry it from the workspace.')
        finish('error', 'Sections reviewed; the report failed.')
        if (onFinished) await onFinished({ reviewed, failed, reportOk: false })
        return
      }

      finish(
        'done',
        failed > 0
          ? `Done — ${reviewed} section${reviewed === 1 ? '' : 's'} reviewed, ${failed} could not be.`
          : `Done — ${reviewed} section${reviewed === 1 ? '' : 's'} reviewed and the report is ready.`
      )
      if (onFinished) await onFinished({ reviewed, failed, reportOk: true })
    } catch (fatal) {
      console.error('Auto review failed', fatal)
      setError(fatal?.response?.data?.error || 'The review run stopped unexpectedly.')
      finish('error', 'The run stopped unexpectedly.')
    } finally {
      runningRef.current = false
    }
  }, [callId, onFinished, onSectionsChanged, patchStep, say, waitVisibly])

  const doneCount = steps.filter(s => ['done', 'skipped'].includes(s.status)).length
  const percent = steps.length ? Math.round((doneCount / steps.length) * 100) : 0

  return {
    phase,
    running,
    steps,
    log,
    error,
    detail,
    elapsedMs,
    waitingUntil,
    percent,
    doneCount,
    totalCount: steps.length,
    start,
    cancel,
  }
}
