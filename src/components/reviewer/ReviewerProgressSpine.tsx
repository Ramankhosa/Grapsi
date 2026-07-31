import Link from 'next/link'
import {
  countReviewerSections,
  reportFreshness,
  type ReviewerSectionLike,
} from '@/lib/reviewer/sectionGrouping'

/**
 * Where the workspace stands, in one line.
 *
 * Replaces a 2x2 grid of "Step 1-4" cards that were not steps: they had no
 * gating, no current-step state, and an optional stage (context summaries)
 * presented with the same weight as a required one. Each stage here reports
 * real state and links to the one action that advances it.
 */

type StageTone = 'done' | 'active' | 'idle' | 'warn'

const TONE_DOT: Record<StageTone, string> = {
  done: 'bg-emerald-500',
  active: 'bg-cobalt-600',
  idle: 'bg-nickel-300',
  warn: 'bg-amber-500',
}

const TONE_VALUE: Record<StageTone, string> = {
  done: 'text-nickel-900',
  active: 'text-cobalt-800',
  idle: 'text-nickel-500',
  warn: 'text-amber-700',
}

function Stage({
  label,
  value,
  tone,
  href,
  onClick,
  actionLabel,
  busy,
}: {
  label: string
  value: string
  tone: StageTone
  href?: string
  onClick?: () => void
  actionLabel?: string
  busy?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="nk-eyebrow">{label}</div>
        <div className={`mt-1 truncate text-[13px] font-medium ${TONE_VALUE[tone]}`}>{value}</div>
      </div>
      {actionLabel && onClick && (
        <button type="button" onClick={onClick} disabled={busy} className="nk-btn-secondary nk-btn-xs shrink-0">
          {busy ? 'Working…' : actionLabel}
        </button>
      )}
      {actionLabel && href && !onClick && (
        <Link href={href} className="nk-btn-secondary nk-btn-xs shrink-0">
          {actionLabel}
        </Link>
      )}
    </div>
  )
}

export default function ReviewerProgressSpine({
  callId,
  sections,
  overallReviewJson,
  onGenerateReport,
  reportBusy,
}: {
  callId: string
  sections: ReviewerSectionLike[]
  overallReviewJson: any
  onGenerateReport?: () => void
  reportBusy?: boolean
}) {
  const counts = countReviewerSections(sections)
  const freshness = reportFreshness(overallReviewJson, sections)

  const sectionsStage: { value: string; tone: StageTone } =
    counts.total === 0
      ? { value: 'None added yet', tone: 'idle' }
      : { value: `${counts.total} section${counts.total === 1 ? '' : 's'}`, tone: 'done' }

  const reviewStage: { value: string; tone: StageTone } = (() => {
    if (counts.total === 0) return { value: 'Add sections first', tone: 'idle' }
    if (counts.stale > 0) {
      return { value: `${counts.stale} edited since review`, tone: 'warn' }
    }
    if (counts.reviewed === 0) return { value: `0 of ${counts.total} reviewed`, tone: 'active' }
    if (counts.reviewed < counts.total) {
      return { value: `${counts.reviewed} of ${counts.total} reviewed`, tone: 'active' }
    }
    return { value: `All ${counts.total} reviewed`, tone: 'done' }
  })()

  const reportStage: { value: string; tone: StageTone; action?: string } = (() => {
    if (counts.reviewed === 0) return { value: 'Review a section first', tone: 'idle' }
    if (freshness === 'missing') return { value: 'Not generated', tone: 'active', action: 'Generate' }
    if (freshness === 'stale') return { value: 'Out of date', tone: 'warn', action: 'Regenerate' }
    return { value: 'Up to date', tone: 'done', action: 'Open' }
  })()

  const reportIsOpenAction = reportStage.action === 'Open'

  return (
    <section className="nk-panel divide-y divide-nickel-200 sm:flex sm:divide-x sm:divide-y-0">
      <Stage
        label="Sections"
        value={sectionsStage.value}
        tone={sectionsStage.tone}
        href={`/reviewer/${callId}/import-proposal`}
        actionLabel={counts.total === 0 ? 'Import' : undefined}
      />
      <Stage label="Review" value={reviewStage.value} tone={reviewStage.tone} />
      <Stage
        label="Panel report"
        value={reportStage.value}
        tone={reportStage.tone}
        actionLabel={reportStage.action}
        href={reportIsOpenAction ? `/reviewer/${callId}/final-review` : undefined}
        onClick={reportIsOpenAction ? undefined : onGenerateReport}
        busy={reportBusy}
      />
    </section>
  )
}
