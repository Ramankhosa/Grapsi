import Link from 'next/link'
import {
  countReviewerSections,
  reportFreshness,
  type ReviewerSectionLike,
} from '@/lib/reviewer/sectionGrouping'

/**
 * The one thing to do next, stated plainly, with the button that does it.
 *
 * The workspace previously showed a new user its *state* — counts, badges, a
 * progress spine — and left them to infer the action from it. That works once
 * you know the pipeline; on first contact it reads as a dashboard for a process
 * you have not started. Every screen in a linear workflow should be able to
 * answer "what now?" without the user building a mental model first, so this
 * computes the single next action and puts it under one primary button.
 *
 * Purely presentational: it derives its state from the same section list and
 * report JSON the rest of the workspace uses, so it cannot disagree with the
 * badges beside it.
 */

export type ReviewerNextStepKind =
  | 'add_sections'
  | 'review_stale'
  | 'review_remaining'
  | 'generate_report'
  | 'regenerate_report'
  | 'complete'

export interface ReviewerNextStep {
  kind: ReviewerNextStepKind
  title: string
  body: string
}

export function resolveNextStep(
  sections: ReviewerSectionLike[],
  overallReviewJson: any
): ReviewerNextStep {
  const counts = countReviewerSections(sections)
  const freshness = reportFreshness(overallReviewJson, sections)

  if (counts.total === 0) {
    return {
      kind: 'add_sections',
      title: 'Add your proposal',
      body: 'Import the whole document and it will be split into the sections this call asks for. You can correct anything placed wrongly before it saves.',
    }
  }

  if (counts.stale > 0) {
    return {
      kind: 'review_stale',
      title: `${counts.stale} section${counts.stale === 1 ? '' : 's'} changed since ${counts.stale === 1 ? 'it was' : 'they were'} reviewed`,
      body: 'The stored remarks describe the earlier text. Reviewing again scores what is there now and updates the panel report.',
    }
  }

  if (counts.reviewed < counts.total) {
    const remaining = counts.total - counts.reviewed
    return {
      kind: 'review_remaining',
      title:
        counts.reviewed === 0
          ? 'Review the proposal'
          : `${remaining} section${remaining === 1 ? '' : 's'} still to review`,
      body: "Each section is scored against this call's own rules, then the panel report compares them against each other and forms the funding verdict. Takes a few minutes.",
    }
  }

  if (freshness === 'missing') {
    return {
      kind: 'generate_report',
      title: 'Every section is reviewed',
      body: 'The panel report is what turns those section scores into a funding verdict, with the cross-section checks and the ranked list of fixes.',
    }
  }

  if (freshness === 'stale') {
    return {
      kind: 'regenerate_report',
      title: 'The panel report is out of date',
      body: 'A section has been reviewed since the report was written, so its verdict no longer describes the current drafts.',
    }
  }

  return {
    kind: 'complete',
    title: 'Review complete',
    body: 'Every section is reviewed and the panel report is current. Open it for the verdict, or download the Action Taken Report to work through the fixes.',
  }
}

export default function ReviewerNextStep({
  callId,
  sections,
  overallReviewJson,
  onRunReview,
  onGenerateReport,
  onExportAtr,
  reviewBusy,
  reportBusy,
  exportBusy,
}: {
  callId: string
  sections: ReviewerSectionLike[]
  overallReviewJson: any
  onRunReview?: () => void
  onGenerateReport?: () => void
  onExportAtr?: () => void
  reviewBusy?: boolean
  reportBusy?: boolean
  exportBusy?: boolean
}) {
  const step = resolveNextStep(sections, overallReviewJson)
  const isAttention = step.kind === 'review_stale' || step.kind === 'regenerate_report'

  const primary = (() => {
    switch (step.kind) {
      case 'add_sections':
        return (
          <Link href={`/reviewer/${callId}/import-proposal`} className="nk-btn-primary nk-btn-sm">
            Import full proposal
          </Link>
        )
      case 'review_stale':
      case 'review_remaining':
        return (
          <button type="button" onClick={onRunReview} disabled={reviewBusy} className="nk-btn-primary nk-btn-sm">
            {reviewBusy ? 'Working…' : step.kind === 'review_stale' ? 'Review the changes' : 'Run the review'}
          </button>
        )
      case 'generate_report':
      case 'regenerate_report':
        return (
          <button type="button" onClick={onGenerateReport} disabled={reportBusy} className="nk-btn-primary nk-btn-sm">
            {reportBusy
              ? 'Working…'
              : step.kind === 'generate_report'
                ? 'Generate the panel report'
                : 'Regenerate the report'}
          </button>
        )
      default:
        return (
          <Link href={`/reviewer/${callId}/final-review`} className="nk-btn-primary nk-btn-sm">
            Open the panel report
          </Link>
        )
    }
  })()

  const secondary = (() => {
    switch (step.kind) {
      case 'add_sections':
        return (
          <Link href={`/reviewer/${callId}/section/new`} className="nk-btn-secondary nk-btn-sm">
            Add one section
          </Link>
        )
      case 'complete':
        return onExportAtr ? (
          <button type="button" onClick={onExportAtr} disabled={exportBusy} className="nk-btn-secondary nk-btn-sm">
            {exportBusy ? 'Preparing…' : 'Download the ATR'}
          </button>
        ) : null
      default:
        return null
    }
  })()

  return (
    <section
      className={`nk-panel flex flex-wrap items-center justify-between gap-4 p-5 ${
        isAttention ? 'border-amber-300 bg-amber-50/40' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className={`nk-eyebrow ${isAttention ? 'text-amber-700' : 'text-cobalt-700'}`}>
          {step.kind === 'complete' ? 'Done' : 'Next step'}
        </div>
        <h2 className="nk-title mt-1">{step.title}</h2>
        <p className="nk-sub mt-1 max-w-prose">{step.body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {secondary}
        {primary}
      </div>
    </section>
  )
}
