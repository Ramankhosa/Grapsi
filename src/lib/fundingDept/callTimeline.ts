/**
 * One chronological story of a call in a school.
 *
 * Everything that happened is already recorded — in six tables. What no screen
 * could show was the sequence: shortlisted Monday, rang the HoD Tuesday,
 * assigned Wednesday, declined Friday for lack of time, passed on the following
 * week. This merges those sources into one ordered list.
 *
 * Pure: it takes rows already fetched and returns events. No database, so the
 * ordering, the dedupe and the truncation rule are unit-testable, and a
 * mis-told story can be reproduced in a test rather than a fixture.
 */

export type TimelineKind =
  | 'TRIAGE'
  | 'SHORTLISTED'
  | 'APPROACHED'
  | 'PASSED_OVER'
  | 'CANDIDATE_DECLINED'
  | 'ASSIGNED'
  | 'PASSED_ON'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'SUBMITTED'
  | 'COMPLETED'
  | 'OUTCOME'
  | 'CANCELLED'
  | 'FOLLOW_UP'
  | 'REMINDER_SENT'
  | 'DOCUMENT'
  | 'MILESTONE'
  | 'NUDGE'

export interface TimelineEvent {
  /** ISO timestamp. */
  at: string
  kind: TimelineKind
  title: string
  detail: string | null
  /** Who did it, when a person can be named. */
  actor: string | null
  assignmentId: string | null
  /** Source row id, for keys and for "open this" links. */
  refId: string
  /** Set when the timestamp is inferred rather than recorded. */
  approximate?: boolean
}

interface Person {
  name: string | null
  email: string | null
}

export interface TimelineSources {
  followUps: Array<{
    id: string
    kind: string
    note: string
    happened_at: Date | string
    reminder_sent_at: Date | string | null
    remind_faculty: boolean
    assignment_id: string | null
    created_by: Person | null
  }>
  candidates: Array<{
    id: string
    status: string
    note: string | null
    created_at: Date | string
    updated_at: Date | string
    user: Person
    created_by: Person | null
  }>
  assignments: Array<{
    id: string
    status: string
    created_at: Date | string
    updated_at: Date | string
    responded_at: Date | string | null
    declined_reason: string | null
    submitted_at: Date | string | null
    completed_at: Date | string | null
    decision_at: Date | string | null
    outcome: string
    award_amount: number | null
    award_currency: string | null
    assignee: Person
    assigned_by: Person
    previous_assignment: { id: string; declined_reason: string | null; assignee: Person } | null
  }>
  documents: Array<{
    id: string
    kind: string
    file_name: string
    created_at: Date | string
    assignment_id: string
    uploaded_by: Person | null
  }>
  milestones: Array<{
    id: string
    kind: string
    title: string
    status: string
    created_at: Date | string
    completed_at: Date | string | null
    assignment_id: string
  }>
  notifications: Array<{
    id: string
    title: string
    body: string | null
    created_at: Date | string
    assignment_id: string | null
  }>
}

/** Per-source flag: did the fetch hit its row cap? Drives the horizon rule. */
export type TimelineCaps = Partial<Record<keyof TimelineSources, boolean>>

export interface Timeline {
  events: TimelineEvent[]
  /**
   * When set, nothing older than this is shown — because at least one source
   * was truncated at that point, and showing the others past it would read as
   * "nobody did anything", the one thing a chase record must never say.
   */
  truncatedBefore: string | null
}

/** The auto-note the re-request route writes; the decline itself is wiped. */
export const RE_REQUEST_NOTE_PREFIX = 'Re-requested after a decline'

const ONE_MINUTE = 60_000

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function ms(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime()
}

function who(person: Person | null | undefined): string | null {
  if (!person) return null
  return person.name || person.email || null
}

function money(amount: number | null, currency: string | null): string | null {
  if (amount == null) return null
  return `${currency || '₹'} ${amount.toLocaleString('en-IN')}`
}

function fromFollowUps(rows: TimelineSources['followUps']): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const row of rows) {
    const actor = who(row.created_by)

    if (row.kind === 'TRIAGE') {
      events.push({
        at: iso(row.happened_at),
        kind: 'TRIAGE',
        title: row.note,
        detail: null,
        actor,
        assignmentId: null,
        refId: row.id,
      })
      continue
    }

    if (row.note.startsWith(RE_REQUEST_NOTE_PREFIX)) {
      // The re-request erased responded_at and declined_reason from the
      // assignment; this note is the only trace that it was ever declined.
      events.push({
        at: iso(row.happened_at),
        kind: 'DECLINED',
        title: 'Declined earlier — asked again',
        detail: row.note,
        actor,
        assignmentId: row.assignment_id,
        refId: row.id,
        approximate: true,
      })
      continue
    }

    events.push({
      at: iso(row.happened_at),
      kind: 'FOLLOW_UP',
      title: row.note,
      detail: row.kind === 'NOTE' ? null : row.kind.charAt(0) + row.kind.slice(1).toLowerCase(),
      actor,
      assignmentId: row.assignment_id,
      refId: row.id,
    })

    if (row.reminder_sent_at) {
      events.push({
        at: iso(row.reminder_sent_at),
        kind: 'REMINDER_SENT',
        title: row.remind_faculty ? 'Reminder sent to the faculty member' : 'Reminder sent',
        detail: row.note,
        actor: null,
        assignmentId: row.assignment_id,
        refId: `${row.id}:reminder`,
      })
    }
  }
  return events
}

