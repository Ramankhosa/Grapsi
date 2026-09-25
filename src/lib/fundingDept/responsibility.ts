import { day, deadlineAttention } from './managementRules'

export const CLOSING_DISPOSITIONS = ['NO_SUITABLE_FACULTY', 'DECLINED', 'CAPACITY', 'OTHER']
export const closesOpportunity = (reason?: string | null) => Boolean(reason && CLOSING_DISPOSITIONS.includes(reason))

/**
 * ORIGIN_REVIEW      the school that entered the call reviews it
 * MAPPED_REVIEW      a school the call was mapped to reviews it (callSchoolMapping)
 * MATCHED_FOLLOW_UP  researchers were matched or work exists; follow it through
 */
export const RESPONSIBILITY_TYPES = ['ORIGIN_REVIEW', 'MAPPED_REVIEW', 'MATCHED_FOLLOW_UP'] as const
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
  // Reviewed as relevant, nobody allocated yet: its own gap, never "completed".
  'ALLOCATION_PENDING',
  'WAITING_ON_OTHERS',
  'IN_PROGRESS',
  'DATA_ROUTING',
  'COMPLETED',
] as const
export type WorkQueue = (typeof WORK_QUEUES)[number]

export type ResponsibilityAction = {
  id?: string
  is_next?: boolean
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
  /**
   * The school's review state (reportDefinitions.reviewState). When given, a
   * review duty is complete only once the call is allocated or closed with a
   * reason — a "relevant" decision alone leaves the allocation still owed.
   */
  reviewState?: 'NOT_REVIEWED' | 'REVIEWED_ALLOCATION_PENDING' | 'ALLOCATED' | 'CLOSED_NO_ALLOCATION'
  actions?: ResponsibilityAction[]
  lastActivityAt?: Date | string | null
  internalDeadlineOverdue?: boolean
  waitingWith?: string | null
  waitingSince?: Date | string | null
  ownerUserId?: string | null
  ownerName?: string | null
  firstTouchAt?: Date | string | null
  thresholds?: { firstTouchTargetDays: number; untouchedDays: number; silentDays: number; unansweredDays: number }
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
  const orderedActions = [...openActions].sort((a,b) => (asDate(a.due_at)?.getTime() ?? Infinity) - (asDate(b.due_at)?.getTime() ?? Infinity))
  const designated = orderedActions.find(action => action.is_next) ?? orderedActions[0] ?? null
  const overdueObligation = orderedActions.find(action => Boolean(asDate(action.due_at) && asDate(action.due_at)! < input.asOf)) ?? null
  const overdueAction = openActions.some(action => {
    const due = asDate(action.due_at)
    return Boolean(due && due < input.asOf)
  })
  const deadline = asDate(input.deadline)
  const daysToDeadline = deadlineAttention(deadline,input.asOf).daysToDeadline
  const expired = isExpiredInIndia(deadline, input.asOf)
  const activeApplications = input.activeApplications ?? 0
  const originComplete = input.reviewState
    ? input.reviewState === 'ALLOCATED' || input.reviewState === 'CLOSED_NO_ALLOCATION'
    : Boolean(input.triageDecisionRecorded || input.assignments || input.dispositionRecorded)
  const allocationOwed = input.reviewState === 'REVIEWED_ALLOCATION_PENDING'
  const matchedComplete = Boolean(input.dispositionRecorded || input.assignments || input.applications ||
    ((input.matchedPeople ?? 0) > 0 && (input.candidatesReviewed ?? 0) >= (input.matchedPeople ?? 0)))
  // A review duty (origin or mapped school) closes on a recorded decision.
  const reviewDuty = input.responsibilityType !== 'MATCHED_FOLLOW_UP'
  const complete = reviewDuty ? originComplete : matchedComplete
  // Intake triage is a separate duty from ongoing application/follow-up work.
  const liveWork = reviewDuty&&originComplete ? false : activeApplications > 0 || openActions.length > 0
  const missingData = Boolean(
    input.originSchoolMissing || input.schoolUnmapped || input.ownerMissing ||
      (input.responsibilityType === 'MATCHED_FOLLOW_UP' && input.matchingComplete === false)
  )

  const dataWarnings = [input.originSchoolMissing?'Origin school missing':null,input.schoolUnmapped?'School disciplines unmapped':null,
    input.ownerMissing?'No available DSR cover':null,input.matchingComplete===false?'Matching incomplete':null].filter(Boolean) as string[]
  const thresholds=input.thresholds ?? {firstTouchTargetDays:3,untouchedDays:7,silentDays:14,unansweredDays:3}
  const firstSeen=asDate(input.firstSeenAt)
  const lastActivity=asDate(input.lastActivityAt) ?? firstSeen
  const daysSinceActivity=lastActivity?Math.max(0,Math.floor((input.asOf.getTime()-lastActivity.getTime())/day)):null
  const ageDays=firstSeen?Math.max(0,Math.floor((input.asOf.getTime()-firstSeen.getTime())/day)):null
  const waitingWith=designated?.waiting_with || input.waitingWith || null
  const waitingSince=asDate(input.waitingSince) ?? lastActivity
  const firstReviewOverdue=!input.firstTouchAt&&!complete&&Boolean(firstSeen&&input.asOf.getTime()-firstSeen.getTime()>=thresholds.firstTouchTargetDays*day)
  const untouchedOverdue=!input.firstTouchAt&&!complete&&(ageDays??0)>=thresholds.untouchedDays
  const silentLiveWork=activeApplications>0&&(daysSinceActivity??0)>=thresholds.silentDays
  const facultyChaseDue=waitingWith==='FACULTY'&&Boolean(waitingSince&&input.asOf.getTime()-waitingSince.getTime()>=thresholds.unansweredDays*day)
  const fallbackDue=waitingWith==='FACULTY'&&waitingSince?new Date(waitingSince.getTime()+thresholds.unansweredDays*day):!complete&&firstSeen?new Date(firstSeen.getTime()+thresholds.firstTouchTargetDays*day):null
  const nextAction: ResponsibilityAction | null = complete&&!liveWork?null:designated ?? ({
    title:facultyChaseDue?'Chase faculty response':allocationOwed?'Allocate faculty, or close with a reason':silentLiveWork?'Confirm progress and record the next step':waitingWith==='FACULTY'?'Follow up for faculty response':input.responsibilityType==='ORIGIN_REVIEW'?'Review intake relevance':input.responsibilityType==='MAPPED_REVIEW'?'Review relevance, then allocate or close with a reason':'Review matching researchers and confirm next step',
    owner_user_id:input.ownerUserId||'',owner_name:input.ownerName||'Unassigned',waiting_with:waitingWith||'DSR',status:'OPEN',due_at:fallbackDue,
  })
  let actionClass: ActionClass
  let queue: WorkQueue
  if (complete && !liveWork) {
    actionClass = 'COMPLETED'
    queue = 'COMPLETED'
  } else if (overdueAction || input.internalDeadlineOverdue || ((firstReviewOverdue||untouchedOverdue||silentLiveWork||facultyChaseDue)&&!input.ownerMissing)) {
    actionClass = waitingWith==='FACULTY'?'WAITING_ON_FACULTY':['REVIEWER','APPROVER'].includes(waitingWith||'')?'WAITING_ON_REVIEWER_APPROVER':waitingWith==='AGENCY'?'WAITING_ON_AGENCY':'DSR_ACTION_REQUIRED'
    queue = 'ACTION_OVERDUE'
  } else if (!expired && daysToDeadline !== null && daysToDeadline <= 7 && !complete) {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'CLOSING_SOON'
  } else if (input.intakeReady === false) {
    actionClass = 'SYSTEM_PROCESSING'
    queue = 'DATA_ROUTING'
  } else if (allocationOwed && !liveWork && !input.ownerMissing) {
    // Reviewed as relevant and nobody allocated: a DSR task, not a data gap.
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'ALLOCATION_PENDING'
  } else if (missingData && !liveWork && !(input.matchedPeople && !input.ownerMissing)) {
    actionClass = 'DATA_GAP'
    queue = 'DATA_ROUTING'
  } else if (waitingWith === 'FACULTY') {
    actionClass = 'WAITING_ON_FACULTY'
    queue = overdueAction ? 'ACTION_OVERDUE' : 'WAITING_ON_OTHERS'
  } else if (['REVIEWER', 'APPROVER'].includes(waitingWith || '')) {
    actionClass = 'WAITING_ON_REVIEWER_APPROVER'
    queue = overdueAction ? 'ACTION_OVERDUE' : 'WAITING_ON_OTHERS'
  } else if (waitingWith === 'AGENCY') {
    actionClass = 'WAITING_ON_AGENCY'
    queue = overdueAction ? 'ACTION_OVERDUE' : 'WAITING_ON_OTHERS'
  } else if (overdueAction || input.internalDeadlineOverdue) {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'ACTION_OVERDUE'
  } else if (!expired && daysToDeadline !== null && daysToDeadline <= 7 && !complete) {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'CLOSING_SOON'
  } else if (activeApplications > 0 || input.assignments || openActions.length > 0) {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'IN_PROGRESS'
  } else {
    actionClass = 'DSR_ACTION_REQUIRED'
    queue = 'NEW_TO_REVIEW'
  }

  return {
    responsibilityType: input.responsibilityType,
    actionClass,
    queue,
    priority: WORK_QUEUES.indexOf(queue),
    nextAction,
    overdueObligation, waitingWith, dataWarnings, lastActivityAt:lastActivity, ageDays,
    firstReviewOverdue, untouchedOverdue, silentLiveWork, facultyChaseDue,
    completionReason:complete ? input.dispositionRecorded?'Structured closure':input.responsibilityType==='ORIGIN_REVIEW'?'Intake reviewed or assigned':reviewDuty?'School review recorded or assigned':'Researcher follow-up recorded' : null,
    expired,
    retainedBecauseLiveWork: expired && liveWork,
    liveWork,
    complete,
    daysToDeadline,
    daysSinceActivity,
  }
}
