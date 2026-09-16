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
  isNext:z.boolean().optional(),status:z.enum(['OPEN','DONE']).optional(),version:z.number().int().positive().optional(),reason:z.string().trim().max(2000).optional(),
  disposition:z.enum(['NO_SUITABLE_FACULTY','DECLINED','CAPACITY','AWAITING_ACTION','RELEVANCE_UNRESOLVED','OTHER']).optional()})
export async function POST(request:NextRequest){
  const access=await managementAccess(request);if('response' in access)return access.response
  try{
    const input=body.parse(await request.json())
    if(!await schoolIsAccessible(access,input.schoolId))return NextResponse.json({error:'School not found.'},{status:404})
    const {tenantId,user}=access.context
    if(input.operation==='verify'){
      if(!input.applicationId||!input.reason)throw new ManagementError('Select an application and describe the evidence reviewed.')
      return NextResponse.json(await verifySubmission(tenantId,input.schoolId,input.applicationId,user.id,input.reason))
    }
    if(input.operation==='disposition'){
      if(!input.disposition||!input.callId||(input.disposition==='OTHER'&&!input.reason))throw new ManagementError('Select a no-uptake reason; explain Other.')
      await resolveTarget(tenantId,input.schoolId,null,input.callId)
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
