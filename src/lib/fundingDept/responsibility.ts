import { day } from './managementRules'

export const RESPONSIBILITY_TYPES = ['ORIGIN_REVIEW', 'MATCHED_FOLLOW_UP'] as const
export type ResponsibilityType = (typeof RESPONSIBILITY_TYPES)[number]

export const ACTION_CLASSES = [
  'DSR_ACTION_REQUIRED',
  'WAITING_ON_FACULTY',
  'WAITING_ON_REVIEWER_APPROVER',
  'WAITING_ON_AGENCY',
  'SYSTEM_PROCESSING',
  'COMPLETED',
  'DATA_GAP',
] as const
export type ActionClass = (typeof ACTION_CLASSES)[number]

export const WORK_QUEUES = [
  'ACTION_OVERDUE',
  'CLOSING_SOON',
  'NEW_TO_REVIEW',
  'WAITING_ON_OTHERS',
  'IN_PROGRESS',
  'DATA_ROUTING',
  'COMPLETED',
] as const
export type WorkQueue = (typeof WORK_QUEUES)[number]

export type ResponsibilityAction = {
  title: string
  owner_user_id: string
  owner_name?: string | null
  waiting_with: string
  status: string
  due_at: Date | string | null
  blocker?: string | null
  updated_at?: Date | string | null
}
export type ResponsibilityInput = {
  responsibilityType: ResponsibilityType
  asOf: Date
  firstSeenAt?: Date | string | null
  deadline?: Date | string | null
  intakeReady?: boolean
  matchingComplete?: boolean
  originSchoolMissing?: boolean
  schoolUnmapped?: boolean
  ownerMissing?: boolean
  matchedPeople?: number
  applications?: number
  activeApplications?: number
  assignments?: number
  candidatesReviewed?: number
  contacts?: number
  dispositionRecorded?: boolean
  triageDecisionRecorded?: boolean
  actions?: ResponsibilityAction[]
  lastActivityAt?: Date | string | null
  internalDeadlineOverdue?: boolean
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null
  const result = value instanceof Date ? value : new Date(value)
  return Number.isNaN(result.getTime()) ? null : result
}

/** A funding deadline remains active for the complete India calendar day. */
export function isExpiredInIndia(value: Date | string | null | undefined, asOf = new Date()) {
  const deadline = asDate(value)
  if (!deadline) return false
  const calendar = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  return calendar(deadline) < calendar(asOf)
}

export function resolveResponsibility(input: ResponsibilityInput) {
  const actions = input.actions ?? []
  const openActions = actions.filter(action => ['OPEN', 'ACKNOWLEDGED'].includes(action.status))
  const nextAction = openActions.find(action => action.status === 'ACKNOWLEDGED') ?? openActions[0] ?? null
  const overdueAction = openActions.some(action => {
    const due = asDate(action.due_at)
    return Boolean(due && due < input.asOf)
  })
  const deadline = asDate(input.deadline)
  const daysToDeadline = deadline
    ? Math.ceil((deadline.getTime() - input.asOf.getTime()) / day)
    : null
  const expired = isExpiredInIndia(deadline, input.asOf)
  const activeApplications = input.activeApplications ?? 0
  const liveWork = activeApplications > 0 || openActions.length > 0
  const originComplete = Boolean(
    input.triageDecisionRecorded || input.assignments || input.dispositionRecorded
  )
  const matchedComplete = Boolean(
    input.candidatesReviewed || input.contacts || input.assignments || input.applications ||
      input.dispositionRecorded || openActions.length
  )
  const complete = input.responsibilityType === 'ORIGIN_REVIEW' ? originComplete : matchedComplete
  const missingData = Boolean(
    input.originSchoolMissing || input.schoolUnmapped || input.ownerMissing ||
      (input.responsibilityType === 'MATCHED_FOLLOW_UP' && input.matchingComplete === false)
  )

  let actionClass: ActionClass
  let queue: WorkQueue
  if (input.intakeReady === false) {
    actionClass = 'SYSTEM_PROCESSING'
    queue = 'DATA_ROUTING'
  } else if (missingData) {
    actionClass = 'DATA_GAP'
    queue = 'DATA_ROUTING'
  } else if (complete && !liveWork) {
    actionClass = 'COMPLETED'
    queue = 'COMPLETED'
  } else if (nextAction?.waiting_with === 'FACULTY') {
    actionClass = 'WAITING_ON_FACULTY'
    queue = overdueAction ? 'ACTION_OVERDUE' : 'WAITING_ON_OTHERS'
  } else if (['REVIEWER', 'APPROVER'].includes(nextAction?.waiting_with || '')) {
    actionClass = 'WAITING_ON_REVIEWER_APPROVER'
    queue = overdueAction ? 'ACTION_OVERDUE' : 'WAITING_ON_OTHERS'
  } else if (nextAction?.waiting_with === 'AGENCY') {
    actionClass = 'WAITING_ON_AGENCY'
    queue = overdueAction ? 'ACTION_OVERDUE' : 'WAITING_ON_OTHERS'
  } else if (overdueAction || input.internalDeadlineOverdue) {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'ACTION_OVERDUE'
  } else if (!expired && daysToDeadline !== null && daysToDeadline <= 7 && !complete) {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'CLOSING_SOON'
  } else if (activeApplications > 0 || input.assignments) {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'IN_PROGRESS'
  } else {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'NEW_TO_REVIEW'
  }

  const lastActivity = asDate(input.lastActivityAt) ?? asDate(input.firstSeenAt)
  return {
    responsibilityType: input.responsibilityType,
    actionClass,
    queue,
    priority: WORK_QUEUES.indexOf(queue),
    nextAction,
    expired,
    retainedBecauseLiveWork: expired && liveWork,
    liveWork,
    complete,
    daysToDeadline,
    daysSinceActivity: lastActivity
      ? Math.max(0, Math.floor((input.asOf.getTime() - lastActivity.getTime()) / day))
      : null,
  }
}
