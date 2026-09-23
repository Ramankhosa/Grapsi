import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { isExpiredInIndia } from './responsibility'
import { textArray } from './callSql'

export type IncomingRow={id:string;callId:string|null;schoolId:string|null;schoolName:string|null;title:string;status:string;error:string|null;enteredAt:Date;deadline:Date|null;source:string|null;ownerName:string|null;triage:string|null;live:boolean;reviewComplete:boolean;actionClass:string;nextAction:string;duplicate:boolean}
export async function getIncomingReport(tenantId:string,schoolIds:string[]|undefined,filters:{includeExpired?:boolean;callSearch?:string|null;schoolId?:string|null;callId?:string|null;actionClass?:string|null;asOf?:Date}) {
  const rows=await prisma.$queryRaw<IncomingRow[]>(Prisma.sql`
    WITH arrivals AS (
      SELECT 'import:'||j.id id,j."fundingCallId" call_id,j.origin_school_id school_id,j.status::text status,j."errorMessage" error,j."createdAt" entered_at,j.origin_school_source source,(j.outcome::text='REUSED_EXISTING') duplicate
      FROM funding_import_jobs j WHERE j."tenantId"=${tenantId}
      UNION ALL
      SELECT 'intake:'||j.id,j.linked_funding_call_id,j.origin_school_id,j.status::text,j.error_message,j.created_at,j.origin_school_source,(j.duplicate_status::text='resolved')
      FROM funding_intake_jobs j JOIN users u ON u.id=j.submitted_by_user_id WHERE u."tenantId"=${tenantId}
      UNION ALL
      SELECT 'call:'||c.id,c.id,c.origin_school_id,c.status::text,NULL,c."createdAt",c.origin_school_source,false
      FROM funding_calls c WHERE c."tenantId"=${tenantId}
        AND NOT EXISTS(SELECT 1 FROM funding_import_jobs j WHERE j."fundingCallId"=c.id)
        AND NOT EXISTS(SELECT 1 FROM funding_intake_jobs j WHERE j.linked_funding_call_id=c.id)
    )
    SELECT a.id,a.call_id "callId",a.school_id "schoolId",s.name "schoolName",COALESCE(fc.scheme_title,fc.title,'Intake awaiting extraction') title,
      a.status,a.error,a.entered_at "enteredAt",COALESCE(fc.close_date,fc."deadlineAt") deadline,a.source,a.duplicate,
      COALESCE(u.name,u.email) "ownerName",tri.status::text triage,
      (EXISTS(SELECT 1 FROM dsr_actions x WHERE x.tenant_id=${tenantId} AND x.call_id=a.call_id AND (a.school_id IS NULL OR x.school_id=a.school_id) AND x.status IN ('OPEN','ACKNOWLEDGED')) OR
       EXISTS(SELECT 1 FROM dsr_applications x WHERE x.tenant_id=${tenantId} AND x.call_id=a.call_id AND (a.school_id IS NULL OR x.school_id=a.school_id) AND COALESCE(x.assignment_status,'') NOT IN ('DECLINED','CANCELLED','LAPSED') AND COALESCE(x.proposal_status,'') NOT IN ('CLOSED','WITHDRAWN','REJECTED','SANCTIONED') AND COALESCE(x.outcome,'') NOT IN ('AWARDED','WITHDRAWN','REJECTED')) OR EXISTS(SELECT 1 FROM assignment_follow_ups f JOIN tenant_org_units unit ON unit.id=f.org_unit_id WHERE f.tenant_id=${tenantId} AND f.funding_call_id=a.call_id AND (a.school_id IS NULL OR unit.path[1]=a.school_id) AND f.remind_at IS NOT NULL)) live,
      (EXISTS(SELECT 1 FROM dsr_applications x WHERE x.tenant_id=${tenantId} AND x.call_id=a.call_id AND x.school_id=a.school_id AND x.assignment_id IS NOT NULL) OR
       EXISTS(SELECT 1 FROM dsr_opportunity_dispositions x WHERE x.tenant_id=${tenantId} AND x.call_id=a.call_id AND x.school_id=a.school_id AND x.reason IN ('NO_SUITABLE_FACULTY','DECLINED','CAPACITY','OTHER'))) "reviewComplete"
    FROM arrivals a LEFT JOIN funding_calls fc ON fc.id=a.call_id LEFT JOIN tenant_org_units s ON s.id=a.school_id AND s.tenant_id=${tenantId}
    LEFT JOIN funding_dept_school_assignments cover ON cover.org_unit_id=a.school_id AND cover.tenant_id=${tenantId} AND NOT cover.is_deputy
    LEFT JOIN funding_dept_members m ON m.id=cover.member_id AND m.is_active LEFT JOIN users u ON u.id=m.user_id
    LEFT JOIN call_school_triage tri ON tri.tenant_id=${tenantId} AND tri.org_unit_id=a.school_id AND tri.funding_call_id=a.call_id
    WHERE ${schoolIds?Prisma.sql`a.school_id=ANY(${textArray(schoolIds)})`:Prisma.sql`TRUE`}
    ORDER BY a.entered_at ASC,a.id`)
  return rows.filter(r=>(filters.includeExpired||!isExpiredInIndia(r.deadline,filters.asOf)||r.live)&&(!filters.schoolId||r.schoolId===filters.schoolId)&&(!filters.callId||r.callId===filters.callId)&&(!filters.callSearch||`${r.title} ${r.id}`.toLowerCase().includes(filters.callSearch.toLowerCase()))).map(r=>{
    const processing=['queued','processing','fetching','extracting','PENDING','PROCESSING'].includes(r.status)
    const completed=r.status==='canceled'||['RELEVANT','NOT_RELEVANT','SHORTLISTED'].includes(r.triage||'')||r.reviewComplete
    const actionClass=!r.schoolId||r.error||['FAILED','failed'].includes(r.status)?'DATA_GAP':processing?'SYSTEM_PROCESSING':completed?'COMPLETED':'DSR_ACTION_REQUIRED'
    return {...r,actionClass,nextAction:!r.schoolId?'Assign the origin school':r.error?'Review intake error and retry or correct the source':processing?'Processing; no DSR action yet':completed?'Intake handed to the school workflow':!r.ownerName?'Assign school coverage':r.callId?'Review relevance and confirm the next step':'Resolve extraction or duplicate review'}
  }).filter(r=>!filters.actionClass||r.actionClass===filters.actionClass)
}
