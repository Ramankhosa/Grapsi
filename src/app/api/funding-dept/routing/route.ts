import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { managementAccess } from '@/lib/fundingDept/managementAccess'
import { visibleCallSql } from '@/lib/fundingDept/callSql'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { requestCallRouting, kickCallRouting } from '@/lib/fundingDept/callRoutingJobs'

export async function GET(request: NextRequest) {
  const access=await managementAccess(request)
  if ('response' in access) return access.response
  if (!access.department) return NextResponse.json({error:'Department head access required.'},{status:403})
  const rows=await prisma.$queryRaw<Array<{callId:string;title:string;status:string;attempts:number;lastError:string|null;updatedAt:Date}>>(Prisma.sql`
    SELECT j.call_id "callId",COALESCE(fc.scheme_title,fc.title) title,j.status,j.attempts,j.last_error "lastError",j.updated_at "updatedAt"
    FROM dsr_call_routing_jobs j JOIN funding_calls fc ON fc.id=j.call_id
    WHERE j.status<>'COMPLETED' AND ${visibleCallSql(access.context.tenantId)}
    ORDER BY CASE j.status WHEN 'FAILED' THEN 0 WHEN 'RUNNING' THEN 1 ELSE 2 END,j.updated_at LIMIT 20`)
  const [summary]=await prisma.$queryRaw<Array<{pending:number;running:number;failed:number}>>(Prisma.sql`
    SELECT count(*) FILTER(WHERE j.status='PENDING')::int pending,count(*) FILTER(WHERE j.status='RUNNING')::int running,count(*) FILTER(WHERE j.status='FAILED')::int failed
    FROM dsr_call_routing_jobs j JOIN funding_calls fc ON fc.id=j.call_id WHERE ${visibleCallSql(access.context.tenantId)}`)
  return NextResponse.json({rows,summary},{headers:{'Cache-Control':'private, no-store'}})
}

export async function POST(request: NextRequest) {
  const access=await managementAccess(request)
  if ('response' in access) return access.response
  if (!access.department) return NextResponse.json({error:'Department head access required.'},{status:403})
  const body=await request.json().catch(()=>null)
  if (!body || typeof body.callId!=='string' || !body.callId.trim()) return NextResponse.json({error:'Choose a call to retry.'},{status:400})
  const call=await prisma.fundingCall.findFirst({where:{AND:[{id:body.callId},visibleFundingCallWhere(access.context.tenantId)]},select:{id:true}})
  if (!call) return NextResponse.json({error:'Call not found.'},{status:404})
  await requestCallRouting(call.id)
  kickCallRouting(call.id)
  return NextResponse.json({queued:true})
}