function fromCandidates(rows: TimelineSources['candidates']): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const row of rows) {
    const person = who(row.user) || 'Someone'
    const actor = who(row.created_by)

    events.push({
      at: iso(row.created_at),
      kind: 'SHORTLISTED',
      title: `${person} shortlisted`,
      detail: row.status === 'SHORTLISTED' ? row.note : null,
      actor,
      assignmentId: null,
      refId: row.id,
    })

    // The row only holds the latest status, so at most one further event: the
    // current state, if it changed after shortlisting. ASSIGNED is skipped —
    // the assignment itself tells that part.
    const changed = ms(row.updated_at) - ms(row.created_at) > ONE_MINUTE
    if (!changed || row.status === 'SHORTLISTED' || row.status === 'ASSIGNED') continue

    const kind: TimelineKind =
      row.status === 'APPROACHED'
        ? 'APPROACHED'
        : row.status === 'DECLINED'
          ? 'CANDIDATE_DECLINED'
          : 'PASSED_OVER'
    const title =
      kind === 'APPROACHED'
        ? `${person} approached`
        : kind === 'CANDIDATE_DECLINED'
          ? `${person} declined informally`
          : `${person} passed over`

    events.push({
      at: iso(row.updated_at),
      kind,
      title,
      detail: row.note,
      actor,
      assignmentId: null,
      refId: `${row.id}:${row.status}`,
    })
  }
  return events
}

function fromAssignments(rows: TimelineSources['assignments']): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const row of rows) {
    const assignee = who(row.assignee) || 'Someone'
    const assigner = who(row.assigned_by)

    if (row.previous_assignment) {
      const from = who(row.previous_assignment.assignee) || 'someone else'
      events.push({
        at: iso(row.created_at),
        kind: 'PASSED_ON',
        title: `Passed on to ${assignee} from ${from}`,
        detail: row.previous_assignment.declined_reason
          ? `${from} declined: ${row.previous_assignment.declined_reason}`
          : null,
        actor: assigner,
        assignmentId: row.id,
        refId: `${row.id}:assigned`,
      })
    } else {
      events.push({
        at: iso(row.created_at),
        kind: 'ASSIGNED',
        title: `Assigned to ${assignee}`,
        detail: null,
        actor: assigner,
        assignmentId: row.id,
        refId: `${row.id}:assigned`,
      })
    }

    if (row.responded_at) {
      if (row.status === 'DECLINED') {
        events.push({
          at: iso(row.responded_at),
          kind: 'DECLINED',
          title: `${assignee} declined`,
          detail: row.declined_reason,
          actor: assignee,
          assignmentId: row.id,
          refId: `${row.id}:declined`,
        })
      } else {
        events.push({
          at: iso(row.responded_at),
          kind: 'ACCEPTED',
          title: `${assignee} accepted`,
          detail: null,
          actor: assignee,
          assignmentId: row.id,
          refId: `${row.id}:accepted`,
        })
      }
    }

    // Keyed on submitted_at only: re-opening clears completed_at but keeps the
    // submission, and a submission is the fact that matters.
    if (row.submitted_at) {
      events.push({
        at: iso(row.submitted_at),
        kind: 'SUBMITTED',
        title: `${assignee} recorded the submission`,
        detail: null,
        actor: assignee,
        assignmentId: row.id,
        refId: `${row.id}:submitted`,
      })
    } else if (row.completed_at) {
      events.push({
        at: iso(row.completed_at),
        kind: 'COMPLETED',
        title: `${assignee} marked it complete`,
        detail: null,
        actor: assignee,
        assignmentId: row.id,
        refId: `${row.id}:completed`,
      })
    }

    if (row.decision_at && row.outcome !== 'PENDING') {
      const amount = money(row.award_amount, row.award_currency)
      events.push({
        at: iso(row.decision_at),
        kind: 'OUTCOME',
        title:
          row.outcome === 'AWARDED'
            ? `Awarded${amount ? ` — ${amount}` : ''}`
            : row.outcome === 'REJECTED'
              ? 'Not funded'
              : 'Withdrawn',
        detail: `${assignee}'s application`,
        actor: null,
        assignmentId: row.id,
        refId: `${row.id}:outcome`,
      })
    }

    if (row.status === 'CANCELLED') {
      // No dedicated timestamp; updated_at is the best available and any later
      // PATCH moves it. Marked approximate rather than omitted — a cancellation
      // is part of the story even at the wrong minute.
      events.push({
        at: iso(row.updated_at),
        kind: 'CANCELLED',
        title: `Assignment to ${assignee} cancelled`,
        detail: null,
        actor: null,
        assignmentId: row.id,
        refId: `${row.id}:cancelled`,
        approximate: true,
      })
    }
  }
  return events
}

