import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { actionableSchoolCallWhereSql, loadUnitAreaProfile, relevanceForCalls } from '@/lib/funding/callUnitRelevance'
import { textArray, visibleCallSql } from './callSql'
import { applicationState, day, evidenceFingerprint, hasSubmissionEvidence, inPeriod, median, opportunityActionState, opportunityDeadlineAttention, overdueAt, ratio, type ApplicationRow, type AttentionFilter, type ReportMode } from './managementRules'
import { resolveActivityWindow } from './accountabilityService'
import { closesOpportunity, isExpiredInIndia, resolveResponsibility } from './responsibility'
import { reportSchoolMatchStates } from './currentMatches'
import { getDeptSettings } from './settings'
import { isMemberAway } from './shared'
import { getIncomingReport } from './incomingReport'
import { countAllocations, countIndependentApplications, countSchoolResponsibilities, countSubmissions, countUniqueCalls, deadlineState, isAdHocCallId, isRelevantQuality, MISSED_DEADLINE_STATES, reviewState, submissionState, submissionSummary, isAllocation, isIndependentApplication, isSubmission } from './reportDefinitions'

export type ActionRow = {
  id: string; tenant_id: string; school_id: string; call_id: string | null; application_id: string | null
  title: string; owner_user_id: string; owner_name: string; waiting_with: string; status: string
  is_next: boolean; due_at: Date | null; blocker: string | null; deadline_type: string
  created_at: Date; updated_at: Date; completed_at: Date | null; version: number
  acknowledged_at: Date | null; acknowledged_by_user_id: string | null; resolution_note: string | null
  category: string; failure_type: string | null
}
type Contact = { id: string; application_id: string; school_id: string; call_id: string | null; actor_id: string; actor_name: string; kind: string; target: string; happened_at: Date; note: string }
type EventRow = { id: string; school_id: string | null; entity_type: string; entity_id: string; kind: string; before_data: any; after_data: any; occurred_at: Date; inferred: boolean; actor_user_id: string | null; reason: string | null }
export type ManagementFilters = {
  schoolIds?: string[]; memberId?: string | null; schoolId?: string | null; callId?: string | null; callSearch?: string | null
  mode: ReportMode; start: Date; end: Date; asOf: Date; workState?: string | null; stage?: string | null
  relevance?: string | null; exception?: string | null; waitingWith?: string | null; horizon?: number | null
  attention?: AttentionFilter | null
  includeExpired?: boolean
  actionClass?: string | null
  responsibilityType?: string | null
  ageDays?: number | null
  includeCompleted?: boolean
  queue?: string | null
  facultyId?: string | null
  reportView?: string
  signal?: string | null
  actionStatus?: string | null
  /** Keep missed calls visible when expired calls are hidden (the head's default). */
  showMissed?: boolean
  /** Filter to one review / deadline state (reportDefinitions). */
  reviewState?: string | null
  deadlineState?: string | null
}
export async function managementWindow(tenantId: string, params: URLSearchParams) {
  const asOf = new Date()
  const key = params.get('window') || 'reporting'
  if (key === 'custom') {
    const from = params.get('from') || ''; const to = params.get('to') || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Choose valid from and to dates.')
    // Explicit India calendar boundaries, independent of server timezone.
    const start = new Date(`${from}T00:00:00+05:30`); const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime()+day)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || start > asOf) throw new Error('Invalid reporting period.')
    return { start, end: new Date(Math.min(end.getTime(),asOf.getTime()+1)), asOf, label: `${from} to ${to}`, timezone: 'Asia/Kolkata' }
  }
  const window = await resolveActivityWindow(tenantId,key,asOf)
  return { start: window.start, end: new Date(Math.min(window.end.getTime()+1,asOf.getTime()+1)), asOf, label: window.label, timezone: 'Asia/Kolkata' }
}

export async function loadCanonicalApplications(tenantId: string, schoolIds: string[], asOf: Date) {
  return prisma.$queryRaw<ApplicationRow[]>(Prisma.sql`SELECT * FROM dsr_applications
    WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(schoolIds)}) AND created_at<=${asOf} ORDER BY created_at,id`)
}

