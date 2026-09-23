import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

/** Save the entire gated result set, not only the requested display page.
 * The search is top-k retrieval, not a census: even a successful run is PARTIAL.
 * Immutable runs preserve later evidence without overwriting the original match. */
export async function persistMatchingRun(input:{tenantId:string;callId:string;actorId?:string|null;orgUnitIds?:string[];filters:unknown;candidateCount:number;results:Array<{userId:string;score:number;matchTier:string;matchReason:string}>}) {
  const call=await prisma.fundingCall.findFirst({where:{id:input.callId,OR:[{tenantId:input.tenantId},{tenantId:null,visibility:'GLOBAL_PUBLISHED'}]},select:{id:true}})
  if(!call)return
  const units=await prisma.tenantOrgUnit.findMany({where:{tenant_id:input.tenantId},select:{id:true,path:true,depth:true}})
  const schools=[...new Set(input.orgUnitIds?.length?units.filter(u=>input.orgUnitIds!.includes(u.id)).map(u=>u.path[0]||u.id):units.filter(u=>u.depth===0).map(u=>u.id))]
  const people=await prisma.researcherProfile.findMany({where:{user_id:{in:input.results.map(r=>r.userId)},user:{tenantId:input.tenantId}},select:{user_id:true,org_unit_id:true}})
  const observed=input.results.flatMap(r=>{const p=people.find(p=>p.user_id===r.userId);const unit=units.find(u=>u.id===p?.org_unit_id);return p&&unit?[{...r,orgUnitId:unit.id,schoolId:unit.path[0]||unit.id}]:[]})
  const at=new Date();const version='researcher-search-gated-v2';const runId=randomUUID()
  await prisma.$transaction(async tx=>{
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_matching_runs(id,tenant_id,call_id,actor_user_id,scope,version,completeness,result_count,candidate_count,results,completed_at)
      VALUES(${runId},${input.tenantId},${input.callId},${input.actorId||null},${JSON.stringify({schoolIds:schools,filters:input.filters,method:'bounded-top-k'})}::jsonb,${version},'PARTIAL',${observed.length},${input.candidateCount},${JSON.stringify(observed)}::jsonb,${at})`)
    // Bounded/filtered searches are audit evidence only. They cannot replace a census.
  },{timeout:20000})
}
