import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { findCallsInMyAreas } from '@/lib/funding/myAreasService'

// Coalesce simultaneous readers. Persisted projections are reused only while the
// profile, membership, publication and call input fingerprint is unchanged.
const running = new Map<string, Promise<{complete:boolean; unprofiled:string[]}>>()
export function refreshCurrentSchoolMatches(tenantId:string, schoolId:string) {
  const key=`${tenantId}:${schoolId}`
  const prior=running.get(key)
  if(prior)return prior
  const task=refresh(tenantId,schoolId).finally(()=>running.delete(key))
  running.set(key,task)
  return task
}

async function inputFingerprint(tenantId:string,schoolId:string){
  const rows=await prisma.$queryRaw<Array<{fingerprint:string}>>(Prisma.sql`SELECT md5(concat_ws('|','person-call-census-v2',
    (SELECT string_agg(concat_ws(':',id,"updatedAt",xmin::text)::text,',' ORDER BY id) FROM funding_calls WHERE "tenantId"=${tenantId} OR ("tenantId" IS NULL AND visibility='GLOBAL_PUBLISHED')),
    (SELECT string_agg(concat_ws(':',u.id,u."updatedAt",p.updated_at,p.org_unit_id,u.status,u.xmin::text,p.xmin::text)::text,',' ORDER BY u.id) FROM users u LEFT JOIN researcher_profiles p ON p.user_id=u.id WHERE u."tenantId"=${tenantId}),
    (SELECT string_agg(concat_ws(':',a.id,a.updated_at,a.xmin::text)::text,',' ORDER BY a.id) FROM researcher_saved_research_areas a JOIN users u ON u.id=a.user_id WHERE u."tenantId"=${tenantId}),
    (SELECT string_agg(concat_ws(':',r.id,r."updatedAt",r.xmin::text)::text,',' ORDER BY r.id) FROM reference_library r JOIN users u ON u.id=r.user_id WHERE u."tenantId"=${tenantId}),
    (SELECT string_agg(concat_ws(':',id,updated_at,xmin::text)::text,',' ORDER BY id) FROM tenant_org_units WHERE tenant_id=${tenantId}),${schoolId},${process.env.RESEARCHER_MATCH_MIN_SIMILARITY||''},${process.env.EMBEDDING_PROVIDER||'gemini'},${process.env.VOYAGE_OUTPUT_DIMENSIONS||'1024'},${process.env.GOOGLE_EMBEDDINGS_DIMENSIONS||'768'}
  )) fingerprint`)
  return rows[0].fingerprint
}

async function refresh(tenantId:string,schoolId:string) {
  const fingerprint=await inputFingerprint(tenantId,schoolId)
  const cached=await prisma.$queryRaw<Array<{complete:boolean;unprofiled:string[]}>>(Prisma.sql`SELECT complete,unprofiled FROM dsr_match_projection_state WHERE tenant_id=${tenantId} AND school_id=${schoolId} AND fingerprint=${fingerprint}`)
  if(cached[0])return cached[0]
  const profiles=await prisma.researcherProfile.findMany({where:{user:{tenantId,status:'ACTIVE'},org_unit:{tenant_id:tenantId,is_active:true,path:{has:schoolId}}},select:{user_id:true,org_unit_id:true}})
  const results:Array<{profile:typeof profiles[number]; result:Awaited<ReturnType<typeof findCallsInMyAreas>>}>=[]
  let cursor=0
  await Promise.all(Array.from({length:Math.min(3,profiles.length)},async()=>{
    while(cursor<profiles.length){const profile=profiles[cursor++];results.push({profile,result:await findCallsInMyAreas(profile.user_id,tenantId,{status:'all',complete:true})})}
  }))
  const unprofiled=results.filter(r=>r.result.readiness.isUnprofiled).map(r=>r.profile.user_id)
  const at=new Date(), runId=randomUUID()
  const rows=results.flatMap(({profile,result})=>result.calls.map(call=>({id:randomUUID(),userId:profile.user_id,unitId:profile.org_unit_id,callId:call.id,score:call.score,tier:call.tier,reason:`${call.source}${call.matchedOn?`: ${call.matchedOn}`:''}`})))
  if(await inputFingerprint(tenantId,schoolId)!==fingerprint)throw new Error('Matching inputs changed during refresh. Refresh the report to evaluate the updated profiles.')
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tenant_org_units WHERE id=${schoolId} AND tenant_id=${tenantId} FOR UPDATE`)
    await tx.$executeRaw(Prisma.sql`UPDATE funding_opportunity_matches SET is_current=false WHERE tenant_id=${tenantId} AND school_id=${schoolId}`)
    // One bulk write; zero results deliberately deactivates all old matches.
    if(rows.length)await tx.$executeRaw(Prisma.sql`INSERT INTO funding_opportunity_matches(id,tenant_id,funding_call_id,user_id,org_unit_id,school_id,match_score,match_tier,match_reason,source,source_version,inferred,is_current,match_run_id,refreshed_at,first_seen_at,last_seen_at,created_at,updated_at)
      SELECT r.id,${tenantId},r."callId",r."userId",r."unitId",${schoolId},r.score,r.tier,r.reason,'matching','person-call-census-v1',false,true,${runId},${at},${at},${at},${at},${at}
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id text,"callId" text,"userId" text,"unitId" text,score double precision,tier text,reason text)
      ON CONFLICT(tenant_id,funding_call_id,user_id,school_id) DO UPDATE SET org_unit_id=EXCLUDED.org_unit_id,match_score=EXCLUDED.match_score,match_tier=EXCLUDED.match_tier,match_reason=EXCLUDED.match_reason,source=EXCLUDED.source,source_version=EXCLUDED.source_version,inferred=false,is_current=true,match_run_id=EXCLUDED.match_run_id,refreshed_at=EXCLUDED.refreshed_at,last_seen_at=EXCLUDED.last_seen_at,updated_at=EXCLUDED.updated_at`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_matching_runs(id,tenant_id,call_id,scope,version,completeness,result_count,candidate_count,results,completed_at)
      SELECT gen_random_uuid()::text,${tenantId},fc.id,${JSON.stringify({schoolIds:[schoolId],method:'complete-person-call-census',unprofiled})}::jsonb,'person-call-census-v1',${unprofiled.length?'PARTIAL':'COMPLETE'},
      (SELECT count(*) FROM funding_opportunity_matches m WHERE m.tenant_id=${tenantId} AND m.school_id=${schoolId} AND m.funding_call_id=fc.id AND m.is_current),${profiles.length},'[]'::jsonb,${at}
      FROM funding_calls fc WHERE fc."tenantId"=${tenantId} OR (fc."tenantId" IS NULL AND fc.visibility='GLOBAL_PUBLISHED' AND fc.status='PUBLISHED')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_match_projection_state(tenant_id,school_id,fingerprint,complete,unprofiled) VALUES(${tenantId},${schoolId},${fingerprint},${unprofiled.length===0},${JSON.stringify(unprofiled)}::jsonb) ON CONFLICT(tenant_id,school_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,complete=EXCLUDED.complete,unprofiled=EXCLUDED.unprofiled,refreshed_at=now()`)
  },{timeout:60000})
  return {complete:unprofiled.length===0,unprofiled}
}
