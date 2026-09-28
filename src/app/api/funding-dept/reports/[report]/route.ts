import { NextRequest,NextResponse } from 'next/server'
import { managementReportHandler } from '@/lib/fundingDept/managementHandler'
import { MAPPING_REPORTS, registerReportHandler } from '@/lib/fundingDept/registerHandler'
import { HUB_REPORTS, hubReportHandler } from '@/lib/fundingDept/hubHandler'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest,{params}:{params:{report:string}}){
  if((HUB_REPORTS as readonly string[]).includes(params.report))return hubReportHandler(request,params.report as (typeof HUB_REPORTS)[number])
  if((MAPPING_REPORTS as readonly string[]).includes(params.report))return registerReportHandler(request,params.report as (typeof MAPPING_REPORTS)[number])
  if(!['workbench','incoming','corrective-actions','pending','deadline-risk','school-coverage','opportunity-gaps','performance','weekly-review','coverage','outcomes'].includes(params.report))return NextResponse.json({error:'Report not found.'},{status:404})
  return managementReportHandler(request,params.report)
}