export async function getManagementReport(tenantId: string, filters: ManagementFilters) {
  const at = filters.asOf
  const [schoolCatalog, members, settings] = await Promise.all([
    prisma.tenantOrgUnit.findMany({ where: { tenant_id: tenantId, depth: 0 }, orderBy: [{name:'asc'},{id:'asc'}], select: { id:true,name:true,code:true,is_active:true } }),
    prisma.fundingDeptMember.findMany({ where: {tenant_id:tenantId}, include: { user:{select:{id:true,name:true,email:true}}, school_assignments:true } }),
    getDeptSettings(tenantId),
  ])
  const owners = new Map<string, (typeof members)[number]>()
  for (const member of members.filter(m=>m.is_active)) for (const row of member.school_assignments.filter(s=>!s.is_deputy)) owners.set(row.org_unit_id,member)
  const schools = schoolCatalog.filter(s=>(!filters.schoolIds || filters.schoolIds.includes(s.id)) &&
    (!filters.schoolId || filters.schoolId === s.id) && (!filters.memberId ||
      (filters.memberId === 'unassigned' ? !owners.has(s.id) : owners.get(s.id)?.id === filters.memberId)))
  const ids = schools.map(s=>s.id)
  const [transfers,reminders,schoolMappings]=await Promise.all([
    prisma.$queryRaw<Array<{school_id:string;call_id:string;owner_user_id:string}>>(Prisma.sql`SELECT t.* FROM dsr_responsibility_transfers t JOIN funding_dept_members m ON m.user_id=t.owner_user_id AND m.tenant_id=t.tenant_id AND m.is_active WHERE t.tenant_id=${tenantId} AND t.school_id=ANY(${textArray(ids)}) AND EXISTS(SELECT 1 FROM funding_dept_school_assignments s WHERE s.member_id=m.id AND s.org_unit_id=t.school_id)`),
    prisma.$queryRaw<Array<{id:string;school_id:string;call_id:string;title:string;owner_user_id:string;owner_name:string;due_at:Date;updated_at:Date}>>(Prisma.sql`SELECT f.id,u.path[1] school_id,f.funding_call_id call_id,f.note title,f.created_by_user_id owner_user_id,COALESCE(person.name,person.email) owner_name,f.remind_at due_at,f.updated_at FROM assignment_follow_ups f JOIN tenant_org_units u ON u.id=f.org_unit_id JOIN users person ON person.id=f.created_by_user_id WHERE f.tenant_id=${tenantId} AND u.path[1]=ANY(${textArray(ids)}) AND f.remind_at IS NOT NULL`),
    // Stored call-to-school responsibilities count only once the department has
    // switched mapping routing on; until then reports read exactly as before.
    settings.callMappingRoutingEnabled?prisma.$queryRaw<Array<{school_id:string;call_id:string;source:string;reason:string|null;is_origin:boolean;mapped_at:Date;backfilled:boolean}>>(Prisma.sql`SELECT school_id,call_id,source,reason,is_origin,mapped_at,backfilled FROM dsr_call_school_mappings WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(ids)}) AND is_active`):Promise.resolve([]),
  ])
  const mappingMap=new Map(schoolMappings.map(m=>[`${m.school_id}:${m.call_id}`,m]))
  const projection=await reportSchoolMatchStates(tenantId,ids)
  const deputies=(schoolId:string)=>members.filter(m=>m.is_active&&m.school_assignments.some(a=>a.org_unit_id===schoolId&&a.is_deputy))
  const coverage=(schoolId:string)=>{
    const primary=owners.get(schoolId), away=primary?isMemberAway(primary,at):false
    const deputy=deputies(schoolId).find(m=>!isMemberAway(m,at))
    return {primary,away,deputy,operational:primary&&!away?primary:deputy,uncovered:!primary||(away&&!deputy)}
  }
  const [applications, contacts, actions, matches, observations, verifications, documents, events, candidates, dispositions, people] = await Promise.all([
    loadCanonicalApplications(tenantId,ids,at),
    prisma.$queryRaw<Contact[]>(Prisma.sql`
      SELECT 'assignment:'||f.id id, 'assignment:'||a.id application_id, u.path[1] school_id,a.funding_call_id call_id,
        f.created_by_user_id actor_id,COALESCE(usr.name,usr.email) actor_name,f.kind,f.contact_target target,f.happened_at,f.note
      FROM assignment_follow_ups f JOIN call_assignments a ON a.id=f.assignment_id
      JOIN tenant_org_units u ON u.id=a.assignee_org_unit_id JOIN users usr ON usr.id=f.created_by_user_id
      WHERE f.tenant_id=${tenantId} AND u.path[1]=ANY(${textArray(ids)}) AND f.happened_at<=${at}
      UNION ALL
      SELECT 'proposal:'||f.id,COALESCE('assignment:'||p.assignment_id,'proposal:'||p.id),p.org_unit_id,p.funding_call_id,
        f.created_by_user_id,COALESCE(usr.name,usr.email),f.kind,f.contact_target,f.happened_at,f.note
      FROM grant_proposal_follow_ups f JOIN grant_proposals p ON p.id=f.proposal_id JOIN users usr ON usr.id=f.created_by_user_id
      WHERE f.tenant_id=${tenantId} AND p.org_unit_id=ANY(${textArray(ids)}) AND f.happened_at<=${at}
      UNION ALL
      SELECT 'call:'||f.id,'',u.path[1],f.funding_call_id,f.created_by_user_id,COALESCE(usr.name,usr.email),f.kind,f.contact_target,f.happened_at,f.note
      FROM assignment_follow_ups f JOIN tenant_org_units u ON u.id=f.org_unit_id JOIN users usr ON usr.id=f.created_by_user_id
      WHERE f.tenant_id=${tenantId} AND f.assignment_id IS NULL AND u.path[1]=ANY(${textArray(ids)}) AND f.happened_at<=${at}`),
    prisma.$queryRaw<ActionRow[]>(Prisma.sql`SELECT a.*,COALESCE(u.name,u.email) owner_name FROM dsr_actions a JOIN users u ON u.id=a.owner_user_id
      WHERE a.tenant_id=${tenantId} AND a.school_id=ANY(${textArray(ids)}) AND a.created_at<=${at} ORDER BY a.is_next DESC,a.due_at NULLS LAST,a.id`),
    prisma.fundingOpportunityMatch.findMany({where:{tenant_id:tenantId,school_id:{in:ids.filter(id=>projection.get(id)?.fresh)},is_current:true}}),
    prisma.$queryRaw<Array<{ school_id:string;call_id:string;first_seen_at:Date;inferred:boolean }>>(Prisma.sql`SELECT * FROM dsr_opportunity_observations WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(ids)}) AND first_seen_at<=${at}`),
    prisma.$queryRaw<Array<{ application_id:string;evidence_fingerprint:string;reviewer_user_id:string;verified_at:Date }>>(Prisma.sql`SELECT * FROM dsr_submission_verifications WHERE tenant_id=${tenantId} AND verified_at<=${at}`),
    prisma.$queryRaw<Array<{application_id:string;id:string}>>(Prisma.sql`SELECT 'assignment:'||assignment_id application_id,id FROM assignment_documents WHERE tenant_id=${tenantId} AND kind='PROPOSAL'
      UNION ALL SELECT COALESCE('assignment:'||p.assignment_id,'proposal:'||p.id),d.id FROM grant_proposal_documents d JOIN grant_proposals p ON p.id=d.proposal_id WHERE p.tenant_id=${tenantId} AND d.kind='SUBMISSION_PROOF'`),
    prisma.$queryRaw<EventRow[]>(Prisma.sql`SELECT id::text,school_id,entity_type,entity_id,kind,before_data,after_data,occurred_at,inferred,actor_user_id,reason
      FROM dsr_events WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(ids)}) AND occurred_at<=${at} ORDER BY occurred_at,id`),
    prisma.callCandidate.findMany({where:{tenant_id:tenantId},select:{funding_call_id:true,user_id:true,status:true,created_at:true,updated_at:true,created_by_user_id:true}}),
    prisma.$queryRaw<Array<{school_id:string;call_id:string;reason:string;explanation:string|null;actor_user_id:string;updated_at:Date}>>(Prisma.sql`SELECT * FROM dsr_opportunity_dispositions WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(ids)})`),
    prisma.user.findMany({where:{tenantId,status:'ACTIVE'},select:{id:true,name:true,email:true,researcher_profile:{select:{org_unit_id:true,research_areas:true,keywords:true,org_unit:{select:{path:true}}}}}}),
  ])
  const peopleMap = new Map(people.map(p=>[p.id,{id:p.id,name:p.name || p.email,email:p.email}]))
  const personSchool = new Map(people.map(p=>[p.id,p.researcher_profile?.org_unit?.path[0] || null]))
  // Lifetime coverage is a fact about an accessible person, not the selected
  // call/date filter or their previous school. Do not return past-school detail.
  const facultyHistory=await prisma.$queryRaw<Array<{faculty_id:string;ever_assigned:boolean;last_engaged_at:Date;call_ids:string[]}>>(Prisma.sql`
    SELECT a.faculty_id,bool_or(a.assignment_id IS NOT NULL) ever_assigned,max(a.updated_at) last_engaged_at,
      array_agg(DISTINCT a.call_id) FILTER(WHERE a.call_id IS NOT NULL) call_ids
    FROM dsr_applications a JOIN researcher_profiles p ON p.user_id=a.faculty_id JOIN tenant_org_units u ON u.id=p.org_unit_id
    WHERE a.tenant_id=${tenantId} AND u.tenant_id=${tenantId} AND u.path[1]=ANY(${textArray(ids)}) AND a.created_at<=${at}
    GROUP BY a.faculty_id`)
  const observationMap = new Map(observations.map(o=>[`${o.school_id}:${o.call_id}`,o]))
  const external = (c:Contact)=>c.target==='FACULTY' && ['CALL','EMAIL','MEETING'].includes(c.kind)
  const apps = applications.map(row=>{
    const state = applicationState(row)
    const appContacts = contacts.filter(c=>c.application_id===row.id)
    const facultyContacts = appContacts.filter(external).sort((a,b)=>b.happened_at.getTime()-a.happened_at.getTime())
    const appActions = actions.filter(a=>a.application_id===row.id)
    const nextAction = appActions.find(a=>a.is_next && ['OPEN','ACKNOWLEDGED'].includes(a.status)) || null
    const proof = documents.filter(d=>d.application_id===row.id).map(d=>d.id)
    const verification = verifications.find(v=>v.application_id===row.id && v.evidence_fingerprint===evidenceFingerprint(row,proof)) || null
    const evidenceAvailable = hasSubmissionEvidence(row,proof)
    const history = events.filter(e=>e.entity_type==='APPLICATION' && e.entity_id===row.id)
    const entered = [...history].reverse().find(e=>!e.inferred && e.after_data &&
      (!e.before_data || applicationState(e.before_data).stage !== applicationState(e.after_data).stage))
    const overdue = {
      agency: state.outstanding && !state.submitted && isExpiredInIndia(row.agency_deadline,at),
      internal: state.outstanding && !state.submitted && overdueAt(row.internal_deadline,at),
      review: state.outstanding && ['PROPOSAL_DRAFTING','INTERNAL_REVIEW'].includes(state.stage) && overdueAt(row.review_deadline,at),
      action: appActions.some(a=>['OPEN','ACKNOWLEDGED'].includes(a.status) && overdueAt(a.due_at,at)),
    }
    const firstSeen = row.call_id ? observationMap.get(`${row.school_id}:${row.call_id}`)?.first_seen_at || null : row.created_at
    const exceptions = [Object.values(overdue).some(Boolean)?'overdue':null,
      row.assignment_id && !state.closed && !state.submitted && facultyContacts.length===0?'no-follow-up':null,
      state.outstanding && !nextAction?'no-next-action':null,
      state.submitted && !evidenceAvailable?'missing-submission-proof':null,
      !row.agency_deadline?'missing-deadline':null].filter(Boolean) as string[]
    return { ...row,...state,faculty:peopleMap.get(row.faculty_id),allocatedBy:peopleMap.get(row.allocated_by),
      accountableOfficer:owners.get(row.school_id || '')?.user.name || owners.get(row.school_id || '')?.user.email || 'Unassigned DSR ownership',
      firstSeen,stageEnteredAt:entered?.occurred_at || null,daysWaiting:entered?Math.floor((at.getTime()-entered.occurred_at.getTime())/day):null,
      independent:!row.assignment_id,contacts:appContacts,followedUp:facultyContacts.length>0,contactEvents:facultyContacts.length,
      lastContact:facultyContacts[0] || null,actions:appActions,nextAction,overdue,exceptions,
      verification,evidenceAvailable,submissionRecorder:peopleMap.get(row.submission_recorder || '') || null,
      suggestedActionOwner: ['PROPOSAL_DRAFTING','AWAITING_FACULTY_RESPONSE','ACCEPTED_IN_HAND'].includes(state.stage)
        ? peopleMap.get(row.faculty_id) || null : owners.get(row.school_id || '')?.user || null }
  })
  const appMatches = (a:typeof apps[number])=>
    (!filters.workState || a.workState===filters.workState) && (!filters.stage || a.stage===filters.stage) &&
    (!filters.exception || a.exceptions.includes(filters.exception)) &&
    (!filters.waitingWith || a.nextAction?.waiting_with===filters.waitingWith) &&
    (!filters.horizon || [a.agency_deadline,a.internal_deadline,a.review_deadline,...a.actions.filter(x=>['OPEN','ACKNOWLEDGED'].includes(x.status)).map(x=>x.due_at)]
      .some(d=>d && new Date(d).getTime()<=at.getTime()+filters.horizon!*day && a.outstanding))
  const isActivity = (a:typeof apps[number])=>inPeriod(a.created_at,filters.start,filters.end) || inPeriod(a.submitted_at,filters.start,filters.end) ||
    a.contacts.some(c=>external(c) && inPeriod(c.happened_at,filters.start,filters.end)) || a.actions.some(x=>inPeriod(x.completed_at,filters.start,filters.end))
  const rawSchoolRows = await Promise.all(schools.map(async school => {
    const profile = await loadUnitAreaProfile(tenantId,[school.id])
    const calls = await prisma.$queryRaw<Array<{id:string;title:string;agency:string|null;deadline:Date|null;triage:string|null;decided_at:Date|null;origin_school_id:string|null;origin_school_name:string|null;origin_school_source:string|null;intake_origin?:boolean}>>(Prisma.sql`
      SELECT fc.id,COALESCE(fc.scheme_title,fc.title) title,COALESCE(fc.agency_name,fc."agencyName") agency,
      COALESCE(fc.close_date,fc."deadlineAt") deadline,tri.status triage,tri.decided_at,
      fc.origin_school_id,fc.origin_school_name,fc.origin_school_source,COALESCE(fc."publishedAt",fc."createdAt") entered_at,
      EXISTS(SELECT 1 FROM dsr_origin_responsibilities intake WHERE intake.tenant_id=${tenantId} AND intake.school_id=${school.id} AND intake.call_id=fc.id) intake_origin,
      EXISTS(SELECT 1 FROM dsr_origin_responsibilities intake WHERE intake.tenant_id=${tenantId} AND intake.call_id=fc.id) has_tenant_origin
      FROM funding_calls fc LEFT JOIN call_school_triage tri ON tri.funding_call_id=fc.id AND tri.org_unit_id=${school.id} AND tri.tenant_id=${tenantId}
      WHERE fc."createdAt"<=${at} AND ${visibleCallSql(tenantId)} AND ${actionableSchoolCallWhereSql(tenantId,school.id)} ORDER BY fc.id`)
    const relevance = await relevanceForCalls(profile,calls.map(c=>c.id))
    const allSchoolApps = apps.filter(a=>a.school_id===school.id)
    for (const app of allSchoolApps.filter(a=>!a.call_id)) calls.push({id:`adhoc:${app.proposal_id}`,title:app.title,agency:app.agency,deadline:app.agency_deadline,triage:null,decided_at:null,origin_school_id:null,origin_school_name:null,origin_school_source:null})
    const callRows = calls.flatMap(call=>{
      if (filters.callId && filters.callId!==call.id) return []
      if (filters.callSearch && !`${call.title} ${call.id}`.toLowerCase().includes(filters.callSearch.toLowerCase())) return []
      const adHoc = call.id.startsWith('adhoc:')
      const callApps = allSchoolApps.filter(a=>adHoc ? `adhoc:${a.proposal_id}`===call.id : a.call_id===call.id)
      const observation = observationMap.get(`${school.id}:${call.id}`)
      const mappingRow = mappingMap.get(`${school.id}:${call.id}`)
      // A stored mapping is the one arrival date for this school (reportDefinitions:
      // "New" ages from mapped_at); the backfill seeded it from these observations.
      const firstSeen = mappingRow?.mapped_at || observation?.first_seen_at || (adHoc ? callApps[0]?.created_at : (call as typeof call & {entered_at?:Date}).entered_at) || null
      const callMatches = matches.filter(m=>m.school_id===school.id && m.funding_call_id===call.id && personSchool.get(m.user_id)===school.id)
      const callActions = actions.filter(a=>a.school_id===school.id && a.call_id===call.id && !a.application_id)
      const allCallActions=actions.filter(a=>a.school_id===school.id&&(a.call_id===call.id||callApps.some(app=>app.id===a.application_id)))
      const matchedUsers = new Set(callMatches.map(m=>m.user_id))
      const callCandidates = candidates.filter(c=>c.funding_call_id===call.id && (matchedUsers.has(c.user_id)||personSchool.get(c.user_id)===school.id))
      const considered = new Set(callCandidates.filter(c=>matchedUsers.has(c.user_id)).map(c=>c.user_id)).size
      const approached = new Set(callCandidates.filter(c=>['APPROACHED','ASSIGNED'].includes(c.status)).map(c=>c.user_id)).size
      const contactRows = contacts.filter(c=>c.school_id===school.id && c.call_id===call.id)
      const externalContactRows = contactRows.filter(external)
      const disposition = dispositions.find(d=>d.school_id===school.id && d.call_id===call.id) || null
      const hasRecordedWork = Boolean(call.decided_at || callApps.length || allCallActions.length || disposition || contactRows.length || callCandidates.length)
      const isOrigin = call.origin_school_id===school.id || Boolean(call.intake_origin)
      const isMatched = callMatches.length>0
      const isMapped = Boolean(mappingRow && !mappingRow.is_origin)
      const quality = adHoc?'ad-hoc':call.triage==='NOT_RELEVANT'?'dismissed':isMatched||call.triage==='RELEVANT'?'confirmed':isMapped?'mapped':hasRecordedWork?'historical-work':isOrigin?'origin':'unmatched'
      // A mapped call is this school's business as surely as a confirmed one.
      const relevantQuality = isRelevantQuality(quality)
      if (filters.relevance && filters.relevance!==quality && filters.relevance!==relevance.get(call.id)?.tier) return []
      const callActionOverdue = allCallActions.some(a=>['OPEN','ACKNOWLEDGED'].includes(a.status)&&overdueAt(a.due_at,at))
      const actionState = opportunityActionState({applications:callApps.length,candidatesReviewed:considered,
        externalContacts:externalContactRows.length,recordedActions:allCallActions.length+(call.decided_at?1:0),dispositionRecorded:closesOpportunity(disposition?.reason)})
      const unallocated = (relevantQuality||quality==='origin') && !callApps.some(a=>a.assignment_id)
      const formalAllocationCount = callApps.filter(a=>Boolean(a.assignment_id)).length
      const submittedApplicationCount = callApps.filter(a=>a.submitted).length
      const hasAnySubmission = submittedApplicationCount>0
      const deadlineRisk = opportunityDeadlineAttention({deadline:call.deadline,asOf:at,quality:relevantQuality?'confirmed':quality,formalAllocations:formalAllocationCount,
        submissions:submittedApplicationCount,outstandingApplications:callApps.filter(a=>a.outstanding).length})
      const missedUnallocatedNoSubmission = deadlineRisk.missedUnallocatedNoSubmission
      // The shared per-responsibility states (reportDefinitions).
      const review = adHoc ? null : reviewState({triageStatus:call.triage,triageDecidedAt:call.decided_at,dispositionReason:disposition?.reason,
        formalAllocations:formalAllocationCount,namedActions:callActions.length})
      const deadlineStatus = adHoc ? null : deadlineState({deadline:call.deadline,formalAllocations:formalAllocationCount,submissions:submittedApplicationCount,
        closedWithReason:review==='CLOSED_NO_ALLOCATION'},at)
      const submission = submissionSummary(callApps.map(a=>({...a,verified:Boolean(a.verification)})))
      const upcoming21 = deadlineRisk.upcoming21
      const gaps = relevantQuality ? [
        !actionState.touched?'UNTOUCHED':null,
        unallocated && callMatches.length>0?'MATCHED_UNALLOCATED':null,
        unallocated && approached>0?'APPROACHED_UNALLOCATED':null,
        unallocated && callMatches.length===0 && projection.get(school.id)?.complete?'NO_MATCH_UNALLOCATED':null,
        missedUnallocatedNoSubmission?'MISSED_UNALLOCATED_NO_SUBMISSION':null,
        callActionOverdue?'OVERDUE_ACTION':null,
        !projection.get(school.id)?.complete?'MATCHING_INCOMPLETE':null,
      ].filter(Boolean) as string[] : []
      const remaining = callApps.filter(a=>appMatches(a) && (filters.mode==='pending'?a.outstanding:filters.mode==='activity'?isActivity(a):true))
      const dueCall = !filters.horizon || [call.deadline,...allCallActions.filter(a=>['OPEN','ACKNOWLEDGED'].includes(a.status)).map(a=>a.due_at)]
        .some(value=>value&&value.getTime()<=at.getTime()+filters.horizon!*day)
      const callExpired=isExpiredInIndia(call.deadline,at)
      const callReminders=reminders.filter(r=>r.school_id===school.id&&r.call_id===call.id).map(r=>({...r,status:'OPEN',waiting_with:'DSR',is_next:false}))
      const hasLiveWork=callApps.some(a=>a.outstanding)||allCallActions.some(a=>['OPEN','ACKNOWLEDGED'].includes(a.status))||callReminders.length>0
      // Missed calls stay in view for the head even with expired calls hidden,
      // so a period or expiry filter can never make a miss disappear.
      const missed = Boolean(deadlineStatus && MISSED_DEADLINE_STATES.includes(deadlineStatus) && (relevantQuality||quality==='origin'))
      if(callExpired&&!filters.includeExpired&&!hasLiveWork&&!(filters.showMissed&&missed))return []
      if (filters.mode==='cohort' && !inPeriod(firstSeen,filters.start,filters.end)) return []
      const callException = !filters.exception || filters.exception==='overdue' && (isExpiredInIndia(call.deadline,at)||callActionOverdue) ||
        filters.exception==='missing-deadline' && !call.deadline ||
        filters.exception==='matched-unallocated' && gaps.includes('MATCHED_UNALLOCATED') ||
        filters.exception==='untouched' && gaps.includes('UNTOUCHED') ||
        filters.exception==='approached-unallocated' && gaps.includes('APPROACHED_UNALLOCATED') ||
        filters.exception==='unallocated-no-matches' && gaps.includes('NO_MATCH_UNALLOCATED')
      const callWaiting = !filters.waitingWith || allCallActions.some(a=>['OPEN','ACKNOWLEDGED'].includes(a.status)&&a.waiting_with===filters.waitingWith)||callApps.some(a=>a.outstanding&&((filters.waitingWith==='FACULTY'&&a.stage==='AWAITING_FACULTY_RESPONSE')||(filters.waitingWith==='REVIEWER'&&a.stage==='INTERNAL_REVIEW')||(filters.waitingWith==='AGENCY'&&['SUBMITTED','UNDER_AGENCY_REVIEW'].includes(a.stage))))
      const showOpportunityGap = unallocated && dueCall && callException && callWaiting && !filters.workState && !filters.stage
      if (filters.mode==='pending' && remaining.length===0 && !showOpportunityGap && !allCallActions.some(a=>['OPEN','ACKNOWLEDGED'].includes(a.status)&&callWaiting&&callException)&&!callReminders.length) return []
      if (filters.mode==='activity' && remaining.length===0 && !contacts.some(c=>c.call_id===call.id && c.school_id===school.id && inPeriod(c.happened_at,filters.start,filters.end) && external(c))) return []
      if ((filters.workState || filters.stage || filters.exception || filters.waitingWith) && !remaining.length && !showOpportunityGap) return []
      const lastAction = [...contactRows.map(c=>({at:c.happened_at,by:c.actor_name})),
        ...allCallActions.map(a=>{const event=[...events].reverse().find(e=>e.entity_type==='ACTION'&&e.entity_id===a.id);return {at:a.updated_at,by:peopleMap.get(event?.actor_user_id||'')?.name||'Actor not recorded'}}),
        ...(call.decided_at?[{at:call.decided_at,by:'School triage'}]:[]),
        ...callCandidates.map(c=>({at:c.updated_at,by:peopleMap.get(c.created_by_user_id)?.name || 'Officer not recorded'})),
        ...(disposition?[{at:disposition.updated_at,by:peopleMap.get(disposition.actor_user_id)?.name || 'Officer not recorded'}]:[]),
        ...callApps.map(a=>({at:a.updated_at,by:a.allocatedBy?.name || a.submissionRecorder?.name || 'Officer not recorded'})),
      ].sort((a,b)=>b.at.getTime()-a.at.getTime())[0] || null
      const cover=coverage(school.id)
      const transfer=transfers.find(t=>t.school_id===school.id&&t.call_id===call.id)
      const transferredMember=transfer?members.find(m=>m.user_id===transfer.owner_user_id):null
      const responsible=transferredMember&&!isMemberAway(transferredMember,at)?transferredMember:cover.operational
      const firstTouchAt=[...contactRows.map(c=>c.happened_at),...allCallActions.map(a=>a.created_at),...callCandidates.map(c=>c.created_at),...callApps.map(a=>a.created_at),...(call.decided_at?[call.decided_at]:[]),...(disposition?[disposition.updated_at]:[])].sort((a,b)=>a.getTime()-b.getTime())[0]||null
      const waitingApp=callApps.find(a=>a.outstanding&&['AWAITING_FACULTY_RESPONSE','INTERNAL_REVIEW','SUBMITTED','UNDER_AGENCY_REVIEW'].includes(a.stage))
      const baseResponsibility={asOf:at,firstSeenAt:firstSeen,firstTouchAt,deadline:call.deadline,intakeReady:true,thresholds:settings,
        ownerUserId:responsible?.user_id,ownerName:responsible?.user.name||responsible?.user.email,
        waitingWith:waitingApp?.stage==='AWAITING_FACULTY_RESPONSE'?'FACULTY':waitingApp?.stage==='INTERNAL_REVIEW'?'REVIEWER':waitingApp?'AGENCY':null,
        waitingSince:waitingApp?.lastContact?.happened_at||waitingApp?.stageEnteredAt||waitingApp?.created_at,
        reviewState:review??undefined,originSchoolMissing:!call.origin_school_id&&!(call as any).has_tenant_origin,schoolUnmapped:profile.isUnmapped,ownerMissing:cover.uncovered,
        matchingComplete:projection.get(school.id)?.complete??false,matchedPeople:callMatches.length,applications:callApps.length,
        activeApplications:callApps.filter(a=>a.outstanding).length,assignments:formalAllocationCount,candidatesReviewed:considered,
        contacts:externalContactRows.length,dispositionRecorded:closesOpportunity(disposition?.reason),triageDecisionRecorded:['RELEVANT','NOT_RELEVANT','SHORTLISTED'].includes(call.triage||''),
        actions:[...allCallActions,...callReminders],lastActivityAt:lastAction?.at,internalDeadlineOverdue:callApps.some(a=>a.overdue.internal||a.overdue.review)}
      const responsibilities=[
        ...(isOrigin?[resolveResponsibility({...baseResponsibility,actions:callActions,activeApplications:0,waitingWith:null,internalDeadlineOverdue:false,responsibilityType:'ORIGIN_REVIEW'})]:[]),
        ...(isMatched||hasRecordedWork?[resolveResponsibility({...baseResponsibility,responsibilityType:'MATCHED_FOLLOW_UP'})]:
          isMapped&&!isOrigin?[resolveResponsibility({...baseResponsibility,actions:callActions,activeApplications:0,waitingWith:null,internalDeadlineOverdue:false,originSchoolMissing:false,schoolUnmapped:false,responsibilityType:'MAPPED_REVIEW'})]:[]),
      ].filter(r=>(!filters.responsibilityType||r.responsibilityType===filters.responsibilityType)&&(!filters.actionClass||r.actionClass===filters.actionClass)&&(!filters.ageDays||(r.daysSinceActivity??0)>=filters.ageDays)&&(!filters.queue||r.queue===filters.queue)&&(!filters.signal||Boolean(r[filters.signal as 'firstReviewOverdue'|'untouchedOverdue'|'silentLiveWork'|'facultyChaseDue'])))
      if((filters.responsibilityType||filters.actionClass||filters.ageDays||filters.queue||filters.signal)&&!responsibilities.length)return []
      if(filters.reviewState&&filters.reviewState!==review)return []
      if(filters.deadlineState&&filters.deadlineState!==deadlineStatus)return []
      return [{...call,schoolId:school.id,quality,firstSeen,inferred:observation?.inferred ?? false,
        reason:call.triage==='RELEVANT'?'School marked relevant':call.triage==='NOT_RELEVANT'?'School marked not relevant':isOrigin?'Selected as origin school':callMatches[0]?.match_reason || mappingRow?.reason || relevance.get(call.id)?.reason || null,
        reviewState:review,deadlineState:deadlineStatus,missed,submissionSummary:submission,
        allocations:callApps.filter(a=>a.assignment_id).map(a=>({applicationId:a.id,faculty:a.faculty||null,allocatedBy:a.allocatedBy||null,allocatedAt:a.created_at,
          submissionState:submissionState(a,Boolean(a.verification)).state,workingStage:submissionState(a,Boolean(a.verification)).workingStage})),
        mapping:mappingRow?{source:mappingRow.source,reason:mappingRow.reason,mappedAt:mappingRow.mapped_at,backfilled:mappingRow.backfilled}:null,
        firstTouchAt,coverage:{primary:cover.primary?.user||null,deputies:deputies(school.id).map(m=>m.user),isAway:cover.away,covering:cover.away?cover.operational?.user||null:null,uncovered:cover.uncovered,responsible:responsible?.user||null,transferred:Boolean(transfer)},
        matchedFaculty:callMatches.length,matchCompleteness:projection.get(school.id)?.complete?'COMPLETE':'PARTIAL',matches:callMatches.map(m=>{
          const allocation=callApps.find(a=>a.faculty_id===m.user_id&&Boolean(a.assignment_id))
          const independent=callApps.find(a=>a.faculty_id===m.user_id&&!a.assignment_id)
          const candidate=callCandidates.find(c=>c.user_id===m.user_id)
          return {...m,faculty:peopleMap.get(m.user_id),allocationStatus:allocation?'FORMALLY_ALLOCATED':independent?'INDEPENDENT_APPLICATION':'PENDING_ALLOCATION',
            applicationWorkState:allocation?.workState || independent?.workState || null,applicationId:allocation?.id || independent?.id || null,
            candidateStatus:candidate?.status || null}
        }),
        considered,approached,
        applications:remaining,childCount:remaining.length,allocated:remaining.filter(a=>!a.independent).length,
        independent:remaining.filter(a=>a.independent).length,submitted:remaining.filter(a=>a.submitted).length,
        pending:remaining.filter(a=>a.workState==='PENDING').length,overdue:remaining.filter(a=>a.exceptions.includes('overdue')).length,
        declined:remaining.filter(a=>a.stage==='DECLINED').length,lapsed:remaining.filter(a=>a.stage==='LAPSED_NOT_APPLIED').length,
        verified:remaining.filter(a=>a.verification&&a.submitted).length,followedUp:remaining.filter(a=>!a.independent&&a.followedUp).length,
        unallocated,matchedUnallocated:gaps.includes('MATCHED_UNALLOCATED'),actedOn:Boolean(actionState.touched||firstTouchAt),
        actionState:actionState.touched||firstTouchAt?'ACTED_ON':'UNTOUCHED',touchSignals:actionState.signals,gaps,lastAction,actions:callActions,disposition,
        daysToDeadline:deadlineRisk.daysToDeadline,deadlineStatus:deadlineRisk.status,upcoming21,hasAnySubmission,
        missedUnallocatedNoSubmission,missedExplanationStatus:missedUnallocatedNoSubmission?(disposition?'EXPLAINED':'UNEXPLAINED'):null,
        suggestedActionOwner:owners.get(school.id)?.user || null,responsibilities,isExpired:callExpired,retainedBecauseLiveWork:callExpired&&hasLiveWork,
        visibilityReasons:[...(isOrigin?['ORIGIN_SCHOOL']:[]),...(isMapped?['MAPPED_TO_SCHOOL']:[]),...(isMatched?['MATCHED_RESEARCHERS']:[]),...(hasRecordedWork&&!isMatched?['RECORDED_WORK']:[])],
      }]
    })
    return {...school,ownerId:owners.get(school.id)?.id || 'unassigned',owner:owners.get(school.id)?.user || null,
      isUnmapped:profile.isUnmapped,isAway:coverage(school.id).away,effectivelyUncovered:coverage(school.id).uncovered,deputies:deputies(school.id).map(m=>m.user),calls:callRows,childCount:callRows.length}
  }))
  const attentionCounts={
    upcoming21:rawSchoolRows.reduce((n,s)=>n+s.calls.filter(c=>c.upcoming21).length,0),
    missedUnallocatedNoSubmission:rawSchoolRows.reduce((n,s)=>n+s.calls.filter(c=>c.missedUnallocatedNoSubmission).length,0),
    // The two kinds of miss, kept apart (reportDefinitions.deadlineState).
    missedNeverAllocated:rawSchoolRows.reduce((n,s)=>n+s.calls.filter(c=>c.missed&&c.deadlineState==='MISSED_NEVER_ALLOCATED').length,0),
    missedAllocatedNotSubmitted:rawSchoolRows.reduce((n,s)=>n+s.calls.filter(c=>c.missed&&c.deadlineState==='MISSED_ALLOCATED_NOT_SUBMITTED').length,0),
  }
  const attentionMatch=(c:(typeof rawSchoolRows)[number]['calls'][number])=>filters.attention==='upcoming-21'?c.upcoming21:
    filters.attention==='missed-never-allocated'?c.missed&&c.deadlineState==='MISSED_NEVER_ALLOCATED':
    filters.attention==='missed-allocated-not-submitted'?c.missed&&c.deadlineState==='MISSED_ALLOCATED_NOT_SUBMITTED':c.missedUnallocatedNoSubmission
  const schoolRows = filters.attention ? rawSchoolRows.map(s=>{
    const calls=s.calls.filter(attentionMatch)
    return {...s,calls,childCount:calls.length}
  }).filter(s=>s.calls.length>0) : rawSchoolRows
  const summarize = (rows:typeof schoolRows)=>{
    // Ad-hoc rows carry independent applications with no funding call. Their
    // applications count; the rows themselves are not calls or school
    // responsibilities (reportDefinitions: uniqueCall, schoolResponsibility).
    const allCalls=rows.flatMap(s=>s.calls);const calls=allCalls.filter(c=>!isAdHocCallId(c.id));const items=allCalls.flatMap(c=>c.applications)
    return { schools:rows.length,callSchoolOpportunities:countSchoolResponsibilities(calls),
      distinctCalls:countUniqueCalls(calls),
      unclassified:new Set(calls.filter(c=>!c.origin_school_id&&!(c as any).has_tenant_origin).map(c=>c.id)).size,unmapped:rows.filter(s=>s.isUnmapped).length,
      facultyMatches:calls.reduce((n,c)=>n+c.matchedFaculty,0),allocated:countAllocations(items),
      independent:countIndependentApplications(items),applications:items.length,pending:items.filter(a=>a.workState==='PENDING').length,
      outstanding:items.filter(a=>a.outstanding).length,followedUp:items.filter(a=>isAllocation(a) && a.followedUp).length,
      contactEvents:items.reduce((n,a)=>n+a.contactEvents,0),submitted:countSubmissions(items),
      allocatedSubmissions:countSubmissions(items.filter(isAllocation)),independentSubmissions:countSubmissions(items.filter(isIndependentApplication)),
      verified:items.filter(a=>isSubmission(a) && a.verification).length,overdue:items.filter(a=>a.exceptions.includes('overdue')).length,
      actedOn:calls.filter(c=>c.actedOn||c.firstTouchAt).length,untouched:calls.filter(c=>!c.actedOn&&!c.firstTouchAt).length,
      matchedUnallocated:calls.filter(c=>c.matchedUnallocated).length,approachedUnallocated:calls.filter(c=>c.gaps.includes('APPROACHED_UNALLOCATED')).length,
      noNextAction:items.filter(a=>a.exceptions.includes('no-next-action')).length,
      upcoming21:calls.filter(c=>c.upcoming21).length,missedUnallocatedNoSubmission:calls.filter(c=>c.missedUnallocatedNoSubmission).length,
      unallocated:calls.filter(c=>c.unallocated).length,needsAttention:items.filter(a=>a.exceptions.length>0).length+
        calls.filter(c=>c.unallocated||c.gaps.includes('OVERDUE_ACTION')).length }
  }
  const rows = [...members.filter(m=>m.is_active).map(m=>({id:m.id,name:m.user.name || m.user.email,email:m.user.email,userId:m.user_id})),
    {id:'unassigned',name:'Unassigned DSR ownership',email:null,userId:null}].map(m=>{
      const rows=schoolRows.filter(s=>s.ownerId===m.id)
      return {...m,schools:rows,childCount:rows.length,totals:summarize(rows)}
    }).filter(m=>m.schools.length>0)
  const includedCalls = schoolRows.flatMap(s=>s.calls)
  const includedIds=new Set(includedCalls.flatMap(c=>c.applications.map(a=>a.id)))
  const scopedApps = apps.filter(a=>includedIds.has(a.id))
  const scopedActions=actions.filter(a=>includedCalls.some(c=>c.schoolId===a.school_id&&c.id===a.call_id)||Boolean(a.application_id&&includedIds.has(a.application_id)))
  const activityApps=scopedApps.filter(isActivity)
  const contributors = members.filter(m=>m.is_active&&!rows.some(r=>r.id===m.id)&&contacts.some(c=>c.actor_id===m.user_id&&external(c)))
    .map(m=>({id:m.id,name:m.user.name||m.user.email,userId:m.user_id,totals:summarize([])}))
  const hasDetailFilter=Boolean(filters.callId||filters.callSearch||filters.workState||filters.stage||filters.exception||filters.waitingWith||filters.horizon||filters.attention||filters.actionClass||filters.responsibilityType||filters.ageDays||filters.queue||!filters.includeExpired)
  const weekly=weeklyMovement(events,filters.start,filters.end,members.map(m=>({id:m.id,name:m.user.name || m.user.email})),ids)
  if(hasDetailFilter){weekly.complete=false;weekly.members=[];weekly.note='Weekly movement is a historical school portfolio measure. Include expired calls and clear detail filters to reconcile opening and closing backlog.'}
  const performance = [...rows,...contributors].map(member=>{
    const owned=schoolRows.filter(s=>s.ownerId===member.id).map(s=>s.id)
    const portfolio=scopedApps.filter(a=>owned.includes(a.school_id!));const periodApps=portfolio.filter(a=>inPeriod(a.firstSeen,filters.start,filters.end))
    const allocated=periodApps.filter(a=>!a.independent); const decisions=portfolio.filter(a=>['SANCTIONED','REJECTED'].includes(a.stage) && a.submitted)
    const completedActions=scopedActions.filter(a=>a.status==='DONE'&&a.owner_user_id===member.userId && inPeriod(a.completed_at,filters.start,filters.end))
    const allocationTimes=allocated.filter(a=>a.firstSeen).map(a=>(a.created_at.getTime()-a.firstSeen!.getTime())/day).filter(n=>n>=0)
    const firstContactTimes=allocated.filter(a=>a.contacts.some(external)).map(a=>(Math.min(...a.contacts.filter(external).map(c=>c.happened_at.getTime()))-a.created_at.getTime())/day).filter(n=>n>=0)
    const priorStart=new Date(filters.start.getTime()-(filters.end.getTime()-filters.start.getTime()))
    const money:Record<string,{requested:number;sanctioned:number}>={}
    for(const a of portfolio){money[a.currency]??={requested:0,sanctioned:0};money[a.currency].requested+=a.requested_amount || 0;if(a.stage==='SANCTIONED') money[a.currency].sanctioned+=a.sanctioned_amount || 0}
    const memberCalls=includedCalls.filter(c=>owned.includes(c.schoolId))
    const firstTouches=memberCalls.filter(c=>c.firstSeen&&c.firstTouchAt).map(c=>Math.max(0,(c.firstTouchAt!.getTime()-c.firstSeen!.getTime())/day))
    return {id:member.id,name:member.name,workload:member.totals,isAway:members.some(m=>m.id===member.id&&isMemberAway(m,at)),
      medianFirstTouchDays:median(firstTouches),firstTouchSample:firstTouches.length,
      oldestUnresolvedDays:Math.max(0,...memberCalls.flatMap(c=>c.responsibilities.filter(r=>!r.complete).map(r=>r.ageDays||0))),
      opportunityActionCoverage:ratio(member.totals.actedOn,member.totals.callSchoolOpportunities),
      submissionConversion:ratio(allocated.filter(a=>a.submitted).length,allocated.length),
      independentSubmissions:periodApps.filter(a=>a.independent && a.submitted).length,
      facultyContactCoverage:ratio(allocated.filter(a=>a.followedUp).length,allocated.length),
      medianFirstContactDays:median(firstContactTimes),firstContactSample:firstContactTimes.length,awaitingContact:allocated.filter(a=>!a.followedUp).length,
      medianAllocationDays:median(allocationTimes),allocationSample:allocationTimes.length,
      timelyActions:ratio(completedActions.filter(a=>a.due_at && a.completed_at!<=a.due_at).length,completedActions.filter(a=>a.due_at).length),
      fundingSuccess:ratio(decisions.filter(a=>a.stage==='SANCTIONED').length,decisions.length),undecided:portfolio.filter(a=>a.submitted && !a.closed).length,
      periodSubmissions:portfolio.filter(a=>inPeriod(a.submitted_at,filters.start,filters.end)).length,
      previousPeriodSubmissions:portfolio.filter(a=>inPeriod(a.submitted_at,priorStart,filters.start)).length,
      inheritedBacklog:weekly.complete?(weekly.members.find(m=>m.id===member.id)?.transfersIn||0):null,
      performedAllocations:scopedApps.filter(a=>!a.independent&&a.allocated_by===member.userId&&inPeriod(a.created_at,filters.start,filters.end)).length,
      performedSubmissions:scopedApps.filter(a=>a.submission_recorder===member.userId&&inPeriod(a.submitted_at,filters.start,filters.end)).length,
      performedContacts:contacts.filter(c=>external(c) && c.actor_id===member.userId && inPeriod(c.happened_at,filters.start,filters.end)).length,money}
  })
  const faculty=people.filter(p=>(!filters.facultyId||p.id===filters.facultyId)&&Boolean(personSchool.get(p.id)&&ids.includes(personSchool.get(p.id)!))).map(p=>{
    const facultyMatches=matches.filter(m=>m.user_id===p.id&&includedCalls.some(c=>c.id===m.funding_call_id&&c.schoolId===m.school_id))
    const items=scopedApps.filter(a=>a.faculty_id===p.id)
    const lifetime=apps.filter(a=>a.faculty_id===p.id)
    const history=facultyHistory.find(h=>h.faculty_id===p.id)
    const everAssigned=history?.ever_assigned??false
    const approached=candidates.filter(c=>c.user_id===p.id && ['APPROACHED','ASSIGNED'].includes(c.status) && facultyMatches.some(m=>m.funding_call_id===c.funding_call_id))
    const activityDates=[...(history?.last_engaged_at?[history.last_engaged_at]:[]),...lifetime.map(a=>a.updated_at),...candidates.filter(c=>c.user_id===p.id).map(c=>c.updated_at)].sort((a,b)=>b.getTime()-a.getTime())
    return {id:p.id,name:p.name || p.email,suitableOpportunities:facultyMatches.length,approached:approached.length,
      neverApproached:facultyMatches.filter(m=>!approached.some(c=>c.funding_call_id===m.funding_call_id) && !history?.call_ids?.includes(m.funding_call_id)).length,
      allocations:items.filter(a=>!a.independent).length,active:items.filter(a=>a.outstanding).length,submitted:items.filter(a=>a.submitted).length,
      completeness:'Current projected matches; see matching run completeness',schoolIds:[personSchool.get(p.id)!],
      profileReady:!projection.get(personSchool.get(p.id)!)?.unprofiled.includes(p.id),everAssigned,
      lastEngagementAt:activityDates[0]||null,engagement:lifetime.some(a=>a.outstanding)?'ENGAGED':!everAssigned?'NEVER_ASSIGNED':!activityDates[0]||at.getTime()-activityDates[0].getTime()>=settings.facultyDormantDays*day?'DORMANT':'PREVIOUSLY_ENGAGED'}
  })
  const workbench=schoolRows.flatMap(s=>s.calls.flatMap(call=>call.responsibilities.map(responsibility=>({
    ...call,workItemId:`${s.id}:${call.id}:${responsibility.responsibilityType}`,schoolId:s.id,schoolName:s.name,
    memberId:s.ownerId,memberName:s.owner?.name||s.owner?.email||'Unassigned DSR ownership',
    callId:call.id,responsibility,
  })))).filter(row=>(filters.includeExpired||!row.isExpired||row.retainedBecauseLiveWork)&&(filters.includeCompleted||filters.actionClass==='COMPLETED'||row.responsibility.queue!=='COMPLETED'))
  workbench.sort((a,b)=>a.responsibility.priority-b.responsibility.priority ||
    (a.deadline?.getTime()??Infinity)-(b.deadline?.getTime()??Infinity) || a.title.localeCompare(b.title))
  const correctiveActions=scopedActions.filter(a=>a.category==='CORRECTIVE').map(a=>({...a,repeatedCount:actions.filter(other=>other.category==='CORRECTIVE'&&other.school_id===a.school_id&&other.failure_type===a.failure_type).length})).filter(a=>!filters.actionStatus||filters.actionStatus==='OVERDUE'?(!filters.actionStatus||['OPEN','ACKNOWLEDGED'].includes(a.status)&&Boolean(a.due_at&&a.due_at<at)):filters.actionStatus==='REPEATED'?a.repeatedCount>1:a.status===filters.actionStatus)
  const actionCounts={
    new:correctiveActions.filter(a=>a.status==='OPEN').length,
    acknowledged:correctiveActions.filter(a=>a.status==='ACKNOWLEDGED').length,
    overdue:correctiveActions.filter(a=>['OPEN','ACKNOWLEDGED'].includes(a.status)&&Boolean(a.due_at&&a.due_at<at)).length,
    resolved:correctiveActions.filter(a=>a.status==='DONE').length,
    cancelled:correctiveActions.filter(a=>a.status==='CANCELLED').length,
  }
  const headSummary={
    actionOverdue:workbench.filter(r=>r.responsibility.queue==='ACTION_OVERDUE').length,
    closingSoon:workbench.filter(r=>r.responsibility.queue==='CLOSING_SOON').length,
    newToReview:workbench.filter(r=>r.responsibility.queue==='NEW_TO_REVIEW').length,
    allocationPending:workbench.filter(r=>r.responsibility.queue==='ALLOCATION_PENDING').length,
    waitingOnOthers:workbench.filter(r=>r.responsibility.queue==='WAITING_ON_OTHERS').length,
    inProgress:workbench.filter(r=>r.responsibility.queue==='IN_PROGRESS').length,
    dataRouting:workbench.filter(r=>r.responsibility.queue==='DATA_ROUTING').length,
    peopleNeverAssigned:faculty.filter(p=>p.engagement==='NEVER_ASSIGNED'&&p.suitableOpportunities>0).length,
    uncoveredSchools:schoolRows.filter(s=>s.effectivelyUncovered).length,
    firstReviewOverdue:workbench.filter(r=>r.responsibility.firstReviewOverdue).length,
    untouchedOverdue:workbench.filter(r=>r.responsibility.untouchedOverdue).length,
    silentLiveWork:workbench.filter(r=>r.responsibility.silentLiveWork).length,
    facultyChaseDue:workbench.filter(r=>r.responsibility.facultyChaseDue).length,
    correctiveActions:actionCounts,
  }
  const incoming=filters.reportView==='incoming'?(await getIncomingReport(tenantId,filters.schoolIds?ids:filters.memberId?ids:undefined,{...filters,asOf:at,actionClass:null})).map(row=>{const cover=row.schoolId?coverage(row.schoolId):null;const missingCover=cover&&!cover.operational&&!['COMPLETED','SYSTEM_PROCESSING'].includes(row.actionClass);return {...row,ownerName:cover?.operational?.user.name||cover?.operational?.user.email||null,actionClass:missingCover?'DATA_GAP':row.actionClass,nextAction:missingCover?'Assign an available primary member or deputy cover':row.nextAction}}).filter(r=>!filters.actionClass||r.actionClass===filters.actionClass):[]
  return {asOf:at,mode:filters.mode,period:{start:filters.start,end:filters.end},members:rows,totals:summarize(schoolRows),attentionCounts,
    activity:{allocations:activityApps.filter(a=>a.assignment_id && inPeriod(a.created_at,filters.start,filters.end)).length,
      independent:activityApps.filter(a=>a.independent && inPeriod(a.created_at,filters.start,filters.end)).length,
      submissions:activityApps.filter(a=>inPeriod(a.submitted_at,filters.start,filters.end)).length,
      contacts:activityApps.reduce((n,a)=>n+a.contacts.filter(c=>external(c) && inPeriod(c.happened_at,filters.start,filters.end)).length,0)},
    performance,weekly,faculty,workbench,headSummary,correctiveActions,settings,incoming,filters,applications:scopedApps,actions:scopedActions,
    coverageProblems:schoolRows.filter(s=>s.effectivelyUncovered||s.isUnmapped).map(s=>({schoolId:s.id,schoolName:s.name,isAway:s.isAway,uncovered:s.effectivelyUncovered,isUnmapped:s.isUnmapped,owner:s.owner,deputies:s.deputies})),
    unmappedFaculty:filters.schoolIds?[]:people.filter(p=>p.researcher_profile&&!personSchool.get(p.id)).map(p=>({id:p.id,name:p.name||p.email})),
    quality:{unknownFirstSeen:scopedApps.filter(a=>!a.firstSeen).length,inferredMatches:matches.filter(m=>m.inferred).length,
      unknownStageDates:scopedApps.filter(a=>!a.stageEnteredAt).length,matchingComplete:ids.every(id=>projection.get(id)?.complete),
      matchingRefreshPending:ids.some(id=>!projection.get(id)?.fresh),
      incompleteMatchingOpportunities:includedCalls.filter(c=>isRelevantQuality(c.quality)&&c.matchCompleteness!=='COMPLETE').length,
      historySince:events.find(e=>e.kind==='BASELINE')?.occurred_at || null},
    options:{members:members.filter(m=>m.is_active&&(!filters.schoolIds||m.school_assignments.some(s=>ids.includes(s.org_unit_id)))).map(m=>({id:m.id,name:m.user.name||m.user.email,userId:m.user_id})),schools:schoolCatalog.filter(s=>s.is_active&&(!filters.schoolIds||filters.schoolIds.includes(s.id))).map(s=>({id:s.id,name:s.name})),people:[...peopleMap.values()].filter(p=>!filters.schoolIds||ids.includes(personSchool.get(p.id)||'')||members.some(m=>m.user_id===p.id&&(m.is_head||m.school_assignments.some(s=>ids.includes(s.org_unit_id)))))}}
}