function fromDocuments(rows: TimelineSources['documents']): TimelineEvent[] {
  return rows.map((row) => ({
    at: iso(row.created_at),
    kind: 'DOCUMENT' as const,
    title: `${row.kind === 'OTHER' ? 'Document' : row.kind.replace('_', ' ').toLowerCase()} added: ${row.file_name}`,
    detail: null,
    actor: who(row.uploaded_by),
    assignmentId: row.assignment_id,
    refId: row.id,
  }))
}

function fromMilestones(rows: TimelineSources['milestones']): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const row of rows) {
    events.push({
      at: iso(row.created_at),
      kind: 'MILESTONE',
      title: `Milestone added: ${row.title}`,
      detail: row.kind === 'OTHER' ? null : row.kind,
      actor: null,
      assignmentId: row.assignment_id,
      refId: row.id,
    })
    if (row.completed_at) {
      events.push({
        at: iso(row.completed_at),
        kind: 'MILESTONE',
        title: `Milestone ${row.status.toLowerCase()}: ${row.title}`,
        detail: null,
        actor: null,
        assignmentId: row.assignment_id,
        refId: `${row.id}:${row.status}`,
      })
    }
  }
  return events
}

/**
 * Automatic nudges. A nudge to two recipients is two Notification rows for one
 * event, and the NOACK stage writes its pair as two statements moments apart,
 * so rows are grouped by (assignment, title, minute) — one event per group.
 */
function fromNotifications(rows: TimelineSources['notifications']): TimelineEvent[] {
  const seen = new Map<string, TimelineEvent>()
  for (const row of rows) {
    const minute = Math.floor(ms(row.created_at) / ONE_MINUTE)
    const key = `${row.assignment_id || ''}|${row.title}|${minute}`
    if (seen.has(key)) continue
    seen.set(key, {
      at: iso(row.created_at),
      kind: 'NUDGE',
      title: row.title,
      detail: row.body,
      actor: null,
      assignmentId: row.assignment_id,
      refId: row.id,
    })
  }
  return Array.from(seen.values())
}

/** Deterministic order for events sharing a timestamp: cause before effect. */
const KIND_ORDER: TimelineKind[] = [
  'TRIAGE',
  'SHORTLISTED',
  'APPROACHED',
  'PASSED_OVER',
  'CANDIDATE_DECLINED',
  'ASSIGNED',
  'PASSED_ON',
  'ACCEPTED',
  'DECLINED',
  'FOLLOW_UP',
  'REMINDER_SENT',
  'NUDGE',
  'DOCUMENT',
  'MILESTONE',
  'SUBMITTED',
  'COMPLETED',
  'OUTCOME',
  'CANCELLED',
]

export function buildTimeline(sources: TimelineSources, caps: TimelineCaps = {}): Timeline {
  const perSource: Array<[keyof TimelineSources, TimelineEvent[]]> = [
    ['followUps', fromFollowUps(sources.followUps)],
    ['candidates', fromCandidates(sources.candidates)],
    ['assignments', fromAssignments(sources.assignments)],
    ['documents', fromDocuments(sources.documents)],
    ['milestones', fromMilestones(sources.milestones)],
    ['notifications', fromNotifications(sources.notifications)],
  ]

  // The horizon: the newest "oldest row" among the sources that were cut off.
  // Anything older than that from ANY source is dropped, so the list never has
  // a silent per-source gap.
  let horizon = 0
  for (const [name, events] of perSource) {
    if (!caps[name] || events.length === 0) continue
    const oldest = Math.min(...events.map((event) => ms(event.at)))
    horizon = Math.max(horizon, oldest)
  }

  const events = perSource
    .flatMap(([, list]) => list)
    .filter((event) => horizon === 0 || ms(event.at) >= horizon)
    .sort((left, right) => {
      const byTime = ms(right.at) - ms(left.at)
      if (byTime !== 0) return byTime
      return KIND_ORDER.indexOf(right.kind) - KIND_ORDER.indexOf(left.kind)
    })

  return {
    events,
    truncatedBefore: horizon > 0 ? new Date(horizon).toISOString() : null,
  }
}
