import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/prisma',async()=>{const {testPrisma}=await import('../helpers/monitorTestPrisma');return {prisma:testPrisma,default:testPrisma}})
import {resetMonitorTables,testPrisma as db} from '../helpers/monitorTestPrisma'
import {queueCandidates,triageCandidates} from '@/lib/monitor/candidates'
import {claimNextTask} from '@/lib/monitor/queue'
import {localSuggestion} from '@/lib/monitor/localAnalysis'
import type {SafeFetch} from '@/lib/monitor/safeFetch'

beforeEach(async()=>{await resetMonitorTables()})
afterEach(()=>{delete process.env.MONITOR_LOCAL_SCREENING_REQUIRED})
afterAll(async()=>{await resetMonitorTables();await db.$disconnect()})
const body='<main><h1>Foundation research news</h1><p>The foundation celebrated its research alumni at an annual reception. This article reports the celebration and thanks past supporters.</p></main>'
function transport(html=body,truncated=false):SafeFetch{return async url=>({requestedUrl:url,finalUrl:url,status:200,headers:{etag:'"fixture"'},body:Buffer.from(html),byteLength:Buffer.byteLength(html),truncated,contentKind:'html',contentType:'text/html',notModified:false,redirects:[],tlsExceptionUsed:false})}
async function fixture(){const site=await db.monitorSite.create({data:{host:'negative.invalid',min_delay_ms:0}});const resource=await db.monitorResource.create({data:{site_id:site.id,dedup_key:'https://negative.invalid/news',canonical_url:'https://negative.invalid/news',title:'Foundation research news'}});return {site,resource}}
function paidFor(id:string,verdict='NOT_FUNDING',confidence=0.95){return vi.fn(async()=>({text:JSON.stringify({items:[{id,verdict,confidence,reason:'Alumni celebration; no funding opportunity',type:'news'}]}),model:'fixture',actualMicros:1n,attemptId:'fixture',attemptNo:1}))}
async function run(siteId:string,resourceId:string,key:string,paid:ReturnType<typeof paidFor>,fetch=transport()){await queueCandidates(db,siteId,[resourceId],false,key);const lease=await claimNextTask({owner:'negative-test',kinds:['TRIAGE']});expect(lease).not.toBeNull();await triageCandidates(lease!,{fetch,paid});return lease!}
async function generalResult(){
 const P=require('../../../../tools/local-worker/policy.cjs'),job=await db.monitorLocalAnalysisJob.findFirstOrThrow()
 const worker=await db.monitorLocalWorker.create({data:{id:crypto.randomUUID(),display_name:'Fixture',app_version:P.APP_VERSION,model_sha256:P.MODEL.sha256}})
 await db.monitorLocalAnalysisResult.create({data:{job_id:job.id,resource_id:job.resource_id,version_id:job.version_id,worker_id:worker.id,input_hash:job.input_hash,policy_hash:P.POLICY_HASH,model_sha256:P.MODEL.sha256,decision:'GENERAL',elapsed_ms:1,details:{schemaVersion:2,candidates:[],multipleCalls:false,needsMoreEvidence:false,warnings:[]}}})
 return job
}

