import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { managementAccess,schoolIsAccessible } from '@/lib/fundingDept/managementAccess'
import { ManagementError,saveAction,verifySubmission,resolveTarget } from '@/lib/fundingDept/managementActions'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic='force-dynamic'
const body=z.object({schoolId:z.string().min(1),operation:z.enum(['action','verify','disposition']).default('action'),
  id:z.string().optional(),applicationId:z.string().nullable().optional(),callId:z.string().nullable().optional(),
  title:z.string().trim().min(1).max(1000).optional(),ownerUserId:z.string().optional(),
  waitingWith:z.enum(['FACULTY','DSR','REVIEWER','APPROVER','AGENCY']).optional(),dueAt:z.string().datetime().nullable().optional(),
  blocker:z.string().max(2000).nullable().optional(),deadlineType:z.enum(['ACTION','AGENCY','INTERNAL_REVIEW','REVISION']).optional(),
  isNext:z.boolean().optional(),status:z.enum(['OPEN','ACKNOWLEDGED','DONE','CANCELLED']).optional(),version:z.number().int().positive().optional(),reason:z.string().trim().max(2000).optional(),
  resolutionNote:z.string().trim().max(2000).nullable().optional(),
  category:z.enum(['ROUTINE','CORRECTIVE']).optional(),failureType:z.string().trim().min(1).max(100).nullable().optional(),
  disposition:z.enum(['NO_SUITABLE_FACULTY','DECLINED','CAPACITY','AWAITING_ACTION','RELEVANCE_UNRESOLVED','OTHER']).optional()})
export async function POST(request:NextRequest){
  const access=await managementAccess(request);if('response' in access)return access.response
  try{
    const input=body.parse(await request.json())
    if(!await schoolIsAccessible(access,input.schoolId))return NextResponse.json({error:'School not found.'},{status:404})
    if(input.category==='CORRECTIVE'&&!access.department&&!input.id)return NextResponse.json({error:'Only the department head can create a corrective action.'},{status:403})
    const {tenantId,user}=access.context
    if(!access.department&&(input.category!==undefined||input.failureType!==undefined)){
      const previous=input.id?(await prisma.$queryRaw<Array<{category:string;failure_type:string|null}>>(Prisma.sql`SELECT category,failure_type FROM dsr_actions WHERE id=${input.id} AND tenant_id=${tenantId} AND school_id=${input.schoolId}`))[0]:null
      if((input.category==='CORRECTIVE'&&!previous)||(previous&&((input.category!==undefined&&input.category!==previous.category)||(input.failureType!==undefined&&input.failureType!==previous.failure_type))))return NextResponse.json({error:'Only the department head can change corrective-action classification.'},{status:403})
    }
    if(input.operation==='verify'){
      if(!input.applicationId||!input.reason)throw new ManagementError('Select an application and describe the evidence reviewed.')
      return NextResponse.json(await verifySubmission(tenantId,input.schoolId,input.applicationId,user.id,input.reason))
    }
    if(input.operation==='disposition'){
      if(!input.disposition||!input.callId||(input.disposition==='OTHER'&&!input.reason))throw new ManagementError('Select a no-uptake reason; explain Other.')
      await resolveTarget(tenantId,input.schoolId,null,input.callId)
      if(['AWAITING_ACTION','RELEVANCE_UNRESOLVED'].includes(input.disposition)){
        const open=await prisma.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM dsr_actions WHERE tenant_id=${tenantId} AND school_id=${input.schoolId} AND call_id=${input.callId} AND status IN ('OPEN','ACKNOWLEDGED') AND due_at IS NOT NULL LIMIT 1`)
        if(!open.length)throw new ManagementError('Create a named, dated follow-up before recording an unresolved reason.')
      }
      await prisma.$transaction(async tx=>{
        const prior=await tx.$queryRaw(Prisma.sql`SELECT * FROM dsr_opportunity_dispositions WHERE tenant_id=${tenantId} AND school_id=${input.schoolId} AND call_id=${input.callId}`)
        await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_opportunity_dispositions(tenant_id,school_id,call_id,reason,explanation,actor_user_id)
          VALUES(${tenantId},${input.schoolId},${input.callId},${input.disposition},${input.reason || null},${user.id})
          ON CONFLICT(tenant_id,school_id,call_id) DO UPDATE SET reason=EXCLUDED.reason,explanation=EXCLUDED.explanation,actor_user_id=EXCLUDED.actor_user_id,updated_at=now()`)
        await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,actor_user_id,kind,before_data,after_data,reason)
          VALUES(${tenantId},${input.schoolId},'DISPOSITION',${input.callId},${user.id},'UPDATED',${JSON.stringify(prior)}::jsonb,${JSON.stringify(input)}::jsonb,${input.reason || null})`)
      })
      return NextResponse.json({saved:true})
    }
    return NextResponse.json({action:await saveAction(tenantId,input.schoolId,user.id,input)})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not save action.'},{status:error instanceof ManagementError?error.status:error instanceof z.ZodError?400:500})}
}
