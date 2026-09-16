import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { loadUnitAreaProfile, relevanceForCalls, relevantCallWhereSql } from '@/lib/funding/callUnitRelevance'
import { textArray, visibleCallSql } from './callSql'
import { applicationState, day, evidenceFingerprint, hasSubmissionEvidence, inPeriod, median, opportunityActionState, overdueAt, ratio, type ApplicationRow, type ReportMode } from './managementRules'
import { resolveActivityWindow } from './accountabilityService'

export type ActionRow = {
  id: string; tenant_id: string; school_id: string; call_id: string | null; application_id: string | null
  title: string; owner_user_id: string; owner_name: string; waiting_with: string; status: string
  is_next: boolean; due_at: Date | null; blocker: string | null; deadline_type: string
  created_at: Date; updated_at: Date; completed_at: Date | null; version: number
}
type Contact = { id: string; application_id: string; school_id: string; call_id: string | null; actor_id: string; actor_name: string; kind: string; target: string; happened_at: Date; note: string }
type EventRow = { id: string; school_id: string | null; entity_type: string; entity_id: string; kind: string; before_data: any; after_data: any; occurred_at: Date; inferred: boolean; actor_user_id: string | null; reason: string | null }
export type ManagementFilters = {
  schoolIds?: string[]; memberId?: string | null; schoolId?: string | null; callId?: string | null; callSearch?: string | null
  mode: ReportMode; start: Date; end: Date; asOf: Date; workState?: string | null; stage?: string | null
  relevance?: string | null; exception?: string | null; waitingWith?: string | null; horizon?: number | null
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
  const [schoolCatalog, members] = await Promise.all([
    prisma.tenantOrgUnit.findMany({ where: { tenant_id: tenantId, depth: 0 }, orderBy: [{name:'asc'},{id:'asc'}], select: { id:true,name:true,code:true,is_active:true } }),
    prisma.fundingDeptMember.findMany({ where: {tenant_id:tenantId}, include: { user:{select:{id:true,name:true,email:true}}, school_assignments:true } }),
  ])
  const owners = new Map<string, (typeof members)[number]>()
  for (const member of members.filter(m=>m.is_active)) for (const row of member.school_assignments.filter(s=>!s.is_deputy)) owners.set(row.org_unit_id,member)
  const schools = schoolCatalog.filter(s=>(!filters.schoolIds || filters.schoolIds.includes(s.id)) &&
    (!filters.schoolId || filters.schoolId === s.id) && (!filters.memberId ||
      (filters.memberId === 'unassigned' ? !owners.has(s.id) : owners.get(s.id)?.id === filters.memberId)))
  const ids = schools.map(s=>s.id)
  const [applications, contacts, actions, matches, observations, verifications, documents, events, candidates, runs, dispositions, people] = await Promise.all([
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
    prisma.fundingOpportunityMatch.findMany({where:{tenant_id:tenantId,school_id:{in:ids},first_seen_at:{lte:at}}}),
    prisma.$queryRaw<Array<{ school_id:string;call_id:string;first_seen_at:Date;inferred:boolean }>>(Prisma.sql`SELECT * FROM dsr_opportunity_observations WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(ids)}) AND first_seen_at<=${at}`),
    prisma.$queryRaw<Array<{ application_id:string;evidence_fingerprint:string;reviewer_user_id:string;verified_at:Date }>>(Prisma.sql`SELECT * FROM dsr_submission_verifications WHERE tenant_id=${tenantId} AND verified_at<=${at}`),
    prisma.$queryRaw<Array<{application_id:string;id:string}>>(Prisma.sql`SELECT 'assignment:'||assignment_id application_id,id FROM assignment_documents WHERE tenant_id=${tenantId} AND kind='PROPOSAL'
      UNION ALL SELECT COALESCE('assignment:'||p.assignment_id,'proposal:'||p.id),d.id FROM grant_proposal_documents d JOIN grant_proposals p ON p.id=d.proposal_id WHERE p.tenant_id=${tenantId} AND d.kind='SUBMISSION_PROOF'`),
    prisma.$queryRaw<EventRow[]>(Prisma.sql`SELECT id::text,school_id,entity_type,entity_id,kind,before_data,after_data,occurred_at,inferred,actor_user_id,reason
      FROM dsr_events WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(ids)}) AND occurred_at<=${at} ORDER BY occurred_at,id`),
    prisma.callCandidate.findMany({where:{tenant_id:tenantId},select:{funding_call_id:true,user_id:true,status:true,created_at:true,updated_at:true,created_by_user_id:true}}),
    prisma.$queryRaw<Array<{call_id:string;scope:any;completeness:string;completed_at:Date}>>(Prisma.sql`SELECT call_id,scope,completeness,completed_at FROM dsr_matching_runs WHERE tenant_id=${tenantId} AND completed_at<=${at} ORDER BY completed_at DESC`),
    prisma.$queryRaw<Array<{school_id:string;call_id:string;reason:string;explanation:string|null;actor_user_id:string;updated_at:Date}>>(Prisma.sql`SELECT * FROM dsr_opportunity_dispositions WHERE tenant_id=${tenantId} AND school_id=ANY(${textArray(ids)})`),
    prisma.user.findMany({where:{tenantId},select:{id:true,name:true,email:true,researcher_profile:{select:{org_unit_id:true,org_unit:{select:{path:true}}}}}}),
  ])
  const peopleMap = new Map(people.map(p=>[p.id,{id:p.id,name:p.name || p.email,email:p.email}]))
  const personSchool = new Map(people.map(p=>[p.id,p.researcher_profile?.org_unit?.path[0] || null]))
  const observationMap = new Map(observations.map(o=>[`${o.school_id}:${o.call_id}`,o]))
  const external = (c:Contact)=>c.target==='FACULTY' && ['CALL','EMAIL','MEETING'].includes(c.kind)
  const apps = applications.map(row=>{
    const state = applicationState(row)
    const appContacts = contacts.filter(c=>c.application_id===row.id)
    const facultyContacts = appContacts.filter(external).sort((a,b)=>b.happened_at.getTime()-a.happened_at.getTime())
    const appActions = actions.filter(a=>a.application_id===row.id)
    const nextAction = appActions.find(a=>a.is_next && a.status==='OPEN') || null
    const proof = documents.filter(d=>d.application_id===row.id).map(d=>d.id)
    const verification = verifications.find(v=>v.application_id===row.id && v.evidence_fingerprint===evidenceFingerprint(row,proof)) || null
    const evidenceAvailable = hasSubmissionEvidence(row,proof)
    const history = events.filter(e=>e.entity_type==='APPLICATION' && e.entity_id===row.id)
    const entered = [...history].reverse().find(e=>!e.inferred && e.after_data &&
      (!e.before_data || applicationState(e.before_data).stage !== applicationState(e.after_data).stage))
    const overdue = {
      agency: state.outstanding && !state.submitted && overdueAt(row.agency_deadline,at),
      internal: state.outstanding && !state.submitted && overdueAt(row.internal_deadline,at),
      review: state.outstanding && ['PROPOSAL_DRAFTING','INTERNAL_REVIEW'].includes(state.stage) && overdueAt(row.review_deadline,at),
      action: appActions.some(a=>a.status==='OPEN' && overdueAt(a.due_at,at)),
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
    (!filters.horizon || [a.agency_deadline,a.internal_deadline,a.review_deadline,...a.actions.filter(x=>x.status==='OPEN').map(x=>x.due_at)]
      .some(d=>d && new Date(d).getTime()<=at.getTime()+filters.horizon!*day && a.outstanding))
  const isActivity = (a:typeof apps[number])=>inPeriod(a.created_at,filters.start,filters.end) || inPeriod(a.submitted_at,filters.start,filters.end) ||
    a.contacts.some(c=>external(c) && inPeriod(c.happened_at,filters.start,filters.end)) || a.actions.some(x=>inPeriod(x.completed_at,filters.start,filters.end))
  const schoolRows = await Promise.all(schools.map(async school => {
    const profile = await loadUnitAreaProfile(tenantId,[school.id])
    const relevant = relevantCallWhereSql(profile,'fc',{pinnedForUnitId:school.id})
    const calls = await prisma.$queryRaw<Array<{id:string;title:string;agency:string|null;deadline:Date|null;triage:string|null}>>(Prisma.sql`
      SELECT fc.id,COALESCE(fc.scheme_title,fc.title) title,COALESCE(fc.agency_name,fc."agencyName") agency,
      COALESCE(fc.close_date,fc."deadlineAt") deadline,tri.status triage
      FROM funding_calls fc LEFT JOIN call_school_triage tri ON tri.funding_call_id=fc.id AND tri.org_unit_id=${school.id} AND tri.tenant_id=${tenantId}
      WHERE fc."createdAt"<=${at} AND (
        (${visibleCallSql(tenantId)} AND ${relevant}) OR
        (EXISTS(SELECT 1 FROM dsr_opportunity_observations o WHERE o.tenant_id=${tenantId} AND o.school_id=${school.id} AND o.call_id=fc.id)
         AND (fc."tenantId"=${tenantId} OR (fc."tenantId" IS NULL AND fc.visibility='GLOBAL_PUBLISHED')))
        OR EXISTS(SELECT 1 FROM dsr_applications a WHERE a.tenant_id=${tenantId} AND a.school_id=${school.id} AND a.call_id=fc.id)) ORDER BY fc.id`)
    const relevance = await relevanceForCalls(profile,calls.map(c=>c.id))
    const allSchoolApps = apps.filter(a=>a.school_id===school.id)
    for (const app of allSchoolApps.filter(a=>!a.call_id)) calls.push({id:`adhoc:${app.proposal_id}`,title:app.title,agency:app.agency,deadline:app.agency_deadline,triage:null})
    const callRows = calls.flatMap(call=>{
      if (filters.callId && filters.callId!==call.id) return []
      if (filters.callSearch && !`${call.title} ${call.id}`.toLowerCase().includes(filters.callSearch.toLowerCase())) return []
      const adHoc = call.id.startsWith('adhoc:')
      const callApps = allSchoolApps.filter(a=>adHoc ? `adhoc:${a.proposal_id}`===call.id : a.call_id===call.id)
      const observation = observationMap.get(`${school.id}:${call.id}`)
      const firstSeen = observation?.first_seen_at || (adHoc ? callApps[0]?.created_at : null) || null
      const quality = adHoc?'ad-hoc':call.triage==='NOT_RELEVANT'?'dismissed':call.triage==='RELEVANT'?'confirmed':profile.isUnmapped?'unmapped':
        ['direct','broad','keyword'].includes(relevance.get(call.id)?.tier || '')?'confirmed':relevance.get(call.id)?.tier==='unclassified'?'unclassified':'unmatched'
      if (filters.relevance && filters.relevance!==quality && filters.relevance!==relevance.get(call.id)?.tier) return []
      const callMatches = matches.filter(m=>m.school_id===school.id && m.funding_call_id===call.id)
      const callActions = actions.filter(a=>a.school_id===school.id && a.call_id===call.id && !a.application_id)
      const matchedUsers = new Set(callMatches.map(m=>m.user_id))
      const callCandidates = candidates.filter(c=>c.funding_call_id===call.id && (matchedUsers.has(c.user_id)||personSchool.get(c.user_id)===school.id))
      const considered = new Set(callCandidates.map(c=>c.user_id)).size
      const approached = new Set(callCandidates.filter(c=>['APPROACHED','ASSIGNED'].includes(c.status)).map(c=>c.user_id)).size
      const contactRows = contacts.filter(c=>c.school_id===school.id && c.call_id===call.id)
      const externalContactRows = contactRows.filter(external)
      const disposition = dispositions.find(d=>d.school_id===school.id && d.call_id===call.id) || null
      const latestRun = runs.find(r=>r.call_id===call.id && (r.scope.schoolIds as string[] | undefined)?.includes(school.id))
      const callActionOverdue = callActions.some(a=>a.status==='OPEN'&&overdueAt(a.due_at,at))
      const actionState = opportunityActionState({applications:callApps.length,candidatesReviewed:considered,
        externalContacts:externalContactRows.length,recordedActions:callActions.length,dispositionRecorded:Boolean(disposition)})
      const unallocated = quality==='confirmed' && !callApps.some(a=>a.assignment_id)
      const gaps = quality==='confirmed' ? [
        !actionState.touched?'UNTOUCHED':null,
        unallocated && callMatches.length>0?'MATCHED_UNALLOCATED':null,
        unallocated && approached>0?'APPROACHED_UNALLOCATED':null,
        unallocated && callMatches.length===0 && latestRun?.completeness==='COMPLETE'?'NO_MATCH_UNALLOCATED':null,
        callActionOverdue?'OVERDUE_ACTION':null,
        latestRun?.completeness!=='COMPLETE'?'MATCHING_INCOMPLETE':null,
      ].filter(Boolean) as string[] : []
      const remaining = callApps.filter(a=>appMatches(a) && (filters.mode==='pending'?a.outstanding:filters.mode==='activity'?isActivity(a):true))
      const dueCall = !filters.horizon || [call.deadline,...callActions.filter(a=>a.status==='OPEN').map(a=>a.due_at)]
        .some(value=>value&&value.getTime()<=at.getTime()+filters.horizon!*day)
      if (filters.mode==='cohort' && !inPeriod(firstSeen,filters.start,filters.end)) return []
      const callException = !filters.exception || filters.exception==='overdue' && (overdueAt(call.deadline,at)||callActionOverdue) ||
        filters.exception==='missing-deadline' && !call.deadline ||
        filters.exception==='matched-unallocated' && gaps.includes('MATCHED_UNALLOCATED') ||
        filters.exception==='untouched' && gaps.includes('UNTOUCHED') ||
        filters.exception==='approached-unallocated' && gaps.includes('APPROACHED_UNALLOCATED') ||
        filters.exception==='unallocated-no-matches' && gaps.includes('NO_MATCH_UNALLOCATED')
      const callWaiting = !filters.waitingWith || callActions.some(a=>a.status==='OPEN'&&a.waiting_with===filters.waitingWith)
      const showOpportunityGap = unallocated && dueCall && callException && callWaiting && !filters.workState && !filters.stage
      if (filters.mode==='pending' && remaining.length===0 && !showOpportunityGap && !callActions.some(a=>a.status==='OPEN'&&callWaiting&&callException)) return []
      if (filters.mode==='activity' && remaining.length===0 && !contacts.some(c=>c.call_id===call.id && c.school_id===school.id && inPeriod(c.happened_at,filters.start,filters.end) && external(c))) return []
      if ((filters.workState || filters.stage || filters.exception || filters.waitingWith) && !remaining.length && !showOpportunityGap) return []
      const lastAction = [...contactRows.map(c=>({at:c.happened_at,by:c.actor_name})),
        ...callActions.map(a=>({at:a.updated_at,by:a.owner_name})),
        ...callCandidates.map(c=>({at:c.updated_at,by:peopleMap.get(c.created_by_user_id)?.name || 'Officer not recorded'})),
        ...(disposition?[{at:disposition.updated_at,by:peopleMap.get(disposition.actor_user_id)?.name || 'Officer not recorded'}]:[]),
        ...callApps.map(a=>({at:a.updated_at,by:a.allocatedBy?.name || a.submissionRecorder?.name || 'Officer not recorded'})),
      ].sort((a,b)=>b.at.getTime()-a.at.getTime())[0] || null
      return [{...call,schoolId:school.id,quality,firstSeen,inferred:observation?.inferred ?? false,
        reason:call.triage==='RELEVANT'?'School marked relevant':call.triage==='NOT_RELEVANT'?'School marked not relevant':relevance.get(call.id)?.reason || null,
        matchedFaculty:callMatches.length,matchCompleteness:latestRun?.completeness || 'UNKNOWN',matches:callMatches.map(m=>{
          const allocation=callApps.find(a=>a.faculty_id===m.user_id&&Boolean(a.assignment_id))
          const independent=callApps.find(a=>a.faculty_id===m.user_id&&!a.assignment_id)
          return {...m,faculty:peopleMap.get(m.user_id),allocationStatus:allocation?'FORMALLY_ALLOCATED':independent?'INDEPENDENT_APPLICATION':'PENDING_ALLOCATION',
            applicationWorkState:allocation?.workState || independent?.workState || null,applicationId:allocation?.id || independent?.id || null}
        }),
        considered,approached,
        applications:remaining,childCount:remaining.length,allocated:remaining.filter(a=>!a.independent).length,
        independent:remaining.filter(a=>a.independent).length,submitted:remaining.filter(a=>a.submitted).length,
        pending:remaining.filter(a=>a.workState==='PENDING').length,overdue:remaining.filter(a=>a.exceptions.includes('overdue')).length,
        declined:remaining.filter(a=>a.stage==='DECLINED').length,lapsed:remaining.filter(a=>a.stage==='LAPSED_NOT_APPLIED').length,
        verified:remaining.filter(a=>a.verification&&a.submitted).length,followedUp:remaining.filter(a=>!a.independent&&a.followedUp).length,
        unallocated,matchedUnallocated:gaps.includes('MATCHED_UNALLOCATED'),actedOn:actionState.touched,
        actionState:actionState.touched?'ACTED_ON':'UNTOUCHED',touchSignals:actionState.signals,gaps,lastAction,actions:callActions,disposition,
        suggestedActionOwner:owners.get(school.id)?.user || null,
      }]
    })
    return {...school,ownerId:owners.get(school.id)?.id || 'unassigned',owner:owners.get(school.id)?.user || null,
      isUnmapped:profile.isUnmapped,calls:callRows,childCount:callRows.length}
  }))
  const summarize = (rows:typeof schoolRows)=>{
    const calls=rows.flatMap(s=>s.calls);const items=calls.flatMap(c=>c.applications)
    return { schools:rows.length,callSchoolOpportunities:calls.filter(c=>c.quality==='confirmed').length,
      distinctCalls:new Set(calls.filter(c=>c.quality==='confirmed').map(c=>c.id)).size,
      unclassified:calls.filter(c=>c.quality==='unclassified').length,unmapped:calls.filter(c=>c.quality==='unmapped').length,
      facultyMatches:calls.reduce((n,c)=>n+c.matchedFaculty,0),allocated:items.filter(a=>!a.independent).length,
      independent:items.filter(a=>a.independent).length,applications:items.length,pending:items.filter(a=>a.workState==='PENDING').length,
      outstanding:items.filter(a=>a.outstanding).length,followedUp:items.filter(a=>!a.independent && a.followedUp).length,
      contactEvents:items.reduce((n,a)=>n+a.contactEvents,0),submitted:items.filter(a=>a.submitted).length,
      allocatedSubmissions:items.filter(a=>a.submitted && !a.independent).length,independentSubmissions:items.filter(a=>a.submitted && a.independent).length,
      verified:items.filter(a=>a.submitted && a.verification).length,overdue:items.filter(a=>a.exceptions.includes('overdue')).length,
      actedOn:calls.filter(c=>c.quality==='confirmed'&&c.actedOn).length,untouched:calls.filter(c=>c.quality==='confirmed'&&!c.actedOn).length,
      matchedUnallocated:calls.filter(c=>c.matchedUnallocated).length,approachedUnallocated:calls.filter(c=>c.gaps.includes('APPROACHED_UNALLOCATED')).length,
      noNextAction:items.filter(a=>a.exceptions.includes('no-next-action')).length,
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
  const activityApps=scopedApps.filter(isActivity)
  const contributors = members.filter(m=>m.is_active&&!rows.some(r=>r.id===m.id)&&contacts.some(c=>c.actor_id===m.user_id&&external(c)))
    .map(m=>({id:m.id,name:m.user.name||m.user.email,userId:m.user_id,totals:summarize([])}))
  const weekly=weeklyMovement(events,filters.start,filters.end,members.map(m=>({id:m.id,name:m.user.name || m.user.email})),ids)
  const performance = [...rows,...contributors].map(member=>{
    const owned=schoolRows.filter(s=>s.ownerId===member.id).map(s=>s.id)
    const portfolio=scopedApps.filter(a=>owned.includes(a.school_id!));const periodApps=portfolio.filter(a=>inPeriod(a.firstSeen,filters.start,filters.end))
    const allocated=periodApps.filter(a=>!a.independent); const decisions=portfolio.filter(a=>['SANCTIONED','REJECTED'].includes(a.stage) && a.submitted)
    const completedActions=actions.filter(a=>a.owner_user_id===member.userId && inPeriod(a.completed_at,filters.start,filters.end))
    const allocationTimes=allocated.filter(a=>a.firstSeen).map(a=>(a.created_at.getTime()-a.firstSeen!.getTime())/day).filter(n=>n>=0)
    const firstContactTimes=allocated.filter(a=>a.contacts.some(external)).map(a=>(Math.min(...a.contacts.filter(external).map(c=>c.happened_at.getTime()))-a.created_at.getTime())/day).filter(n=>n>=0)
    const priorStart=new Date(filters.start.getTime()-(filters.end.getTime()-filters.start.getTime()))
    const money:Record<string,{requested:number;sanctioned:number}>={}
    for(const a of portfolio){money[a.currency]??={requested:0,sanctioned:0};money[a.currency].requested+=a.requested_amount || 0;if(a.stage==='SANCTIONED') money[a.currency].sanctioned+=a.sanctioned_amount || 0}
    return {id:member.id,name:member.name,workload:member.totals,
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
  const faculty=people.filter(p=>scopedApps.some(a=>a.faculty_id===p.id) || matches.some(m=>m.user_id===p.id)).map(p=>{
    const facultyMatches=matches.filter(m=>m.user_id===p.id && (!filters.callId || m.funding_call_id===filters.callId))
    const items=scopedApps.filter(a=>a.faculty_id===p.id)
    const approached=candidates.filter(c=>c.user_id===p.id && ['APPROACHED','ASSIGNED'].includes(c.status) && facultyMatches.some(m=>m.funding_call_id===c.funding_call_id))
    return {id:p.id,name:p.name || p.email,suitableOpportunities:facultyMatches.length,approached:approached.length,
      neverApproached:facultyMatches.filter(m=>!approached.some(c=>c.funding_call_id===m.funding_call_id) && !items.some(a=>a.call_id===m.funding_call_id)).length,
      allocations:items.filter(a=>!a.independent).length,active:items.filter(a=>a.outstanding).length,submitted:items.filter(a=>a.submitted).length,
      completeness:'Recorded matches only; see matching run completeness',schoolIds:[...new Set([...items.map(a=>a.school_id),...facultyMatches.map(m=>m.school_id)])]}
  })
  return {asOf:at,mode:filters.mode,period:{start:filters.start,end:filters.end},members:rows,totals:summarize(schoolRows),
    activity:{allocations:activityApps.filter(a=>a.assignment_id && inPeriod(a.created_at,filters.start,filters.end)).length,
      independent:activityApps.filter(a=>a.independent && inPeriod(a.created_at,filters.start,filters.end)).length,
      submissions:activityApps.filter(a=>inPeriod(a.submitted_at,filters.start,filters.end)).length,
      contacts:activityApps.reduce((n,a)=>n+a.contacts.filter(c=>external(c) && inPeriod(c.happened_at,filters.start,filters.end)).length,0)},
    performance,weekly,faculty,applications:apps,actions:actions.filter(a=>includedCalls.some(c=>c.schoolId===a.school_id&&c.id===a.call_id) || a.application_id&&includedIds.has(a.application_id)),
    quality:{unknownFirstSeen:scopedApps.filter(a=>!a.firstSeen).length,inferredMatches:matches.filter(m=>m.inferred).length,
      unknownStageDates:scopedApps.filter(a=>!a.stageEnteredAt).length,matchingComplete:schoolRows.every(s=>s.calls.every(c=>c.matchCompleteness==='COMPLETE')),
      incompleteMatchingOpportunities:includedCalls.filter(c=>c.quality==='confirmed'&&c.matchCompleteness!=='COMPLETE').length,
      historySince:events.find(e=>e.kind==='BASELINE')?.occurred_at || null},
    options:{members:rows.map(m=>({id:m.id,name:m.name})),schools:schools.map(s=>({id:s.id,name:s.name})),people:peopleMap.size?[...peopleMap.values()]:[]}}
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
