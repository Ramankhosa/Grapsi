import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { applicationState, evidenceFingerprint, hasSubmissionEvidence, type ApplicationRow } from './managementRules'
import type { ActionRow } from './managementService'

export class ManagementError extends Error { constructor(message:string,public status=400){super(message)} }
export async function resolveTarget(tenantId:string,schoolId:string,applicationId?:string|null,callId?:string|null) {
  if(applicationId){
    const rows=await prisma.$queryRaw<ApplicationRow[]>(Prisma.sql`SELECT * FROM dsr_applications WHERE tenant_id=${tenantId} AND school_id=${schoolId} AND id=${applicationId}`)
    if(!rows[0])throw new ManagementError('Application not found.',404)
    return {applicationId:rows[0].id,callId:rows[0].call_id,application:rows[0]}
  }
  if(!callId)throw new ManagementError('Select a call or application.')
  const call=await prisma.fundingCall.findFirst({where:{id:callId,OR:[{tenantId},{tenantId:null,visibility:'GLOBAL_PUBLISHED',status:'PUBLISHED'}]},select:{id:true}})
  if(!call)throw new ManagementError('Call not found.',404)
  return {applicationId:null,callId:call.id,application:null}
}
export function validateActionChange(before: Pick<ActionRow,'owner_user_id'|'due_at'>,after:{ownerUserId?:string;dueAt?:string|null;reason?:string}) {
  const reassigned=after.ownerUserId!==undefined && after.ownerUserId!==before.owner_user_id
  const extended=after.dueAt!==undefined && before.due_at && (!after.dueAt || new Date(after.dueAt)>new Date(before.due_at))
  if((reassigned||extended)&&!after.reason?.trim())throw new ManagementError('Explain the reassignment or deadline extension.')
}
export async function saveAction(tenantId:string,schoolId:string,actorId:string,input:{id?:string;applicationId?:string|null;callId?:string|null;title?:string;ownerUserId?:string;waitingWith?:string;dueAt?:string|null;blocker?:string|null;deadlineType?:string;isNext?:boolean;status?:string;version?:number;reason?:string;resolutionNote?:string|null;category?:string;failureType?:string|null}) {
  return prisma.$transaction(async tx=>{
    // One lock per school prevents two concurrent requests from creating two next actions.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tenant_org_units WHERE id=${schoolId} AND tenant_id=${tenantId} FOR UPDATE`)
    const before=input.id?(await tx.$queryRaw<ActionRow[]>(Prisma.sql`SELECT * FROM dsr_actions WHERE id=${input.id} AND tenant_id=${tenantId} AND school_id=${schoolId} FOR UPDATE`))[0]:null
    if(input.id&&!before)throw new ManagementError('Action not found.',404)
    if(before && input.version!==before.version)throw new ManagementError('This action changed. Refresh and try again.',409)
    if(before)validateActionChange(before,input)
    const target=await resolveTarget(tenantId,schoolId,before?.application_id || input.applicationId,before?.call_id || input.callId)
    const owner=input.ownerUserId || before?.owner_user_id
    if(!owner || !await tx.user.findFirst({where:{id:owner,tenantId,status:'ACTIVE'},select:{id:true}}))throw new ManagementError('Choose an active owner in this organization.')
    const title=input.title ?? before?.title; const waiting=input.waitingWith ?? before?.waiting_with
    if(!title?.trim()||!waiting)throw new ManagementError('Confirm the next action and who it is waiting with.')
    if(waiting==='AGENCY'&&!await tx.fundingDeptMember.findFirst({where:{tenant_id:tenantId,user_id:owner,is_active:true},select:{id:true}}))throw new ManagementError('Agency waiting needs an active DSR officer responsible for the next follow-up.')
    const status=input.status || before?.status || 'OPEN';const isOpen=['OPEN','ACKNOWLEDGED'].includes(status);const isNext=isOpen&&(input.isNext ?? before?.is_next ?? true)
    if(['DONE','CANCELLED'].includes(status)&&!input.resolutionNote?.trim()&&!before?.resolution_note)throw new ManagementError('Record a resolution note before closing or cancelling an action.')
    const due=input.dueAt===undefined?before?.due_at || null:input.dueAt?new Date(input.dueAt):null
    if(isOpen&&!due)throw new ManagementError('An open action needs a due date so it can be followed up.')
    if(due&&!Number.isFinite(due.getTime()))throw new ManagementError('Invalid action due date.')
    const id=before?.id || randomUUID()
    const category=input.category||before?.category||'ROUTINE'
    const failureType=input.failureType??before?.failure_type??null
    if(category==='CORRECTIVE'&&!failureType)throw new ManagementError('Choose the failure type for the corrective action.')
    if(isNext){
      const displaced=await tx.$queryRaw<ActionRow[]>(Prisma.sql`SELECT * FROM dsr_actions WHERE tenant_id=${tenantId} AND school_id=${schoolId}
        AND application_id IS NOT DISTINCT FROM ${target.applicationId} AND call_id IS NOT DISTINCT FROM ${target.callId} AND is_next AND status IN ('OPEN','ACKNOWLEDGED') AND id<>${id}`)
      for(const prior of displaced){
        await tx.$executeRaw(Prisma.sql`UPDATE dsr_actions SET is_next=false,version=version+1,updated_at=now() WHERE id=${prior.id}`)
        await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,actor_user_id,kind,before_data,after_data)
          VALUES(${tenantId},${schoolId},'ACTION',${prior.id},${actorId},'NEXT_ACTION_CHANGED',${JSON.stringify(prior)}::jsonb,${JSON.stringify({...prior,is_next:false,version:prior.version+1})}::jsonb)`)
      }
    }
    const rows=await tx.$queryRaw<ActionRow[]>(Prisma.sql`INSERT INTO dsr_actions(id,tenant_id,school_id,call_id,application_id,title,owner_user_id,waiting_with,due_at,blocker,deadline_type,is_next,status,created_by_user_id,completed_at,acknowledged_at,acknowledged_by_user_id,resolution_note)
      VALUES(${id},${tenantId},${schoolId},${target.callId},${target.applicationId},${title.trim()},${owner},${waiting},${due},${input.blocker ?? before?.blocker ?? null},${input.deadlineType || before?.deadline_type || 'ACTION'},${isNext},${status},${actorId},${['DONE','CANCELLED'].includes(status)?new Date():null},${status==='ACKNOWLEDGED'?new Date():before?.acknowledged_at||null},${status==='ACKNOWLEDGED'?actorId:before?.acknowledged_by_user_id||null},${isOpen?null:input.resolutionNote ?? before?.resolution_note ?? null})
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,owner_user_id=EXCLUDED.owner_user_id,waiting_with=EXCLUDED.waiting_with,
      due_at=EXCLUDED.due_at,blocker=EXCLUDED.blocker,deadline_type=EXCLUDED.deadline_type,is_next=EXCLUDED.is_next,status=EXCLUDED.status,
      completed_at=CASE WHEN EXCLUDED.status IN ('DONE','CANCELLED') THEN COALESCE(dsr_actions.completed_at,now()) ELSE NULL END,
      acknowledged_at=CASE WHEN EXCLUDED.status='ACKNOWLEDGED' THEN COALESCE(dsr_actions.acknowledged_at,now()) WHEN EXCLUDED.status='OPEN' THEN NULL ELSE dsr_actions.acknowledged_at END,
      acknowledged_by_user_id=CASE WHEN EXCLUDED.status='ACKNOWLEDGED' THEN COALESCE(dsr_actions.acknowledged_by_user_id,EXCLUDED.acknowledged_by_user_id) WHEN EXCLUDED.status='OPEN' THEN NULL ELSE dsr_actions.acknowledged_by_user_id END,
      resolution_note=EXCLUDED.resolution_note,updated_at=now(),version=dsr_actions.version+1 RETURNING *`)
    await tx.$executeRaw(Prisma.sql`UPDATE dsr_actions SET category=${category},failure_type=${failureType} WHERE id=${id}`)
    rows[0].category=category;rows[0].failure_type=failureType
    const kind=!before?'CREATED':before.status!==status?(status==='DONE'?'COMPLETED':status==='CANCELLED'?'CANCELLED':status==='ACKNOWLEDGED'?'ACKNOWLEDGED':'REOPENED'):before.owner_user_id!==owner?'REASSIGNED':'UPDATED'
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,actor_user_id,kind,before_data,after_data,reason)
      VALUES(${tenantId},${schoolId},'ACTION',${id},${actorId},${kind},${before?JSON.stringify(before):null}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason || null})`)
    return rows[0]
  })
}
export async function verifySubmission(tenantId:string,schoolId:string,applicationId:string,actorId:string,note:string) {
  return prisma.$transaction(async tx=>{
    const target=await resolveTarget(tenantId,schoolId,applicationId)
    const row=target.application!
    // Lock the canonical source; status/evidence updates cannot race verification.
    if(row.assignment_id)await tx.$queryRaw(Prisma.sql`SELECT id FROM call_assignments WHERE id=${row.assignment_id} FOR UPDATE`)
    if(row.proposal_id)await tx.$queryRaw(Prisma.sql`SELECT id FROM grant_proposals WHERE id=${row.proposal_id} FOR UPDATE`)
    const fresh=(await tx.$queryRaw<ApplicationRow[]>(Prisma.sql`SELECT * FROM dsr_applications WHERE id=${applicationId} AND tenant_id=${tenantId}`))[0]
    const docs=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM assignment_documents WHERE assignment_id=${row.assignment_id} AND kind='PROPOSAL' AND tenant_id=${tenantId}
      UNION ALL SELECT id FROM grant_proposal_documents WHERE proposal_id=${row.proposal_id} AND kind='SUBMISSION_PROOF' AND tenant_id=${tenantId}`)
    if(!applicationState(fresh).submitted || !hasSubmissionEvidence(fresh,docs.map(d=>d.id)))throw new ManagementError('Record a submission and supporting reference, portal record or submission document first. Notes alone cannot be verified.')
    const fingerprint=evidenceFingerprint(fresh,docs.map(d=>d.id))
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_submission_verifications(tenant_id,application_id,evidence_fingerprint,reviewer_user_id,evidence_note)
      VALUES(${tenantId},${applicationId},${fingerprint},${actorId},${note}) ON CONFLICT(tenant_id,application_id)
      DO UPDATE SET evidence_fingerprint=EXCLUDED.evidence_fingerprint,reviewer_user_id=EXCLUDED.reviewer_user_id,evidence_note=EXCLUDED.evidence_note,verified_at=now()`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,actor_user_id,kind,reason,after_data)
      VALUES(${tenantId},${schoolId},'VERIFICATION',${applicationId},${actorId},'VERIFIED',${note},${JSON.stringify({fingerprint})}::jsonb)`)
    return {verified:true}
  })
}