describe('unchanged non-funding pages',()=>{
 it('reuses the original local GENERAL hypothesis across identical full text and still runs cloud screening',async()=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id,'UNSURE');process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true'
  await run(site.id,resource.id,'first',paid);const job=await generalResult()
  await run(site.id,resource.id,'raw-churn',paid,transport('<nav>New counter</nav>'+body))
  expect(await db.monitorLocalAnalysisJob.count()).toBe(1);expect((await localSuggestion(resource.id,db))?.resultId).toBe(job.id)
  expect(paid).toHaveBeenCalledTimes(1);expect((await db.monitorOpportunity.findFirstOrThrow()).triage_verdict).toBe('UNSURE')
 })
 it.each(['title','truncated'])('does not reuse a local GENERAL result after %s changes its original input',async(kind)=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id);process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true'
  await run(site.id,resource.id,'first',paid);await generalResult()
  if(kind==='title')await db.monitorResource.update({where:{id:resource.id},data:{title:'Applications for the research grant'}})
  await run(site.id,resource.id,'new-input',paid,transport('<nav>New counter</nav>'+body,kind==='truncated'))
  expect(await db.monitorLocalAnalysisJob.count()).toBe(2);expect(await localSuggestion(resource.id,db)).toBeNull();expect(paid).not.toHaveBeenCalled()
 })
 it('skips local and paid inference after raw HTML churn while refreshing source checks',async()=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id)
  await run(site.id,resource.id,'first',paid)
  const prior=await db.monitorOpportunity.findFirstOrThrow(),oldVersion=(await db.monitorResource.findUniqueOrThrow({where:{id:resource.id}})).current_version_id
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true'
  await run(site.id,resource.id,'raw-churn',paid,transport('<nav>Changed navigation and counter</nav>'+body))
  const current=await db.monitorResource.findUniqueOrThrow({where:{id:resource.id}}),result=await db.monitorOpportunity.findFirstOrThrow()
  expect(current.current_version_id).not.toBe(oldVersion);expect(current.last_validated_at).not.toBeNull()
  expect(paid).toHaveBeenCalledTimes(1);expect(await db.monitorLocalAnalysisJob.count()).toBe(0)
  expect(result.review_revision).toBe(prior.review_revision);expect(result.review_state).toBe('NONE');expect(result.triage_reason).toContain('Unchanged page')
  expect((await db.monitorStageCache.findFirstOrThrow({where:{stage:'TRIAGE_NEGATIVE'}})).hit_count).toBe(1)
 })
 it('reuses a negative after a real conditional HTTP 304 response',async()=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id);await run(site.id,resource.id,'first',paid)
  const notModified:SafeFetch=async(url,options)=>{expect(options?.headers?.['if-none-match']).toBe('"fixture"');return {...await transport()(url,options),status:304,body:Buffer.alloc(0),byteLength:0,notModified:true}}
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';await run(site.id,resource.id,'304',paid,notModified)
  expect(paid).toHaveBeenCalledTimes(1);expect(await db.monitorLocalAnalysisJob.count()).toBe(0)
  expect((await db.monitorResource.findUniqueOrThrow({where:{id:resource.id}})).last_validation_status).toBe('NOT_MODIFIED')
 })
 it('queues local analysis again when a funding invitation is added',async()=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id);await run(site.id,resource.id,'first',paid)
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true'
  await run(site.id,resource.id,'new-call',paid,transport(body.replace('</main>','<p>Applications are now invited for our 2026 research grant. Apply by 30 November 2026.</p></main>')))
  expect(await db.monitorLocalAnalysisJob.count()).toBe(1);expect(paid).toHaveBeenCalledTimes(1)
  expect((await db.monitorOpportunity.findFirstOrThrow()).triage_reason).toContain('Waiting for laptop')
 })
 it('retains a new official call link for discovery and invalidates the old assessment',async()=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id);await run(site.id,resource.id,'first',paid)
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true'
  await run(site.id,resource.id,'new-link',paid,transport(body.replace('</main>','<a href="/grant-2026">Apply for the research grant</a></main>')))
  expect(await db.monitorLocalAnalysisJob.count()).toBe(1)
  expect(await db.monitorCrawlFrontier.count({where:{url:'https://negative.invalid/grant-2026'}})).toBe(1)
 })
 it.each([['UNSURE',0.95],['NEEDS_EVIDENCE',0.95],['NOT_FUNDING',0.7]] as const)('does not suppress local investigation after %s at confidence %s',async(verdict,confidence)=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id,verdict,confidence);await run(site.id,resource.id,'first',paid)
  expect(await db.monitorStageCache.count({where:{stage:'TRIAGE_NEGATIVE'}})).toBe(0)
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';await run(site.id,resource.id,'raw-change',paid,transport('<nav>Counter changed</nav>'+body))
  expect(await db.monitorLocalAnalysisJob.count()).toBe(1)
 })
 it.each(['truncated','long','document'])('does not retain a suppressing result for %s evidence',async(kind)=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id)
  const html=kind==='long'?body.replace('</main>',`<p>${'Research news from our alumni. '.repeat(200)}</p></main>`):kind==='document'?body.replace('</main>','<a href="/call.pdf">Call document</a></main>'):body
  await run(site.id,resource.id,'incomplete',paid,transport(html,kind==='truncated'))
  expect(await db.monitorStageCache.count({where:{stage:'TRIAGE_NEGATIVE'}})).toBe(0)
  expect((await db.monitorOpportunity.findFirstOrThrow()).triage_verdict).toBe('NEEDS_EVIDENCE')
 })
 it('invalidates reuse when classification settings change',async()=>{
  const {site,resource}=await fixture(),paid=paidFor(resource.id);await run(site.id,resource.id,'first',paid)
  await db.monitorSite.update({where:{id:site.id},data:{language_profile:['en','hi']}})
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';await run(site.id,resource.id,'policy-change',paid,transport('<nav>Counter</nav>'+body))
  expect(await db.monitorLocalAnalysisJob.count()).toBe(1)
 })
})
