import { NextRequest,NextResponse } from 'next/server'
import { managementReportHandler } from '@/lib/fundingDept/managementHandler'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest,{params}:{params:{report:string}}){
  if(!['pending','deadline-risk','performance','weekly-review','coverage','outcomes'].includes(params.report))return NextResponse.json({error:'Report not found.'},{status:404})
  return managementReportHandler(request,params.report)
}
