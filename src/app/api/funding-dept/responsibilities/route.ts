import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { managementAccess,schoolIsAccessible } from '@/lib/fundingDept/managementAccess'
import { isMemberAway } from '@/lib/fundingDept/shared'
export const dynamic='force-dynamic'
const schema=z.object({schoolId:z.string().min(1),memberId:z.string().min(1),callId:z.string().optional(),operation:z.enum(['PRIMARY','DEPUTY','TRANSFER']),reason:z.string().trim().min(3).max(2000)})
export async function POST(request:NextRequest){
  const access=await managementAccess(request);if('response' in access)return access.response
  if(!access.department)return NextResponse.json({error:'Department head access required.'},{status:403})
  try{
    const input=schema.parse(await request.json()),tenantId=access.context.tenantId
    if(!await schoolIsAccessible(access,input.schoolId))return NextResponse.json({error:'School not found.'},{status:404})
    const member=await prisma.fundingDeptMember.findFirst({where:{id:input.memberId,tenant_id:tenantId,is_active:true},include:{school_assignments:true}})
    if(!member)return NextResponse.json({error:'Choose an active DSR member.'},{status:400})
    if(input.operation==='TRANSFER'){
      if(isMemberAway(member))return NextResponse.json({error:'This member is away. Choose available cover.'},{status:400})
      if(!member.school_assignments.some(s=>s.org_unit_id===input.schoolId))return NextResponse.json({error:'Add this member as deputy for the school before transferring responsibility.'},{status:400})
      if(!input.callId||!await prisma.fundingCall.findFirst({where:{id:input.callId,OR:[{tenantId},{tenantId:null,visibility:'GLOBAL_PUBLISHED',status:'PUBLISHED'}]},select:{id:true}}))return NextResponse.json({error:'Call not found.'},{status:404})
    }
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT id FROM tenant_org_units WHERE tenant_id=${tenantId} AND id=${input.schoolId} FOR UPDATE`)
      let before:unknown
      if(input.operation==='TRANSFER'){
        before=await tx.$queryRaw(Prisma.sql`SELECT * FROM dsr_responsibility_transfers WHERE tenant_id=${tenantId} AND school_id=${input.schoolId} AND call_id=${input.callId!}`)
        await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_responsibility_transfers(tenant_id,school_id,call_id,owner_user_id,reason) VALUES(${tenantId},${input.schoolId},${input.callId!},${member.user_id},${input.reason}) ON CONFLICT(tenant_id,school_id,call_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,reason=EXCLUDED.reason,updated_at=now()`)
      }else{
        before=await tx.fundingDeptSchoolAssignment.findMany({where:{tenant_id:tenantId,org_unit_id:input.schoolId}})
        if(input.operation==='DEPUTY'&&(before as Array<{member_id:string;is_deputy:boolean}>).some(a=>a.member_id===member.id&&!a.is_deputy))throw new Error('This member is already the primary owner. Choose another deputy.')
        if(input.operation==='PRIMARY')await tx.fundingDeptSchoolAssignment.deleteMany({where:{tenant_id:tenantId,org_unit_id:input.schoolId,is_deputy:false,member_id:{not:member.id}}})
        await tx.fundingDeptSchoolAssignment.upsert({where:{tenant_id_org_unit_id_member_id:{tenant_id:tenantId,org_unit_id:input.schoolId,member_id:member.id}},create:{tenant_id:tenantId,org_unit_id:input.schoolId,member_id:member.id,is_deputy:input.operation==='DEPUTY',assigned_by_user_id:access.context.user.id},update:{is_deputy:input.operation==='DEPUTY',assigned_by_user_id:access.context.user.id}})
      }
      await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,actor_user_id,kind,before_data,after_data,reason) VALUES(${tenantId},${input.schoolId},'RESPONSIBILITY',${input.callId||input.schoolId},${access.context.user.id},${input.operation},${JSON.stringify(before)}::jsonb,${JSON.stringify({...input,ownerUserId:member.user_id})}::jsonb,${input.reason})`)
    })
    return NextResponse.json({saved:true})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not update responsibility.'},{status:400})}
}
