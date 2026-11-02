// Synthetic local browser checks only: every API is intercepted; no real records or notifications.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.FUNDING_UX_PREVIEW_URL || 'http://127.0.0.1:3072'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
const output = path.join(process.cwd(),'outputs','funding-workspace-20261031')
fs.mkdirSync(output,{recursive:true})
let browser, page
async function main() {
  browser = await chromium.launch({headless:true})
  const context = await browser.newContext({viewport:{width:1440,height:1080}})
  page = await context.newPage()
  const errors = [], requests = []
  let failScope = false, verified = false
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.addInitScript(() => localStorage.setItem('auth_token',`fixture.${btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))}.fixture`))
  const options = { schools:[{id:'school',name:'School of Biotechnology'},{id:'school-two',name:'School of Engineering'}],members:[{id:'member',userId:'officer',name:'Dr. Asha Sharma'}],deputySchools:0 }
  const common = {asOf:'2026-10-31T12:00:00Z',snapshot:'fixture-snapshot',periodLabel:'Current portfolio · institution time',lens:'department',portfolio:'primary',options,viewerMemberId:'member',page:1,pageSize:25}
  const opportunity = {id:'call',agencyName:'Science and Engineering Research Board',schemeTitle:'Translational research for sustainable water systems',shortDescription:'Support for interdisciplinary teams developing affordable water treatment and monitoring technologies with measurable community impact.',closeDate:'2026-11-10T00:00:00Z',isRolling:false,amountMin:2500000,amountMax:5000000,currency:'INR',eligibleCountries:['India'],eligibleRegions:[],hostCountries:[],fundingKinds:['Research grant'],careerStages:['Established researcher'],institutionTypes:['University'],disciplines:['Environmental science'],officialUrls:['https://example.test/call'],isCatalog:true,authoringReady:true,eligibilityVerdict:null,profileMatch:null,limitedSubmissions:false}
  const project = {id:'project',sourceKey:'CSIR',sourceName:'CSIR',fundingAgency:'Council of Scientific & Industrial Research',sourceUrl:null,detailUrl:null,title:'Low-cost biosensors for real-time water quality assessment',abstractText:'An interdisciplinary research programme combining biosensor design and field validation to support safe drinking water in rural communities.',executiveSummary:null,primaryInstitutionName:'Institute of Environmental Research',schemeName:'Research and Development',programName:null,sanctionYear:2025,state:'Punjab',budgetAmount:4500000,budgetCurrency:'INR',discipline:'Environmental science',areaName:null,keywords:[],semanticSimilarity:.87,textRank:.2,relevanceScore:.89}
  const allocation = {id:'allocation',applicationId:'assignment:allocation',status:'IN_PROGRESS',outcome:'PENDING',createdAt:'2026-10-05T00:00:00Z',respondedAt:'2026-10-06T00:00:00Z',declinedReason:null,call:{id:'call',title:opportunity.schemeTitle,agency:'Research Foundation',deadline:'2026-11-10',daysToDeadline:10},internalDeadline:'2026-11-05',daysToDue:5,overdue:false,faculty:{id:'faculty',name:'Dr. Meera Kapoor',email:'fixture@example.test'},school:{id:'school',name:'School of Biotechnology'},assignedBy:{id:'officer',name:'Dr. Asha Sharma'},allocationMethod:'AUTO',followUps:2,facultyContacts:0,lastFacultyContactAt:null,lastFollowUp:{at:'2026-10-29',kind:'NOTE',by:'Dr. Asha Sharma',note:'Waiting for the revised research plan.'},daysSinceFollowUp:2,nextReminderAt:null,submittedAt:null,completedAt:null,submissionReference:null,submissionUrl:null,evidence:null,lapsedAt:null,passedOnTo:null,passedOnFrom:null,verified:false}
  const pending = {callId:'call',title:opportunity.schemeTitle,agency:'Research Foundation',deadline:'2026-11-10',daysToDeadline:10,school:{id:'school',name:'School of Biotechnology'},coordinator:{id:'officer',name:'Dr. Asha Sharma'},state:'AT_RISK',workState:'ALLOCATED_NOT_SUBMITTED',matchedFaculty:4,firstMatchedAt:'2026-10-05',daysUnallocated:26,daysInStage:4,releasedAllocations:0,escalated:[],lastActivityAt:'2026-10-29',completed:null,nextAction:{title:'Confirm the revised research plan',owner:'Dr. Asha Sharma',dueAt:'2026-11-02',waitingWith:'FACULTY',blocker:'Awaiting the co-investigator budget'}}
  await page.route('**/api/**',async route => {
    const req=route.request(), url=new URL(req.url()), body=req.method()==='POST'||req.method()==='PATCH'?req.postDataJSON():null
    requests.push({path:url.pathname,params:Object.fromEntries(url.searchParams),body,method:req.method()})
    let data={modules:[],results:[],areas:[],selected:[],total:0,items:[],runs:[]}, status=200
    if(url.pathname==='/api/v1/auth/whoami') data={user_id:'fixture',email:'preview@example.test',tenant_id:'fixture-tenant',roles:['ADMIN'],ati_id:null}
    if(url.pathname==='/api/v1/me/entitlements') data={plan:null,featureCodes:[],modules:[],isPlatform:true}
    if(url.pathname==='/api/v1/me/tenant-settings') data={timezone:'Asia/Kolkata',locale:'en-IN',currency:'INR'}
    if(url.pathname==='/api/researcher/context') data={profile:null,researchAreas:[],publications:[]}
    if(url.pathname==='/api/recommendations/manual-search') { const n=body?.page||1;data={results:n===1?[opportunity,{...opportunity,id:'rolling',schemeTitle:'Early career research fellowships',isRolling:true,agencyName:'National Research Foundation',amountMin:1500000,amountMax:1500000}]:[{...opportunity,id:'page-two',schemeTitle:'Interdisciplinary research seed fund'}],page:n,totalPages:2,totalResults:3,hasNextPage:n===1,hasPreviousPage:n>1} }
    if(url.pathname==='/api/recommendations/directory/facets') data={facets:{careerStage:[{value:'Established researcher',label:'Established researcher',count:2}],fundingKind:[{value:'Research grant',label:'Research grant',count:2}]},toggles:{membershipRequired:0}}
    if(url.pathname==='/api/recommendations/directory/statistics') data={asOf:'31 Oct 2026',lifecycle:[],fundingKinds:[],origins:[]}
    if(url.pathname==='/api/project-intelligence/search') data={query:body.query,results:[project,{...project,id:'project-two',title:'Circular materials for next-generation energy storage',primaryInstitutionName:'Centre for Advanced Materials',state:'Karnataka',budgetAmount:7200000,sourceKey:'BIRAC',fundingAgency:'Biotechnology Industry Research Assistance Council'}],totalResults:2,approximateTotal:2,sort:body.sort,degradedMode:null,facets:{sources:[{value:'CSIR',count:1},{value:'BIRAC',count:1}],years:[{value:2025,count:2}],states:[{value:'Punjab',count:1}],schemes:[],institutions:[],disciplines:[]},diagnostics:{semanticCandidates:2,keywordCandidates:2,reranked:false}}
    if(url.pathname==='/api/project-intelligence/projects/project') data={project:{...project,source:{name:'CSIR',baseUrl:'https://example.test'},objectivesText:'Validate an affordable field-ready biosensor.',milestonesText:null,deliverablesText:null,outputPlannedText:null,outputAchievedText:null,departmentName:null,city:null,country:'India',startDate:null,endDate:null,durationMonths:24,publications:[],patents:[],outcomes:[]},similar:[]}
    if(url.pathname==='/api/funding-dept/me') data={isMember:true,isHead:true,memberId:'member',schools:options.schools,reachSchools:options.schools,managedUnits:[],canAdminister:true,capabilities:{canAssign:true,canViewReports:true,isTenantWide:true}}
    if(url.pathname==='/api/funding-dept/reports/pendency') {
      if(failScope&&url.searchParams.get('schoolId')==='school-two'){status=500;data={error:'Synthetic scope request failed.'}}
      else data={...common,rows:[pending,{...pending,callId:'review',title:'Community health research opportunity',state:'PENDING',workState:'NOT_REVIEWED',deadline:'2026-12-05',daysToDeadline:35,nextAction:null}],total:2,members:[{coordinatorId:'officer',name:'Dr. Asha Sharma',missed:0,atRisk:1,pending:1,completedNoAllocation:0,oldestDays:26,schools:[]}],summary:{missed:0,atRisk:1,pending:1,completedNoAllocation:0}}
    }
    if(url.pathname==='/api/funding-dept/reports/assigned-calls') data={...common,rows:url.searchParams.get('status')==='submitted'?[{...allocation,status:'COMPLETED',submittedAt:'2026-10-29',evidence:'REFERENCE',submissionReference:'REF/2026/218',verified}]:[allocation],total:1,summary:{active:1,awaitingReply:0,overdue:0,silent:1,submittedThisMonth:1,verifiedThisMonth:verified?1:0,awaitingVerification:verified?0:1}}
    if(url.pathname==='/api/funding-dept/reports/follow-ups') data={...common,weeks:['2026-10-26'],members:[],effort:[],effortTotal:0,total:0,log:[],logTotal:0,logPage:1,logPageSize:25,totals:{followUps:2,facultyContacts:0,activeAssignments:1,silentThisWeek:1}}
    if(url.pathname==='/api/funding-dept/reports/incoming-calls') data={...common,rows:[{callId:'call',title:opportunity.schemeTitle,agency:'Research Foundation',deadline:'2026-11-10',daysToDeadline:10,actionStatus:'COMPLETED',matchedFaculty:4,shortlisted:2,allocations:2,liveAllocations:1,submitted:0,schools:[{schoolId:'school',schoolName:'School of Biotechnology',sourceLabels:['Discipline mapping'],coordinator:{id:'officer',name:'Dr. Asha Sharma'},matchedFaculty:4,actionStatus:'COMPLETED',completed:{at:'2026-10-29',by:'Dr. Asha Sharma',note:'School review recorded.'}}]}],total:1,summary:{openCalls:1,notStarted:0,closingSoonNotCompleted:0,completed:1},matchesRefreshedAt:'2026-10-31T10:00:00Z'}
    if(url.pathname==='/api/funding-dept/actions'){verified=true;data={verified:true}}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  })
  const visit=async target=>{for(let attempt=0;attempt<3;attempt++){try{await page.goto(base+target,{waitUntil:'domcontentloaded',timeout:240000});return}catch(error){if(attempt===2||!error.message.includes('ERR_ABORTED'))throw error;await page.waitForLoadState('domcontentloaded')}}}
  const screenshot=async name=>{await page.screenshot({path:path.join(output,name+'.png'),fullPage:true})}
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'page must fit its viewport')
  await visit('/finder')
  await page.getByRole('heading',{name:opportunity.schemeTitle}).waitFor()
  await page.getByRole('link',{name:'View opportunity'}).first().waitFor()
  await screenshot('discovery-desktop')
  await page.getByRole('button',{name:'List view',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'List view',exact:true}).getAttribute('aria-pressed'),'true')
  await page.getByRole('button',{name:'Quick details',exact:true}).first().click()
  await page.getByRole('button',{name:'Less detail',exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844});await noOverflow()
  const filtersButton=page.getByRole('button',{name:/^Filters/}).first()
  await filtersButton.click();await page.getByRole('dialog',{name:'Refine your search'}).waitFor()
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.equal(await filtersButton.evaluate(node=>node===document.activeElement),true,'filter focus returns to its trigger')
  await screenshot('discovery-mobile')
  await page.setViewportSize({width:1440,height:1080})
  await visit('/funding/intelligence')
  await page.getByRole('heading',{name:'Recently funded projects'}).waitFor()
  await page.getByRole('link',{name:project.title,exact:true}).waitFor()
  await screenshot('intelligence-desktop')
  await page.getByRole('textbox',{name:'Search awarded research'}).fill('water research')
  await page.getByRole('button',{name:'Search research',exact:true}).click()
  await page.waitForURL(/q=water/)
  await page.getByRole('checkbox',{name:/CSIR/}).check()
  await page.getByRole('button',{name:/CSIR.*Remove filter/}).waitFor()
  await page.setViewportSize({width:390,height:844});await noOverflow()
  await page.getByRole('combobox',{name:'Sort'}).waitFor()
  await screenshot('intelligence-mobile')
  await page.setViewportSize({width:1440,height:1080})
  await visit('/funding/intelligence/projects/project')
  await page.getByRole('heading',{name:project.title,exact:true}).waitFor()
  await screenshot('project-evidence-desktop')
  await visit('/funding/intelligence/idea/new')
  await page.getByRole('textbox',{name:'Describe your research idea'}).waitFor()
  await screenshot('idea-analysis-desktop')
  await visit('/funding/intelligence/patents')
  await page.getByRole('heading',{name:'Find the prior art that shapes your next proposal.'}).waitFor()
  await screenshot('patents-desktop')
  await visit('/funding-dept/reports?tab=pendency')
  await page.getByText('Confirm the revised research plan',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Follow up / record submission',exact:true}).waitFor()
  await screenshot('dsr-pendency-desktop')
  failScope=true
  await page.getByRole('combobox',{name:'School',exact:true}).selectOption('school-two')
  await page.getByRole('alert').filter({hasText:'Synthetic scope request failed.'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Follow up / record submission',exact:true}).count(),0,'stale rows cannot be actioned after a failed scope change')
  failScope=false;await page.getByRole('button',{name:'Try again',exact:true}).click()
  await page.getByText('Confirm the revised research plan',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Save view',exact:true}).click()
  await page.getByRole('textbox',{name:'View name'}).fill('My urgent portfolio')
  await page.getByRole('dialog').getByRole('button',{name:'Save view',exact:true}).click()
  await page.getByRole('combobox',{name:'Saved report views'}).waitFor()
  await visit('/funding-dept/reports?tab=assigned&status=submitted')
  await page.getByText('Evidence attached · unverified',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Review evidence',exact:true}).click()
  await page.getByRole('textbox',{name:'Evidence reviewed'}).fill('Checked the reference and the actual submission date against the portal receipt.')
  await page.getByRole('button',{name:'Verify current evidence',exact:true}).click()
  await page.getByRole('table').getByText('Verified',{exact:true}).waitFor()
  await screenshot('dsr-submissions-desktop')
  await visit('/funding-dept/reports?tab=followups&assignmentId=allocation')
  await page.getByRole('button',{name:/Active allocations now/}).click()
  await page.getByText('Dr. Meera Kapoor',{exact:true}).waitFor()
  assert.equal(requests.filter(r=>r.path.endsWith('/assigned-calls')).at(-1).params.assignmentId,'allocation','drill-down retains allocation context')
  await page.getByRole('tab',{name:'Assigned Calls'}).focus();await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab',{name:'Pendency'}).getAttribute('aria-selected'),'true')
  await page.getByText('Confirm the revised research plan',{exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844});await noOverflow();await page.getByRole('button',{name:'Show breakdown',exact:true}).click();await page.getByRole('button',{name:'Hide breakdown',exact:true}).click();await screenshot('dsr-pendency-mobile')
  assert.deepEqual(errors,[],'no browser runtime errors')
  fs.rmSync(path.join(output,'failure.png'),{force:true})
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,checks:['discovery actions and grid/list','mobile filters Escape and focus return','mobile layout','intelligence search and removable filters','mobile sorting','idea and patent navigation','actionable pendency','failed-scope stale-data protection','saved views','submission verification','exact allocation drill-down','keyboard tabs'],screenshots:fs.readdirSync(output).filter(name=>name.endsWith('.png'))},null,2))
  console.log('Funding workspace browser checks passed. All API data was synthetic; no working data or notifications were changed.')
  await browser.close();browser=null
}
main().catch(async error=>{console.error(error);if(page){console.error((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{})}if(browser)await browser.close();process.exitCode=1})
