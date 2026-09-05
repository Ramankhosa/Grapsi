'use client'

import { MILESTONE_STATUS_LABELS, type MilestoneStatus } from '@/lib/proposals/shared'

const FOLLOW_UP_OPENERS: Record<string, string> = {
  CALL: 'Followed up by phone',
  EMAIL: 'Followed up by email',
  MEETING: 'Met the researcher',
  PORTAL: 'Checked the agency portal',
  NOTE: 'Noted',
}

/**
 * The proposal's history, in sentences.
 *
 * Shared by the applicant's page and the officer's workbench so the two never
 * describe the same event differently — and so neither ends up printing raw
 * enum names at a reader. The only difference between the two views is that the
 * officer also sees the rows marked internal, which the server has already
 * decided before this component is reached.
 */

export interface ProposalEventRow {
  id: string
  kind: string
  fromStatus: string | null
  toStatus: string | null
  payload: any
  visibleToFaculty: boolean
  createdAt: string
  actor: string | null
}

function humanStatus(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
}

/** One readable sentence per event. */
export function describeProposalEvent(event: ProposalEventRow): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}

  switch (event.kind) {
    case 'CREATED':
      return 'Proposal record opened.'
    case 'VERSION_UPLOADED':
      return `Version ${payload.versionNo ?? '?'} uploaded${payload.note ? `: ${payload.note}` : '.'}`
    case 'REVIEW_QUEUED':
      return `AI review started on version ${payload.versionNo ?? '?'}.`
    case 'REVIEW_DONE':
      return payload.score != null
        ? `Review finished — scored ${Number(payload.score).toFixed(1)}.`
        : 'Review finished.'
    case 'REVIEW_FAILED':
      return `The review could not finish${payload.error ? `: ${payload.error}` : '.'}`
    case 'REVIEW_SHARED':
      return payload.score != null
        ? `Review sent to the researcher — scored ${Number(payload.score).toFixed(1)}.`
        : 'Review sent to the researcher.'
    case 'CUTOFF_SET':
      return payload.reviewCutoffAt
        ? `Cut-off for new drafts set to ${new Date(payload.reviewCutoffAt).toLocaleDateString()}.`
        : 'Cut-off for new drafts cleared.'
    case 'CLEARED':
      return payload.overrideReason
        ? `Cleared for submission — ${payload.overrideReason}`
        : 'Cleared for submission.'
    case 'REOPENED':
      return 'Reopened for another draft.'
    case 'SUBMITTED':
      return `Submitted to the agency${
        payload.submissionReference ? ` (${payload.submissionReference})` : '.'
      }`
    case 'AGENCY_STATUS':
      if (event.toStatus === 'SANCTIONED') {
        return payload.sanctionedAmount != null
          ? `Sanctioned — ${Number(payload.sanctionedAmount).toLocaleString()} awarded.`
          : 'Sanctioned.'
      }
      if (event.toStatus === 'REJECTED') return 'The agency did not fund this.'
      if (event.toStatus === 'REVISION_REQUESTED') return 'The agency asked for changes.'
      return `Agency status: ${humanStatus(event.toStatus)}.`
    case 'TEAM_CHANGED':
      return 'The investigator list changed.'
    case 'BUDGET_CHANGED':
      return payload.total != null
        ? `Budget updated — ${Number(payload.total).toLocaleString()} across ${payload.lines ?? 0} lines.`
        : 'The budget was updated.'
    case 'DOCUMENT_ISSUED':
      if (payload.withdrawn) {
        return `${payload.title || 'A letter'} was withdrawn.`
      }
      return `${payload.title || 'A letter'} issued${
        payload.referenceNo ? ` (${payload.referenceNo}).` : '.'
      }`
    case 'CHECKLIST_CHANGED': {
      const label = payload.label || 'A checklist line'
      if (payload.to === 'DONE') return `${label} — received.`
      if (payload.to === 'WAIVED') {
        return `${label} — waived${payload.note ? `: ${payload.note}` : '.'}`
      }
      if (payload.to === 'NOT_APPLICABLE') return `${label} — not applicable here.`
      if (payload.to === 'PENDING') return `${label} — put back on the list.`
      return `${label} updated.`
    }
    case 'FOLLOW_UP': {
      // The dropdown labels are nouns ("Phone call"), which read badly in a
      // sentence, so each channel gets its own opening.
      const how = FOLLOW_UP_OPENERS[payload.contactKind as string] || 'Followed up'
      const moved = payload.movedTo ? ` — now ${humanStatus(payload.movedTo)}` : ''
      // The note itself is the record; the rest is how, and what came of it.
      return `${how}${moved}${payload.note ? `: ${payload.note}` : '.'}`
    }
    case 'MILESTONE_CHANGED': {
      if (payload.scheduled) {
        return `Post-award schedule set up — ${payload.count ?? 0} obligations over ${
          payload.years ?? 0
        } year${payload.years === 1 ? '' : 's'}.`
      }
      if (payload.projectDates) {
        if (payload.extension && payload.previousEnd) {
          return `Project extended to ${new Date(payload.endAt).toLocaleDateString()}, from ${new Date(
            payload.previousEnd
          ).toLocaleDateString()}${payload.reason ? ` — ${payload.reason}` : '.'}`
        }
        return `Project dated ${
          payload.startAt ? new Date(payload.startAt).toLocaleDateString() : '?'
        } to ${payload.endAt ? new Date(payload.endAt).toLocaleDateString() : '?'}.`
      }
      if (payload.added) {
        return `${payload.title || 'An obligation'} added${
          payload.dueAt ? `, due ${new Date(payload.dueAt).toLocaleDateString()}.` : '.'
        }`
      }
      const status = (
        MILESTONE_STATUS_LABELS[payload.to as MilestoneStatus] || humanStatus(payload.to)
      ).toLowerCase()
      return `${payload.title || 'An obligation'} marked ${status}.`
    }
    case 'NOTE':
      // The sweeps write notes too; those explain themselves rather than
      // appearing as an unattributed sentence from nobody.
      if (payload.sweep === 'REVIEW_SLA') {
        return `Flagged: version ${payload.versionNo} has been waiting ${payload.waitingDays} days.`
      }
      if (payload.sweep === 'AGENCY_STALE') {
        return `Flagged: ${payload.days} days without an agency update.`
      }
      return String(payload.note || 'A note was added.')
    default:
      return humanStatus(event.kind) || 'Something happened.'
  }
}

export default function ProposalHistory({
  events,
  emptyText = 'Nothing recorded yet.',
}: {
  events: ProposalEventRow[]
  emptyText?: string
}) {
  if (events.length === 0) {
    return <p className="nk-sub text-sm">{emptyText}</p>
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="border-l-2 border-hairline pl-3">
          <p className="text-sm text-nickel-800">
            {describeProposalEvent(event)}
            {!event.visibleToFaculty && (
              <span className="nk-badge ml-2 align-middle text-[10px]">internal</span>
            )}
          </p>
          <p className="nk-hint text-xs">
            {new Date(event.createdAt).toLocaleString()}
            {event.actor ? ` · ${event.actor}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}
