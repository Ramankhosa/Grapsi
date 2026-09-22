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
    if(schools.length)await tx.$executeRaw(Prisma.sql`UPDATE funding_opportunity_matches SET is_current=false,refreshed_at=${at}
      WHERE tenant_id=${input.tenantId} AND funding_call_id=${input.callId} AND school_id IN (${Prisma.join(schools)})`)
    for(const r of observed)await tx.$executeRaw(Prisma.sql`INSERT INTO funding_opportunity_matches(id,tenant_id,funding_call_id,user_id,org_unit_id,school_id,match_score,match_tier,match_reason,source,source_version,inferred,is_current,match_run_id,refreshed_at,first_seen_at,last_seen_at,created_at,updated_at)
      VALUES(${randomUUID()},${input.tenantId},${input.callId},${r.userId},${r.orgUnitId},${r.schoolId},${r.score},${r.matchTier},${r.matchReason},'matching',${version},false,true,${runId},${at},${at},${at},${at},${at})
      ON CONFLICT(tenant_id,funding_call_id,user_id,school_id) DO UPDATE SET match_score=EXCLUDED.match_score,match_tier=EXCLUDED.match_tier,
      match_reason=EXCLUDED.match_reason,source_version=EXCLUDED.source_version,is_current=true,match_run_id=EXCLUDED.match_run_id,
      refreshed_at=EXCLUDED.refreshed_at,last_seen_at=EXCLUDED.last_seen_at,updated_at=EXCLUDED.updated_at`)
  },{timeout:20000})
}
