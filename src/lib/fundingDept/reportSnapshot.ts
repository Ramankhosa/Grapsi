import { createHash, randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import type { ManagementReport } from './managementService'
import { ManagementError } from './managementActions'

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function reportScopeKey(access:{department:boolean;deputy:boolean;schoolIds:readonly string[]|undefined}) {
  return hash([access.department,access.deputy,access.schoolIds?[...access.schoolIds].sort():null])
}
export function reportFilterKey(params:URLSearchParams,view:string){
  return hash(['responsibility-report-v3',view,[...params.entries()].filter(([k])=>!['snapshot','page','pageSize','format','level','drillSchoolId','drillCallId','drillMemberId'].includes(k)).sort(([a],[b])=>a.localeCompare(b))])
}
const dateKeys=new Set(['asOf','start','end','at','deadline','firstSeen','stageEnteredAt','historySince','created_at','updated_at','submitted_at','internal_deadline','review_deadline','agency_deadline','happened_at','due_at','completed_at','verified_at','occurred_at','first_seen_at','last_seen_at','acknowledged_at','lastEngagementAt','refreshed_at','lastActivityAt','firstTouchAt','away_from','away_until','enteredAt','dueAt','createdAt','lastActivity','closesAt'])
export function revive(value:unknown,key=''):any {
  if(typeof value==='string' && dateKeys.has(key) && /^\d{4}-\d{2}-\d{2}T/.test(value))return new Date(value)
  if(Array.isArray(value))return value.map(v=>revive(v))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,revive(v,k)]))
  return value
}
export async function readReportSnapshot(id:string,tenantId:string,userId:string,scopeKey:string,filterKey:string):Promise<ManagementReport>{
  const rows=await prisma.$queryRaw<Array<{payload:unknown}>>(Prisma.sql`SELECT payload FROM dsr_report_snapshots WHERE id=${id} AND tenant_id=${tenantId} AND user_id=${userId} AND scope_key=${scopeKey} AND filter_key=${filterKey} AND expires_at>now()`)
  if(!rows[0])throw new ManagementError('This report snapshot expired or access changed. Refresh the report.',409)
  return revive(rows[0].payload)
}
export async function writeReportSnapshot(tenantId:string,userId:string,scopeKey:string,filterKey:string,report:ManagementReport){
  const id=randomUUID()
  await prisma.$transaction([
    prisma.$executeRaw(Prisma.sql`DELETE FROM dsr_report_snapshots WHERE expires_at<now() AND tenant_id=${tenantId}`),
    prisma.$executeRaw(Prisma.sql`INSERT INTO dsr_report_snapshots(id,tenant_id,user_id,scope_key,filter_key,payload,expires_at) VALUES(${id},${tenantId},${userId},${scopeKey},${filterKey},${JSON.stringify(report)}::jsonb,${new Date(Date.now()+30*60000)})`),
  ])
  return id
}
