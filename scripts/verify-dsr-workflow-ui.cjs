// Local browser fixtures only. Every API is intercepted; no login, real data or notifications.
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
let browser,previewPage
async function main(){
  const base=new URL(process.env.DSR_PREVIEW_URL || 'http://127.0.0.1:3065')
  assert.ok(['127.0.0.1','localhost'].includes(base.hostname))
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[],requests=[]
  previewPage=page
  page.on('pageerror',e=>{errors.push(e.message);console.error('Preview runtime error:',e.message)})
  await page.addInitScript(()=>localStorage.setItem('auth_token',`fixture.${btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))}.fixture`))
  const options={schools:[{id:'school',name:'School of Biotechnology'}],members:[{id:'member-b',userId:'officer-b',name:'Current coordinator'}],deputySchools:0}
  const school={schoolId:'school',schoolName:'School of Biotechnology',sources:['INGESTION_DIRECT'],sourceLabels:['Direct discipline match'],coordinator:{id:'officer-b',name:'Current coordinator'},matchedFaculty:0,shortlisted:0,allocations:0,liveAllocations:0,submitted:0,followUps:0,triageStatus:null,actionStatus:'NOT_STARTED',completed:null}
  const incoming={callId:'call',title:'Biosensor funding call',agency:'Research Foundation',deadline:'2026-12-01',daysToDeadline:30,enteredAt:'2026-10-01',actionStatus:'NOT_STARTED',matchedFaculty:0,shortlisted:0,allocations:0,liveAllocations:0,submitted:0,schools:[school]}
  const missed={callId:'call',title:'Untouched biosensor call',agency:'Research Foundation',deadline:'2026-10-10',daysToDeadline:-13,school:{id:'school',name:'School of Biotechnology'},coordinator:{id:'officer-a',name:'Former coordinator'},state:'MISSED',workState:'NOT_REVIEWED',matchedFaculty:0,firstMatchedAt:'2026-09-01',daysUnallocated:39,releasedAllocations:0,escalated:[],lastActivityAt:null,completed:null}
  let retried=false
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());requests.push({path:url.pathname,params:Object.fromEntries(url.searchParams),method:req.method(),body:req.method()==='POST'?req.postDataJSON():null})
    let data={modules:[]}
    const common={asOf:'2026-10-23T12:00:00Z',lens:'department',options,viewerMemberId:'member-b',page:1,pageSize:25,portfolio:'primary'}
    if(url.pathname==='/api/v1/auth/whoami')data={user_id:'fixture-user',email:'fixture@example.test',tenant_id:'fixture-tenant',roles:['ADMIN'],ati_id:null}
    if(url.pathname==='/api/funding-dept/me')data={isMember:true,isHead:true,memberId:'member-b',schools:options.schools,reachSchools:options.schools,managedUnits:[],canAdminister:true,capabilities:{canAssign:true,canViewReports:true,isTenantWide:true}}
    if(url.pathname==='/api/funding-dept/reports/pendency')data={...common,rows:[missed,{...missed,callId:'allocated',title:'Allocated, no submission',workState:'ALLOCATED_NOT_SUBMITTED'}],total:2,members:[{coordinatorId:'officer-a',name:'Former coordinator',missed:2,atRisk:0,pending:0,completedNoAllocation:0,oldestDays:0,schools:[{id:'school',name:'School of Biotechnology',missed:2,atRisk:0,pending:0,completedNoAllocation:0}]}],summary:{missed:2,atRisk:0,pending:0,completedNoAllocation:0}}
    if(url.pathname==='/api/funding-dept/reports/incoming-calls')data={...common,rows:[incoming],total:1,summary:{openCalls:1,notStarted:1,closingSoonNotCompleted:0,completed:0},matchesRefreshedAt:'2026-10-23'}
    if(url.pathname.endsWith('/action-status'))data={completed:true}
    if(url.pathname==='/api/funding-dept/reports/overview')data={...common,totals:{callsEntered:10,callsMapped:10,reviewsPending:3,reviewedUnallocated:1,allocations:2,submissions:0,responsibilities:10},needsAttention:{overdueActions:0,reviewsOverdue:3,closingSoonUnallocated:1,missedNeverAllocated:3,missedAllocatedNotSubmitted:2,withoutCoordinator:0},schools:[{school_id:'school',school_name:'School of Biotechnology',coordinator_id:'officer-b',coordinator_name:'Current coordinator',responsibilities:10,reviews_pending:3,reviewed_unallocated:1,allocated:2,closed:0,submissions:0,missed:5}],unclassified:{total:0,overdue:0,overdueAfterDays:7},routingEnabled:true,windowLabel:'Current reporting period'}
    if(url.pathname==='/api/funding-dept/reports/register')data={...common,rows:[],total:0,totals:{calls:0,responsibilities:0,schools:0,allocations:0,allocatedSubmissions:0},windowLabel:'Current reporting period'}
    if(url.pathname==='/api/funding-dept/reports/mapping')data={...common,rows:[],total:0}
    if(url.pathname==='/api/funding-dept/routing'){
      if(req.method()==='POST'){retried=true;data={queued:true}}
      else data={summary:{pending:0,running:0,failed:retried?0:1},rows:retried?[]:[{callId:'routing-call',title:'Call awaiting school mapping',status:'FAILED',attempts:2,lastError:'Mapping failed. Retry routing.'}]}
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
  })
  const output=path.join(process.cwd(),'outputs','dsr-workflow');fs.mkdirSync(output,{recursive:true})
  await page.goto(new URL('/funding-dept/reports?tab=pendency',base).href,{waitUntil:'networkidle',timeout:120000})
  await page.getByText('Untouched biosensor call',{exact:true}).waitFor()
  await page.getByText('Allocated, no on-time submission',{exact:true}).waitFor()
  await page.getByRole('row').filter({hasText:'Former coordinator'}).getByRole('button',{name:'2',exact:true}).click()
  await page.waitForTimeout(150)
  assert.equal(requests.filter(r=>r.path.endsWith('/pendency')).at(-1).params.coordinatorId,'officer-a','retired owner drill uses recorded user ID')
  await page.screenshot({path:path.join(output,'pendency-desktop.png'),fullPage:true})
  await page.goto(new URL('/funding-dept/accountability?view=overview',base).href,{waitUntil:'networkidle',timeout:120000})
  await page.getByRole('row').filter({hasText:'School of Biotechnology'}).getByRole('button',{name:'5',exact:true}).click()
  await page.getByLabel(/^Needs attention/).waitFor()
  const drill=requests.filter(r=>r.path.endsWith('/register')).at(-1)
  assert.equal(drill.params.attention,'MISSED');assert.notEqual(drill.params.window,'all','school drill preserves selected period')
  await page.goto(new URL('/funding-dept/reports?tab=incoming',base).href,{waitUntil:'networkidle',timeout:120000})
  await page.getByRole('button',{name:'Mark completed',exact:true}).click()
  const form=page.locator('form').filter({has:page.getByLabel('What was done and the result')})
  assert.equal(await form.getByRole('button',{name:'Mark completed',exact:true}).isDisabled(),true)
  await page.getByLabel('What was done and the result').fill('Reviewed with the school; no suitable team available.')
  await page.getByLabel(/^Outcome/).selectOption('NO_SUITABLE_FACULTY')
  await form.getByRole('button',{name:'Mark completed',exact:true}).click()
  await page.waitForTimeout(150)
  const closure=requests.find(r=>r.path.endsWith('/action-status'))
  assert.equal(closure.body.outcome,'NO_SUITABLE_FACULTY');assert.ok(closure.body.note.length>0)
  await page.goto(new URL('/funding-dept/accountability?view=mapping',base).href,{waitUntil:'networkidle',timeout:120000})
  await page.getByText('Call awaiting school mapping',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Retry routing',exact:true}).click()
  await page.getByText('No pending routing jobs.',{exact:false}).waitFor()
  assert.equal(requests.find(r=>r.path.endsWith('/routing')&&r.method==='POST').body.callId,'routing-call')
  await page.screenshot({path:path.join(output,'routing-desktop.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.goto(new URL('/funding-dept/reports?tab=pendency',base).href,{waitUntil:'networkidle',timeout:120000})
  await page.getByText('Untouched biosensor call',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'mobile page should not overflow')
  await page.screenshot({path:path.join(output,'pendency-mobile.png'),fullPage:true})
  assert.deepEqual(errors,[])
  await browser.close();browser=null
  console.log('DSR browser fixtures passed: zero-match and allocated backlog, historical member drill, overview reconciliation, required closure reason/outcome, routing retry, mobile layout; no runtime errors.')
}
main().catch(async error=>{console.error(error);if(previewPage){console.error((await previewPage.locator('body').innerText()).slice(-3500));await previewPage.screenshot({path:path.join(process.cwd(),'outputs','dsr-workflow','ui-failure.png'),fullPage:true})}if(browser)await browser.close();process.exitCode=1})