/** Replay recorded states. Baselines before the requested start are required;
 * a missing past baseline is incomplete, never a fabricated opening backlog. */
export function weeklyMovement(events: EventRow[], start: Date, end: Date, members: Array<{id:string;name:string}>, schoolIds:string[]) {
  const baseline = events.filter(e=>e.kind==='BASELINE' && e.entity_type==='HISTORY')
  const complete = schoolIds.every(id=>baseline.some(e=>e.school_id===id && new Date(e.occurred_at)<=start))
  const apps=new Map<string,any>();const coverage=new Map<string,any>()
  const owner=(school:string)=>[...coverage.values()].find(c=>c.org_unit_id===school && !c.is_deputy)?.member_id || 'unassigned'
  const buckets=new Map([...members,{id:'unassigned',name:'Unassigned DSR ownership'}].map(m=>[m.id,{...m,opening:0,newWork:0,reopened:0,resolved:0,transfersIn:0,transfersOut:0,closing:0}]))
  const add=(id:string,key:'newWork'|'reopened'|'resolved'|'transfersIn'|'transfersOut',amount=1)=>{const b=buckets.get(id);if(b)b[key]+=amount}
  const pending=(a:any)=>a && applicationState(a).outstanding
  for(const e of events.filter(e=>new Date(e.occurred_at)<start)) {
    if(e.entity_type==='APPLICATION'){if(e.after_data)apps.set(e.entity_id,e.after_data);else apps.delete(e.entity_id)}
    if(e.entity_type==='OWNERSHIP'){if(e.after_data)coverage.set(e.entity_id,e.after_data);else coverage.delete(e.entity_id)}
  }
  for(const a of apps.values()) if(pending(a)){const b=buckets.get(owner(a.school_id));if(b)b.opening++}
  for(const e of events.filter(e=>inPeriod(e.occurred_at,start,end))) {
    if(e.entity_type==='APPLICATION') {
      const before=apps.get(e.entity_id);const after=e.after_data
      if(e.kind!=='BASELINE') {
        if(!pending(before)&&pending(after))add(owner(after.school_id),before?'reopened':'newWork')
        if(pending(before)&&!pending(after))add(owner(before.school_id),'resolved')
        if(pending(before)&&pending(after)&&before.school_id!==after.school_id){add(owner(before.school_id),'transfersOut');add(owner(after.school_id),'transfersIn')}
      }
      if(after)apps.set(e.entity_id,after);else apps.delete(e.entity_id)
    }
    if(e.entity_type==='OWNERSHIP') {
      const school=e.school_id!;const previous=owner(school)
      if(e.after_data)coverage.set(e.entity_id,e.after_data);else coverage.delete(e.entity_id)
      const next=owner(school)
      if(e.kind!=='BASELINE'&&previous!==next){const count=[...apps.values()].filter(a=>a.school_id===school&&pending(a)).length;add(previous,'transfersOut',count);add(next,'transfersIn',count)}
    }
  }
  for(const a of apps.values())if(pending(a)&&schoolIds.includes(a.school_id)){const b=buckets.get(owner(a.school_id));if(b)b.closing++}
  return {complete,definition:'Application backlog: opening + new + reopened + transfers in − resolved − transfers out = closing.',
    members:[...buckets.values()].filter(b=>b.opening+b.closing+b.newWork+b.resolved+b.transfersIn+b.transfersOut>0).map(b=>({...b,reconciled:complete?b.opening+b.newWork+b.reopened+b.transfersIn-b.resolved-b.transfersOut===b.closing:null})),
    note:complete?null:'History is incomplete for this period. Opening backlog and movement cannot yet be certified.'}
}
export type ManagementReport = Awaited<ReturnType<typeof getManagementReport>>
