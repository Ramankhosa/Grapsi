import { NextRequest,NextResponse } from 'next/server'
import { managementAccess } from './managementAccess'
import { getManagementReport,managementWindow } from './managementService'
import { definitionsSheet, managementExport, viewTables, writeTables } from './managementExport'
import { incomingCounts } from './incomingReport'
import type { AttentionFilter, ReportMode } from './managementRules'
import { ManagementError } from './managementActions'
import { isRelevantQuality } from './reportDefinitions'
import { readReportSnapshot,writeReportSnapshot,reportScopeKey,reportFilterKey } from './reportSnapshot'
export async function managementReportHandler(request:NextRequest,view='funnel') {
  const access=await managementAccess(request);if('response' in access)return access.response
  try {
    const params=new URL(request.url).searchParams
    const window=await managementWindow(access.context.tenantId,params)
    const mode=params.get('mode') || (['workbench','pending','deadline-risk','opportunity-gaps'].includes(view)?'pending':'portfolio')
    if(!['pending','activity','cohort','portfolio'].includes(mode))return NextResponse.json({error:'Unknown report mode.'},{status:400})
    const requested=params.get('memberId')
    const attention=params.get('attention')
    if(attention&&!['upcoming-21','missed-unallocated-no-submission','missed-never-allocated','missed-allocated-not-submitted'].includes(attention))return NextResponse.json({error:'Unknown attention filter.'},{status:400})
    if(!access.department && requested && requested!==access.memberId)return NextResponse.json({error:'This portfolio is outside your access.'},{status:403})
    const scopeKey=reportScopeKey(access),filterKey=reportFilterKey(params,view)
    let snapshot=params.get('snapshot')
    const report=snapshot?await readReportSnapshot(snapshot,access.context.tenantId,access.context.user.id,scopeKey,filterKey):await getManagementReport(access.context.tenantId,{
      ...window,schoolIds:access.schoolIds,memberId:access.deputy?null:requested,
      schoolId:params.get('schoolId'),callId:params.get('callId'),callSearch:params.get('callSearch'),mode:mode as ReportMode,
      workState:params.get('workState'),stage:params.get('stage'),relevance:params.get('relevance'),exception:params.get('exception'),
      waitingWith:params.get('waitingWith'),horizon:['7','14','21','30'].includes(params.get('horizon') || '')?Number(params.get('horizon')):null,
      attention:attention as AttentionFilter|null,
      // The head sees missed calls by default; coordinators keep the expired toggle.
      showMissed:params.get('showMissed')?params.get('showMissed')==='true':Boolean(access.department),
      reviewState:params.get('reviewState'),deadlineState:params.get('deadlineState'),
      includeExpired:params.get('includeExpired')==='true',actionClass:params.get('actionClass'),
      responsibilityType:params.get('responsibilityType'),ageDays:Number(params.get('ageDays'))>0?Number(params.get('ageDays')):null,
      includeCompleted:params.get('includeCompleted')==='true',queue:params.get('queue'),reportView:view,
      signal:params.get('signal'),actionStatus:params.get('actionStatus'),
    })
    if(!snapshot)snapshot=await writeReportSnapshot(access.context.tenantId,access.context.user.id,scopeKey,filterKey,report)
    const format=params.get('format')
    const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page') || '1',10)||1))
    const pageSize=Math.max(1,Math.min(100,Number.parseInt(params.get('pageSize') || '20',10)||20))
    const slice=<T,>(items:T[])=>({rows:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize})
    const level=params.get('level') || 'summary'
    const contexts=report.members.filter(m=>!params.get('drillMemberId')||m.id===params.get('drillMemberId')).flatMap(m=>m.schools.filter(s=>!params.get('drillSchoolId')||s.id===params.get('drillSchoolId')).flatMap(s=>s.calls.filter(c=>!params.get('drillCallId')||c.id===params.get('drillCallId')).map(c=>({member:m,school:s,call:c}))))
    const calls=contexts.map(row=>row.call)
    const items=calls.flatMap(c=>c.applications)
    const nextActions=report.actions.filter(a=>['OPEN','ACKNOWLEDGED'].includes(a.status))
    // Each view's complete row list, computed once: the page is a slice of it,
    // its total is its length, and the default export writes all of it.
    const gapRows=()=>{
      const rows=contexts.filter(({call})=>isRelevantQuality(call.quality)&&call.gaps.length>0).map(({member,school,call})=>({...call,memberId:member.id,memberName:member.name,schoolName:school.name,applications:undefined,matches:undefined}))
      return rows.sort((a,b)=>Number(b.gaps.includes('UNTOUCHED'))-Number(a.gaps.includes('UNTOUCHED')) || Number(b.matchedUnallocated)-Number(a.matchedUnallocated) ||
        (a.deadline?.getTime()??Infinity)-(b.deadline?.getTime()??Infinity) || `${a.schoolId}:${a.id}`.localeCompare(`${b.schoolId}:${b.id}`))
    }
    const applicationRows=()=>{
      const list=view==='outcomes'?items.filter(a=>a.submitted):items.filter(a=>a.outstanding)
      return list.sort((a,b)=>Number(b.exceptions.includes('overdue'))-Number(a.exceptions.includes('overdue')) ||
        Math.min(...[a.agency_deadline,a.nextAction?.due_at].filter(Boolean).map(d=>new Date(d!).getTime()),Infinity)-
        Math.min(...[b.agency_deadline,b.nextAction?.due_at].filter(Boolean).map(d=>new Date(d!).getTime()),Infinity) || a.id.localeCompare(b.id))
    }
    if(format==='csv'||format==='xlsx'){
      const stamp={report:`DSR ${view.replace(/-/g,' ')}`,snapshot,periodLabel:window.label,periodStart:report.period.start,periodEnd:report.period.end,filters:Object.fromEntries(params)}
      const rows=view==='opportunity-gaps'?gapRows():['pending','deadline-risk','outcomes'].includes(view)?applicationRows():[]
      const body=params.get('workbook')==='complete'?managementExport(report,format,{...stamp,report:'Complete DSR workbook'})
        :writeTables([definitionsSheet(stamp),...viewTables(view,report,rows)],format)
      return exportResponse(body,format,`dsr-${view}${params.get('workbook')==='complete'?'-complete':''}`)
    }
    let payload:unknown
    if(level==='calls')payload=slice(calls.map(c=>({...c,applications:undefined,matches:undefined})))
    else if(level==='applications')payload=slice(items)
    else if(level==='matches')payload=slice(calls.flatMap(c=>c.matches))
    else if(view==='workbench')payload={rows:report.workbench,headSummary:report.headSummary,coverageProblems:report.coverageProblems}
    else if(view==='incoming')payload={...slice(report.incoming),incomingCounts:incomingCounts(report.incoming)}
    else if(view==='corrective-actions')payload={rows:report.correctiveActions,headSummary:report.headSummary}
    else if(view==='performance')payload={rows:report.performance,weekly:report.weekly}
    else if(view==='weekly-review')payload={...report.weekly,urgentActions:nextActions.filter(a=>a.blocker || a.due_at && a.due_at<=window.asOf),
      urgentOpportunities:contexts.filter(({call})=>isRelevantQuality(call.quality)&&call.gaps.some(g=>['UNTOUCHED','MATCHED_UNALLOCATED','APPROACHED_UNALLOCATED'].includes(g))&&
        (!call.deadline || call.deadline.getTime()<=window.asOf.getTime()+30*86400000)).map(({member,school,call})=>({...call,memberName:member.name,schoolName:school.name,applications:undefined,matches:undefined}))}
    else if(view==='coverage')payload={...slice(report.faculty),unmappedFaculty:report.unmappedFaculty}
    else if(view==='opportunity-gaps') payload={...slice(gapRows())}
    else if(view==='pending'||view==='deadline-risk'||view==='outcomes') {
      payload={...slice(applicationRows()),unallocated:calls.filter(c=>c.unallocated).map(c=>({...c,matches:undefined})),actions:nextActions}
    }else payload={members:report.members.map(m=>({...m,schools:m.schools.map(s=>({...s,calls:undefined,totals:{
      relevant:s.calls.length,matches:s.calls.reduce((n,c)=>n+c.matchedFaculty,0),
      actedOn:s.calls.filter(c=>c.actedOn).length,untouched:s.calls.filter(c=>!c.actedOn).length,
      matchedUnallocated:s.calls.filter(c=>c.matchedUnallocated).length,
      allocated:s.calls.reduce((n,c)=>n+c.allocated,0),independent:s.calls.reduce((n,c)=>n+c.independent,0),
      followedUp:s.calls.reduce((n,c)=>n+c.followedUp,0),submitted:s.calls.reduce((n,c)=>n+c.submitted,0),verified:s.calls.reduce((n,c)=>n+c.verified,0),
      pending:s.calls.reduce((n,c)=>n+c.pending,0),overdue:s.calls.reduce((n,c)=>n+c.overdue,0),
    }}))}))}
    return NextResponse.json({snapshot,asOf:report.asOf,mode:report.mode,period:report.period,windowLabel:window.label,timezone:window.timezone,
      portfolio:access.deputy?'deputy':'primary',lens:access.department?'department':'member',totals:report.totals,activity:report.activity,
      attentionCounts:report.attentionCounts,quality:report.quality,options:report.options,...payload as object},{headers:{'Cache-Control':'private, no-store'}})
  }catch(error){
    console.error('DSR management report failed',error)
    const missingSchema=(error as {meta?:{code?:string}})?.meta?.code==='42P01'
    return NextResponse.json({error:missingSchema?'The DSR report database update is pending. Ask the administrator to apply the reporting migration.':error instanceof Error?error.message:'Report unavailable.'},{status:missingSchema?503:error instanceof ManagementError?error.status:500})
  }
}

export function exportResponse(body:string|Uint8Array,format:'csv'|'xlsx',name:string) {
  return new NextResponse(body as BodyInit,{headers:{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':`attachment; filename="${name}.${format}"`,'Cache-Control':'private, no-store'}})
}
