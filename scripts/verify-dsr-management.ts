/** Isolated tenant fixtures in a disposable local database. No mailers, notifications or AI calls. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma } from '../src/lib/prisma-generated'
import { withDisposableDb } from './lib/disposableDb'

async function main(){
  await withDisposableDb(async ({ db: prisma }) => {
  const { getManagementReport } = await import('../src/lib/fundingDept/managementService')
  const { saveAction, verifySubmission } = await import('../src/lib/fundingDept/managementActions')
  const { exportTables, managementExport } = await import('../src/lib/fundingDept/managementExport')
  const { readReportSnapshot, writeReportSnapshot } = await import('../src/lib/fundingDept/reportSnapshot')
  const id=`dsr-test-${randomUUID()}`;let checks=0
  const ok=(value:unknown,message:string)=>{assert(value,message);checks++;console.log(`PASS ${message}`)}
  await prisma.tenant.create({data:{id,name:'DSR isolated verification',atiId:id}})
  const now=new Date();const old=new Date(now.getTime()-60*86400000);const submitted=new Date(now.getTime()-86400000)
  {
    const users=await Promise.all(['primary','deputy','faculty'].map(name=>prisma.user.create({data:{tenantId:id,email:`${name}-${id}@example.invalid`,name,roles:['MANAGER']}})))
    const [primary,deputy,faculty]=users
    const [school,uncovered]=await Promise.all(['Covered','Uncovered'].map(name=>prisma.tenantOrgUnit.create({data:{tenant_id:id,name,kind:'SCHOOL'}})))
    const [member,backup]=await Promise.all([primary,deputy].map(u=>prisma.fundingDeptMember.create({data:{tenant_id:id,user_id:u.id}})))
    const coverage=await prisma.fundingDeptSchoolAssignment.create({data:{tenant_id:id,member_id:member.id,org_unit_id:school.id,assigned_by_user_id:primary.id}})
    await prisma.fundingDeptSchoolAssignment.create({data:{tenant_id:id,member_id:backup.id,org_unit_id:school.id,is_deputy:true,assigned_by_user_id:primary.id}})
    const call=await prisma.fundingCall.create({data:{tenantId:id,createdByUserId:primary.id,updatedByUserId:primary.id,title:'Fixture funding opportunity',visibility:'TENANT_PRIVATE',status:'PUBLISHED',deadlineAt:new Date(now.getTime()-86400000),createdAt:old}})
    for(const s of [school,uncovered])await prisma.callSchoolTriage.create({data:{tenant_id:id,org_unit_id:s.id,funding_call_id:call.id,status:'RELEVANT',created_at:old,decided_at:old}})
    const allocations:Array<{id:string}>=[]
    // Enough complete children to exceed a page. Unique faculty per formal allocation.
    for(let i=0;i<25;i++){
      const f=i?await prisma.user.create({data:{tenantId:id,email:`faculty-${i}-${id}@example.invalid`,name:`Faculty ${i}`}}):faculty
      allocations.push(await prisma.callAssignment.create({data:{tenant_id:id,funding_call_id:call.id,assignee_user_id:f.id,assigned_by_user_id:deputy.id,assignee_org_unit_id:school.id,status:'IN_PROGRESS',created_at:old}}))
    }
    const proposal=await prisma.grantProposal.create({data:{tenant_id:id,assignment_id:allocations[0].id,funding_call_id:call.id,pi_user_id:faculty.id,org_unit_id:school.id,title:'Linked submission',agency_name:'Fixture agency',created_by_user_id:deputy.id,status:'REJECTED',submitted_at:submitted,submission_reference:'ACK-001',created_at:old}})
    await prisma.grantProposal.create({data:{tenant_id:id,pi_user_id:faculty.id,org_unit_id:uncovered.id,title:'Ad-hoc independent',agency_name:'Independent agency',created_by_user_id:primary.id,status:'SUBMITTED',submitted_at:submitted,created_at:old}})
    for(const [kind,target] of [['CALL','FACULTY'],['EMAIL','FACULTY'],['NOTE','INTERNAL'],['CALL','AGENCY']])await prisma.assignmentFollowUp.create({data:{tenant_id:id,assignment_id:allocations[1].id,kind,contact_target:target,note:'Fixture contact',created_by_user_id:deputy.id,happened_at:submitted}})
    const run=(extra:Record<string,unknown>={})=>getManagementReport(id,{start:new Date(now.getTime()-90*86400000),end:new Date(Date.now()+1),asOf:new Date(),mode:'cohort',includeExpired:true,...extra})
    let report=await run()
    ok(report.totals.allocated===25 && report.totals.independent===1 && report.totals.applications===26,'Linked assignment and proposal count once; independent application remains separate')
    ok(report.totals.submitted===2 && report.totals.allocatedSubmissions===1,'Rejected after submission retains submission history')
    ok(report.totals.followedUp===1 && report.totals.contactEvents===2,'Two faculty contacts count as one followed-up allocation; agency and notes excluded')
    ok(report.totals.callSchoolOpportunities===2 && report.totals.distinctCalls===1,'Distinct department calls and call-school opportunities are separate')
    ok(report.members.length===2 && report.members.some(m=>m.id==='unassigned'),'Deputy does not duplicate ownership; uncovered school remains visible')
    ok((await run({schoolId:uncovered.id})).members[0].id==='unassigned','Filtering an uncovered school preserves its unassigned owner')
    ok((await run({schoolIds:[school.id]})).totals.independent===0,'School-scoped data cannot include another portfolio')
    ok(report.members.reduce((n,m)=>n+m.totals.applications,0)===26 && report.members.flatMap(m=>m.schools.flatMap(s=>s.calls)).reduce((n,c)=>n+c.childCount,0)===26,'Member, school and call application totals reconcile')
    const pending=await run({mode:'pending',start:new Date(now.getTime()-30*86400000)})
    ok(pending.totals.allocated===24 && pending.totals.independent===1,'Pending now keeps old work and excludes resolved rejection')
    ok((await run({start:new Date(now.getTime()-30*86400000)})).totals.applications===0,'New cohort excludes opportunities first surfaced before the period')
    const activity=await run({mode:'activity',start:new Date(now.getTime()-30*86400000)})
    ok(activity.activity.submissions===2 && activity.activity.allocations===0,'Period activity uses actual submission and allocation dates')
    ok(pending.applications.find(a=>a.id===`assignment:${allocations[1].id}`)?.overdue.agency,'Drafting work retains an independent overdue flag')
    await prisma.researcherProfile.create({data:{user_id:faculty.id,org_unit_id:school.id,display_name:'faculty'}})
    const gapCall=await prisma.fundingCall.create({data:{tenantId:id,createdByUserId:primary.id,updatedByUserId:primary.id,title:'Matched but unallocated',visibility:'TENANT_PRIVATE',status:'PUBLISHED',deadlineAt:new Date(now.getTime()+14*86400000),createdAt:now}})
    await prisma.callSchoolTriage.create({data:{tenant_id:id,org_unit_id:school.id,funding_call_id:gapCall.id,status:'RELEVANT',created_at:now}})
    await prisma.fundingOpportunityMatch.create({data:{tenant_id:id,funding_call_id:gapCall.id,user_id:faculty.id,org_unit_id:school.id,school_id:school.id,match_score:0.91,match_tier:'STRONG',match_reason:'Fixture research alignment',source:'fixture',source_version:'v1',first_seen_at:now,last_seen_at:now}})
    // A match routes only while its school's projection is fresh (20260922 workbench change).
    await prisma.$executeRaw(Prisma.sql`INSERT INTO dsr_match_projection_state(tenant_id,school_id,fingerprint,complete,unprofiled) VALUES(${id},${school.id},'fixture',true,'[]'::jsonb) ON CONFLICT(tenant_id,school_id) DO UPDATE SET refreshed_at=now()`)
    let coverageReport=await run({mode:'portfolio'})
    let gap=coverageReport.members.flatMap(m=>m.schools.flatMap(s=>s.calls)).find(c=>c.id===gapCall.id)!
    ok(gap.matchedUnallocated && gap.actionState==='UNTOUCHED' && gap.matches[0]?.allocationStatus==='PENDING_ALLOCATION','Automated match exposes pending researcher allocation without counting as human action')
    await saveAction(id,school.id,primary.id,{callId:gapCall.id,title:'Contact matched researcher',ownerUserId:primary.id,waitingWith:'DSR',dueAt:new Date(Date.now()+86400000).toISOString()})
    coverageReport=await run({mode:'portfolio'});gap=coverageReport.members.flatMap(m=>m.schools.flatMap(s=>s.calls)).find(c=>c.id===gapCall.id)!
    ok(gap.actedOn && gap.touchSignals.includes('NAMED_ACTION') && coverageReport.totals.actedOn+coverageReport.totals.untouched===coverageReport.totals.callSchoolOpportunities,'Mapped-call action coverage reconciles and records named intervention')
    const appId=`assignment:${allocations[1].id}`
    const action=await saveAction(id,school.id,primary.id,{applicationId:appId,title:'Prepare draft',ownerUserId:faculty.id,waitingWith:'FACULTY',dueAt:new Date(Date.now()+86400000).toISOString()})
    await assert.rejects(()=>saveAction(id,school.id,primary.id,{id:action.id,version:action.version,ownerUserId:primary.id}),/Explain/)
    const moved=await saveAction(id,school.id,primary.id,{id:action.id,version:action.version,ownerUserId:primary.id,reason:'Department coordinating review'})
    const done=await saveAction(id,school.id,primary.id,{id:action.id,version:moved.version,status:'DONE',resolutionNote:'Draft received'})
    await saveAction(id,school.id,primary.id,{id:action.id,version:done.version,status:'OPEN',reason:'Further changes requested'})
    ok((await prisma.$queryRaw<Array<{kind:string}>>(Prisma.sql`SELECT kind FROM dsr_events WHERE tenant_id=${id} AND entity_id=${action.id}`)).length===4,'Action creation, transfer, completion and reopening preserve history')
    const notesOnly=(await run()).applications.find(a=>a.independent)!
    await assert.rejects(()=>verifySubmission(id,uncovered.id,notesOnly.id,primary.id,'Reviewed note'),/Notes alone/)
    await verifySubmission(id,school.id,`assignment:${allocations[0].id}`,primary.id,'Checked agency acknowledgement ACK-001')
    ok((await run()).totals.verified===1,'Evidence-backed verification is separate; notes-only submission cannot be verified')
    await prisma.grantProposal.update({where:{id:proposal.id},data:{submission_reference:'CORRECTED'}})
    ok((await run()).totals.verified===0,'Evidence correction invalidates stale verification')
    await prisma.callSchoolTriage.updateMany({where:{tenant_id:id,org_unit_id:school.id},data:{status:'NOT_RELEVANT'}})
    report=await run()
    const covered=report.members.flatMap(m=>m.schools).find(s=>s.id===school.id)!
    const childRows=report.members.flatMap(m=>m.schools.flatMap(s=>s.calls)).filter(c=>!c.id.startsWith('adhoc:'))
    ok(covered.calls.every(c=>c.quality==='dismissed') && report.totals.applications===26 && report.totals.callSchoolOpportunities===childRows.length,'Manual irrelevance agrees between summary and children without deleting applications')
    const snapshot=await writeReportSnapshot(id,primary.id,'scope','filters',report)
    const frozen=await readReportSnapshot(snapshot,id,primary.id,'scope','filters')
    await assert.rejects(()=>readReportSnapshot(snapshot,id,deputy.id,'scope','filters'),/expired or access/)
    ok(frozen.totals.applications===report.totals.applications && frozen.asOf instanceof Date,'Snapshot preserves totals and date types; another user cannot fetch it')
    const all=frozen.members.flatMap(m=>m.schools.flatMap(s=>s.calls.flatMap(c=>c.applications)))
    const pages=[...all.slice(0,20),...all.slice(20,40)]
    ok(new Set(pages.map(a=>a.id)).size===26,'Pagination-sized children have no duplicate or missing application identities')
    const tables=exportTables(frozen)
    ok(tables.find(t=>t.name==='Applications')!.rows.filter(r=>String(r[6]||'').startsWith('assignment:')||String(r[6]||'').startsWith('proposal:')).length===26 && managementExport(frozen,'xlsx').length>0,'Full export contains all filtered applications beyond one page')
    ok(!report.weekly.complete && report.applications.every(a=>a.stageEnteredAt),'History before instrumentation is incomplete; newly recorded stage entries have dates')
    await prisma.fundingDeptSchoolAssignment.deleteMany({where:{tenant_id:id,member_id:backup.id,is_deputy:true}})
    await prisma.fundingDeptSchoolAssignment.update({where:{id:coverage.id},data:{member_id:backup.id}})
    report=await run()
    ok(!report.members.some(m=>m.id===member.id) && report.members.some(m=>m.id===backup.id),'Current primary ownership moves while deputy-authored activity remains recorded')
    console.log(`Verified ${checks} DSR integration assertions.`)
  }
  })
}
main().catch(error=>{console.error(error);process.exitCode=1})
