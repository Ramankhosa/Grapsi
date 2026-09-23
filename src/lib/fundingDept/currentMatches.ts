import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { findCallsInMyAreas } from '@/lib/funding/myAreasService'

// Coalesce simultaneous readers. Persisted projections are reused only while the
// profile, membership, publication and call input fingerprint is unchanged.
const running = new Map<string, Promise<{complete:boolean; unprofiled:string[]}>>()
const queued = new Set<string>()
const retryAfter = new Map<string,number>()
const refreshQueue:Array<{tenantId:string;schoolId:string}>=[]
let queueActive=false
const REPORT_FRESH_MS=5*60*1000

/** Report reads never wait for a full school census. One background worker
 * refreshes stale schools, keeping the department's database load bounded. */
export async function reportSchoolMatchStates(tenantId:string,schoolIds:string[]) {
  const state=new Map<string,{fresh:boolean;complete:boolean;unprofiled:string[]}>()
  if(!schoolIds.length)return state
  const rows=await prisma.$queryRaw<Array<{school_id:string;complete:boolean;unprofiled:string[];refreshed_at:Date}>>(Prisma.sql`
    SELECT school_id,complete,unprofiled,refreshed_at FROM dsr_match_projection_state
    WHERE tenant_id=${tenantId} AND school_id IN (${Prisma.join(schoolIds)})`)
  const stored=new Map(rows.map(row=>[row.school_id,row]))
  for(const schoolId of schoolIds){
    const row=stored.get(schoolId)
    const fresh=Boolean(row&&Date.now()-row.refreshed_at.getTime()<REPORT_FRESH_MS)
    state.set(schoolId,{fresh,complete:fresh&&Boolean(row?.complete),unprofiled:fresh?row?.unprofiled||[]:[]})
    if(!fresh)queueSchoolMatchRefresh(tenantId,schoolId)
  }
  return state
}

export function queueSchoolMatchRefresh(tenantId:string,schoolId:string) {
  const key=`${tenantId}:${schoolId}`
  if(queued.has(key)||running.has(key)||(retryAfter.get(key)||0)>Date.now())return
  queued.add(key)
  refreshQueue.push({tenantId,schoolId})
  // Let the requesting report finish before this worker starts expensive scans.
  if(!queueActive){queueActive=true;setTimeout(()=>{void drainRefreshQueue()},5000)}
}

async function drainRefreshQueue(){
  while(refreshQueue.length){
    const item=refreshQueue.shift()!,key=`${item.tenantId}:${item.schoolId}`
    try{await refreshCurrentSchoolMatches(item.tenantId,item.schoolId)}
    catch(error){retryAfter.set(key,Date.now()+60_000);console.error('DSR background matching refresh failed',{schoolId:item.schoolId,error})}
    finally{queued.delete(key)}
  }
  queueActive=false
}
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
  if(cached[0]){
    await prisma.$executeRaw(Prisma.sql`UPDATE dsr_match_projection_state SET refreshed_at=now() WHERE tenant_id=${tenantId} AND school_id=${schoolId} AND fingerprint=${fingerprint}`)
    return cached[0]
  }
  const profiles=await prisma.researcherProfile.findMany({where:{user:{tenantId,status:'ACTIVE'},org_unit:{tenant_id:tenantId,is_active:true,path:{has:schoolId}}},select:{user_id:true,org_unit_id:true}})
  const results:Array<{profile:typeof profiles[number]; result:Awaited<ReturnType<typeof findCallsInMyAreas>>}>=[]
  for(const profile of profiles){
    results.push({profile,result:await findCallsInMyAreas(profile.user_id,tenantId,{status:'all',complete:true})})
    // Share the database with live application traffic on the production VM.
    await new Promise(resolve=>setTimeout(resolve,125))
  }
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
    await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_match_projection_state(tenant_id,school_id,fingerprint,complete,unprofiled) VALUES(${tenantId},${schoolId},${fingerprint},${unprofiled.length===0},${JSON.stringify(unprofiled)}::jsonb) ON CONFLICT(tenant_id,school_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,complete=EXCLUDED.complete,unprofiled=EXCLUDED.unprofiled,refreshed_at=now()`)
  },{timeout:60000})
  return {complete:unprofiled.length===0,unprofiled}
}
