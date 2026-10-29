import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/prisma',async()=>{const {testPrisma}=await import('../helpers/monitorTestPrisma');return {prisma:testPrisma,default:testPrisma}})
import {testPrisma as db,resetMonitorTables} from '../helpers/monitorTestPrisma'
import {queueCandidates,triageCandidates} from '@/lib/monitor/candidates'
import {claimNextTask} from '@/lib/monitor/queue'
import {claimSharedWork,releaseSharedWork,SharedWorkPendingError} from '@/lib/monitor/sharedWork'
import {extractOpportunity} from '@/lib/monitor/extract'
import type {SafeFetch} from '@/lib/monitor/safeFetch'
const P=require('../../../../tools/local-worker/policy.cjs')
beforeEach(async()=>{await resetMonitorTables()})
afterEach(()=>{delete process.env.MONITOR_LOCAL_SCREENING_REQUIRED;delete process.env.MONITOR_EXTRACTION_ENABLED;delete process.env.MONITOR_LOCAL_AUDIT_EVERY})
afterAll(async()=>{await resetMonitorTables();await db.$disconnect()})
const title='Alpha Research Grant 2026'
const facts='Alpha Foundation invites applications for this research grant. University research projects are supported. Applications close on 30 November 2026.'
const html=`<main><h1>${title}</h1><p>${facts}</p></main>`
const fetch:SafeFetch=async url=>({requestedUrl:url,finalUrl:url,status:200,headers:{},body:Buffer.from(html),byteLength:html.length,truncated:false,contentKind:'html',contentType:'text/html',notModified:false,redirects:[],tlsExceptionUsed:false})
async function fixture(){const site=await db.monitorSite.create({data:{host:'resilience.invalid',min_delay_ms:0}});const r=await db.monitorResource.create({data:{site_id:site.id,dedup_key:'https://resilience.invalid/call',canonical_url:'https://resilience.invalid/call',title}});return {site,r}}
async function run(siteId:string,id:string,version:string,paid:ReturnType<typeof vi.fn>,pageFetch:SafeFetch=fetch){await queueCandidates(db,siteId,[id],false,version);const lease=await claimNextTask({owner:'resilience-test',kinds:['TRIAGE']});await triageCandidates(lease!,{fetch:pageFetch,paid});return lease!}
async function localResult(job:any,details:Record<string,unknown>,decision='CALL'){const worker=await db.monitorLocalWorker.create({data:{id:crypto.randomUUID(),display_name:'fixture',app_version:'1.1.0',model_sha256:P.MODEL.sha256}});await db.monitorLocalAnalysisResult.create({data:{job_id:job.id,resource_id:job.resource_id,version_id:job.version_id,worker_id:worker.id,input_hash:job.input_hash,policy_hash:P.POLICY_HASH,model_sha256:P.MODEL.sha256,decision,elapsed_ms:1,details:{schemaVersion:2,candidates:[],multipleCalls:false,needsMoreEvidence:false,warnings:[],...details}}})}
const paidFor=(id:string,verdict='NEW_OPPORTUNITY')=>vi.fn(async()=>({text:JSON.stringify({items:[{id,verdict,confidence:0.95,reason:'Fixture',type:'grant'}]}),model:'fixture',actualMicros:1n,attemptId:'fixture',attemptNo:1}))
describe('conservative cost and recovery rules',()=>{
 it('keeps a multi-call listing for evidence review and queues only observed approved call documents',async()=>{
  const {site,r}=await fixture();process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';const paid=paidFor(r.id)
  const body='<main><h1>Research funding calls</h1><a href="https://resilience.invalid/alpha-call.pdf">Alpha research grant</a><a href="https://related.invalid/beta-call.pdf">Beta research grant</a></main>'
  const listing:SafeFetch=async url=>({...await fetch(url,{}),body:Buffer.from(body),byteLength:body.length})
  await run(site.id,r.id,'listing-first',paid,listing);await localResult(await db.monitorLocalAnalysisJob.findFirstOrThrow(),{multipleCalls:true})
  await run(site.id,r.id,'listing-local',paid,listing)
  expect(paid).not.toHaveBeenCalled();expect(await db.monitorOpportunity.count()).toBe(1);expect((await db.monitorOpportunity.findFirstOrThrow()).processing_state).toBe('NEEDS_EVIDENCE')
  expect(await db.monitorResource.count({where:{canonical_url:'https://resilience.invalid/alpha-call.pdf'}})).toBe(1);expect(await db.monitorResource.count({where:{canonical_url:'https://related.invalid/beta-call.pdf'}})).toBe(0);expect(await db.monitorCoverageGap.count({where:{kind:'HOST_APPROVAL'}})).toBe(1)
 })
 it('does not hide an application date change on a last-updated line',async()=>{
  const {site,r}=await fixture();process.env.MONITOR_EXTRACTION_ENABLED='true';await db.fundingCall.create({data:{title,source_url:r.canonical_url,normalized_text:title+'\n'+facts+'\nLast updated: deadline 30 November 2026',catalog_status:'PUBLISHED',visibility:'GLOBAL_PUBLISHED',createdByUserId:'monitor-test',updatedByUserId:'monitor-test'}})
  const body=html.replace('</main>','<p>Last updated: deadline 31 December 2026</p></main>');const updated:SafeFetch=async url=>({...await fetch(url,{}),body:Buffer.from(body),byteLength:body.length});const paid=paidFor(r.id);await run(site.id,r.id,'updated-line',paid,updated)
  expect(paid).not.toHaveBeenCalled();expect((await db.monitorOpportunity.findFirstOrThrow()).review_state).toBe('UPDATE_PROPOSED');expect(await db.monitorTask.count({where:{kind:'EXTRACT'}})).toBe(1)
 })
 it('avoids all paid work when a grounded title identifies unchanged evidence behind a generic heading',async()=>{
  const {site,r}=await fixture();await db.monitorResource.update({where:{id:r.id},data:{title:'Application information'}});await db.fundingCall.create({data:{title,source_url:r.canonical_url,normalized_text:title+'\n'+facts,catalog_status:'PUBLISHED',visibility:'GLOBAL_PUBLISHED',createdByUserId:'monitor-test',updatedByUserId:'monitor-test'}})
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';const paid=paidFor(r.id);await run(site.id,r.id,'generic-first',paid);await localResult(await db.monitorLocalAnalysisJob.findFirstOrThrow(),{candidates:[{title,titleQuote:title,invitationQuote:null}]});await run(site.id,r.id,'generic-local',paid)
  expect(paid).not.toHaveBeenCalled();expect((await db.monitorOpportunity.findFirstOrThrow()).processing_state).toBe('DONE');expect(await db.monitorTask.count({where:{kind:'EXTRACT'}})).toBe(0)
 })
 it('retains observed funding dependencies until their related host is approved',async()=>{
  const {site}=await fixture();const {addFrontier}=await import('@/lib/monitor/discovery')
  const link={url:'https://related.invalid/grant-2026',title:'Apply for research funding'}
  await addFrontier(db,site,[link]);expect(await db.monitorCoverageGap.findFirstOrThrow()).toMatchObject({kind:'HOST_APPROVAL',state:'OPEN'});expect(await db.monitorCrawlFrontier.count()).toBe(0)
  await addFrontier(db,{...site,related_hosts:['related.invalid']},[link]);expect((await db.monitorCoverageGap.findFirstOrThrow()).state).toBe('RESOLVED');expect(await db.monitorCrawlFrontier.count()).toBe(1)
 })
 it('holds differing official references for review even on the same URL and title',async()=>{
  const {r}=await fixture();await db.fundingCall.create({data:{title,source_url:r.canonical_url,visibility:'GLOBAL_PUBLISHED',metadata:{source_watch_identity:{reference:'REF-A',round:'2026'}},createdByUserId:'monitor-test',updatedByUserId:'monitor-test'}})
  const {matchCatalog}=await import('@/lib/monitor/matching');expect((await matchCatalog(r.canonical_url!,title,null,db,'2026',[],'REF-B')).type).toBe('AMBIGUOUS')
 })
 it('does not purchase screening or extraction for unchanged complete published evidence',async()=>{
  const {site,r}=await fixture();await db.fundingCall.create({data:{title,source_url:r.canonical_url,normalized_text:title+'\n'+facts,catalog_status:'PUBLISHED',visibility:'GLOBAL_PUBLISHED',createdByUserId:'monitor-test',updatedByUserId:'monitor-test'}})
  process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';const paid=paidFor(r.id);await run(site.id,r.id,'unchanged',paid)
  expect(paid).not.toHaveBeenCalled();expect(await db.monitorLocalAnalysisJob.count()).toBe(0);expect((await db.monitorOpportunity.findFirstOrThrow()).processing_state).toBe('DONE')
 })
 it('routes changed evidence on a matching official URL to an update without paid screening',async()=>{
  const {site,r}=await fixture();await db.fundingCall.create({data:{title,source_url:r.canonical_url,normalized_text:'Previous call evidence',catalog_status:'PUBLISHED',visibility:'GLOBAL_PUBLISHED',createdByUserId:'monitor-test',updatedByUserId:'monitor-test'}})
  process.env.MONITOR_EXTRACTION_ENABLED='true';const paid=paidFor(r.id);await run(site.id,r.id,'changed',paid)
  expect(paid).not.toHaveBeenCalled();expect((await db.monitorOpportunity.findFirstOrThrow()).review_state).toBe('UPDATE_PROPOSED');expect(await db.monitorTask.count({where:{kind:'EXTRACT'}})).toBe(1)
 })
 it('does not suppress a new annual round on a reused official URL',async()=>{
  const {site,r}=await fixture();await db.fundingCall.create({data:{title:'Alpha Research Grant 2025',source_url:r.canonical_url,visibility:'GLOBAL_PUBLISHED',createdByUserId:'monitor-test',updatedByUserId:'monitor-test'}})
  const paid=paidFor(r.id);await run(site.id,r.id,'new-round',paid);expect(paid).toHaveBeenCalledTimes(1);expect((await db.monitorOpportunity.findFirstOrThrow()).match_type).toBe('NEW_ROUND_OF')
 })
 it('holds new paid work while the laptop is unavailable without spending task attempts',async()=>{
  const {site,r}=await fixture();process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';const paid=paidFor(r.id);const lease=await run(site.id,r.id,'offline',paid)
  expect(paid).not.toHaveBeenCalled();expect(await db.monitorLocalAnalysisJob.count()).toBe(1);expect(await db.monitorTask.findUniqueOrThrow({where:{id:lease.taskId}})).toMatchObject({status:'QUEUED',attempts:0})
 })
 // 29 Oct 2026: only laptop CALL/RELATED pages reach paid screening; a 1-in-N sample of GENERAL/UNSURE still does.
 it('keeps a sampled local GENERAL page eligible for cloud review',async()=>{
  process.env.MONITOR_LOCAL_AUDIT_EVERY='1'
  const {site,r}=await fixture();process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';const paid=paidFor(r.id,'UNSURE');await run(site.id,r.id,'first',paid)
  await localResult(await db.monitorLocalAnalysisJob.findFirstOrThrow(),{candidates:[],needsMoreEvidence:true},'GENERAL')
  await run(site.id,r.id,'after-local',paid);expect(paid).toHaveBeenCalledTimes(1);expect((await db.monitorOpportunity.findFirstOrThrow()).review_state).toBe('PENDING')
  expect(await db.monitorAuditSample.count({where:{stage:'LOCAL',sampled_outcome:'GENERAL'}})).toBe(1)
 })
 it.each([
  ['GENERAL','NOT_FUNDING','TRIAGED','NONE'],
  ['UNSURE','NEEDS_EVIDENCE','NEEDS_EVIDENCE','PENDING'],
 ])('routes an unsampled local %s page without paid screening',async(decision,verdict,state,review)=>{
  process.env.MONITOR_LOCAL_AUDIT_EVERY='0'
  const {site,r}=await fixture();process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';const paid=paidFor(r.id);await run(site.id,r.id,'first',paid)
  await localResult(await db.monitorLocalAnalysisJob.findFirstOrThrow(),{candidates:[],needsMoreEvidence:decision==='UNSURE'},decision)
  await run(site.id,r.id,'after-local',paid);expect(paid).not.toHaveBeenCalled()
  const o=await db.monitorOpportunity.findFirstOrThrow()
  expect(o).toMatchObject({triage_verdict:verdict,processing_state:state,review_state:review})
  expect((o.decision_versions as {model?:string}).model).toBe('local-first-pass')
  expect(await db.monitorTask.count({where:{kind:'EXTRACT'}})).toBe(0)
 })
 it.each(['CALL','RELATED'])('still sends a local %s page to paid screening',async(decision)=>{
  process.env.MONITOR_LOCAL_AUDIT_EVERY='0'
  const {site,r}=await fixture();process.env.MONITOR_LOCAL_SCREENING_REQUIRED='true';const paid=paidFor(r.id);await run(site.id,r.id,'first',paid)
  await localResult(await db.monitorLocalAnalysisJob.findFirstOrThrow(),{candidates:[{title,titleQuote:title,invitationQuote:'invites applications'}]},decision)
  await run(site.id,r.id,'after-local',paid);expect(paid).toHaveBeenCalledTimes(1)
  expect((await db.monitorOpportunity.findFirstOrThrow()).triage_verdict).toBe('NEW_OPPORTUNITY')
 })
 it('shares extraction work and recovers an expired claim without releasing another owner',async()=>{
  await claimSharedWork('same-input','first');await expect(claimSharedWork('same-input','second')).rejects.toBeInstanceOf(SharedWorkPendingError)
  await releaseSharedWork('same-input','other');expect(await db.monitorProcessingClaim.count()).toBe(1)
  await db.monitorProcessingClaim.update({where:{input_key:'same-input'},data:{lease_until:new Date(0)}});await claimSharedWork('same-input','second');await releaseSharedWork('same-input','first');expect((await db.monitorProcessingClaim.findFirstOrThrow()).owner).toBe('second')
 })
 it('stores an empty extraction as needing evidence, with no draft handoff',async()=>{
  const {site,r}=await fixture();const opportunity=await db.monitorOpportunity.create({data:{site_id:site.id,primary_resource_id:r.id,review_state:'PENDING'}})
  const {enqueueTask}=await import('@/lib/monitor/queue');await enqueueTask(db,{kind:'EXTRACT',operationKey:'empty',siteId:site.id,payload:{opportunityId:opportunity.id,reviewRevision:0,draft:true}});const lease=await claimNextTask({owner:'fixture',kinds:['EXTRACT']})
  await extractOpportunity(lease!,{fetch,paid:async()=>({text:'{"fields":{}}',model:'fixture',actualMicros:1n,attemptId:'fixture',attemptNo:1})})
  const saved=await db.monitorOpportunity.findUniqueOrThrow({where:{id:opportunity.id}});expect(saved.processing_state).toBe('NEEDS_EVIDENCE');expect((saved.field_evidence as any).quality.state).toBe('INSUFFICIENT');expect(await db.monitorHandoff.count()).toBe(0)
 })
})
