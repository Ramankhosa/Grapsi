import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { CALL_ENTRY_DEADLINE_SELECT, callEntryDeadline } from '@/lib/funding/callDeadline'
import { formatDeadlineDate } from '@/lib/i18n/format'
import { getTenantLocale } from '@/lib/tenant/locale'
import { planTenantMappings } from './callSchoolMapping'
import { coordinatorSql } from './hubScope'
import { textArray, visibleCallSql } from './callSql'

export interface NewCallNoticeResult { fundingCallId: string; schoolsMatched: number; notified: number; reroutedForLeave: number }
type CoverageRow = {
  tenant_id: string; org_unit_id: string
  org_unit: { id: string; name: string; is_active: boolean }
  member: { user_id: string; away_from: Date | null; away_until: Date | null }
  rerouted: boolean
}

/** Preview and delivery use the mapper's exact responsibilities and the queue's operational owner. */
export async function coveredSchoolsForCall(callId: string, tenantIds?: string[]): Promise<CoverageRow[]> {
  if (tenantIds?.length === 0) return []
  const call = await prisma.fundingCall.findUnique({ where: { id: callId }, select: { id: true, tenantId: true, visibility: true } })
  if (!call) return []
  const tenants = call.visibility === 'TENANT_PRIVATE'
    ? call.tenantId && (!tenantIds || tenantIds.includes(call.tenantId)) ? [call.tenantId] : []
    : tenantIds
  if (tenants?.length === 0) return []

  // A catalogue promotion preview is explicitly scoped by the curator's eligible tenants.
  // It plans mappings without inserting them; catalogue entries are never sent notices.
  const preview = call.visibility === 'GLOBAL_CATALOG'
  if (preview && !tenants) return []
  const planned = preview ? (await Promise.all(tenants!.map(id => planTenantMappings(id,[callId],{ignoreVisibility:true})))).flat() : []
  if (preview && !planned.length) return []
  const mappings = preview
    ? Prisma.sql`(VALUES ${Prisma.join(planned.map(m => Prisma.sql`(${m.tenantId}::text,${m.schoolId}::text,${callId}::text)`))}) AS m(tenant_id,school_id,call_id)`
    : Prisma.sql`dsr_call_school_mappings m`
  const rows = await prisma.$queryRaw<Array<{ tenant_id: string; school_id: string; school_name: string; user_id: string; rerouted: boolean }>>(Prisma.sql`
    SELECT DISTINCT m.tenant_id,m.school_id,s.name school_name,owner.user_id,
      NOT EXISTS(SELECT 1 FROM funding_dept_school_assignments primary_cover JOIN funding_dept_members primary_member ON primary_member.id=primary_cover.member_id
        WHERE primary_cover.tenant_id=m.tenant_id AND primary_cover.org_unit_id=m.school_id AND NOT primary_cover.is_deputy AND primary_member.user_id=owner.user_id) rerouted
    FROM ${mappings} JOIN funding_calls fc ON fc.id=m.call_id
    JOIN tenant_org_units s ON s.id=m.school_id AND s.tenant_id=m.tenant_id AND s.is_active
    CROSS JOIN LATERAL(SELECT ${coordinatorSql(Prisma.raw('m.tenant_id'),'m.school_id','m.call_id')} user_id) owner
    JOIN users u ON u.id=owner.user_id AND u."tenantId"=m.tenant_id AND u.status='ACTIVE'
    WHERE m.call_id=${callId} ${preview ? Prisma.empty : Prisma.sql`AND m.is_active AND ${visibleCallSql(Prisma.raw('m.tenant_id'))}`}
      ${tenants ? Prisma.sql`AND m.tenant_id=ANY(${textArray(tenants)})` : Prisma.empty}`)
  return rows.filter(r=>!tenants || tenants.includes(r.tenant_id)).map(r => ({ tenant_id:r.tenant_id,org_unit_id:r.school_id,
    org_unit:{id:r.school_id,name:r.school_name,is_active:true},
    member:{user_id:r.user_id,away_from:null,away_until:null},rerouted:r.rerouted }))
}

export async function notifyCoveringOfficers(fundingCallId: string): Promise<NewCallNoticeResult> {
  const result: NewCallNoticeResult = { fundingCallId,schoolsMatched:0,notified:0,reroutedForLeave:0 }
  const call = await prisma.fundingCall.findUnique({ where:{id:fundingCallId}, select:{id:true,tenantId:true,title:true,scheme_title:true,
    agency_name:true,agencyName:true,notification_policy:true,visibility:true,...CALL_ENTRY_DEADLINE_SELECT} })
  if (!call || call.notification_policy==='SUPPRESSED' || call.visibility==='GLOBAL_CATALOG') return result
  for (const row of await coveredSchoolsForCall(call.id)) {
    result.schoolsMatched++
    if (row.rerouted) result.reroutedForLeave++
    const locale=await getTenantLocale(row.tenant_id)
    const closes=formatDeadlineDate(callEntryDeadline(call),{timeZone:call.deadline_timezone || locale.timezone,locale:locale.locale})
    const title=`New call for ${row.org_unit.name}: ${call.scheme_title || call.title || 'A new funding call'}`
    const body=[call.agency_name || call.agencyName ? `From ${call.agency_name || call.agencyName}.` : null,
      closes ? `Closes ${closes}.` : null,`Matches ${row.org_unit.name}.`].filter(Boolean).join(' ')
    // Claim and notification are atomic. Failed transactions can retry, completed deliveries cannot duplicate.
    const sent=await prisma.$transaction(async tx => {
      const claimed=await tx.$queryRaw<Array<{user_id:string}>>(Prisma.sql`
        INSERT INTO dsr_call_notice_deliveries(tenant_id,call_id,school_id,user_id)
        SELECT ${row.tenant_id},fc.id,${row.org_unit_id},u.id FROM funding_calls fc JOIN users u ON u.id=${row.member.user_id} AND u."tenantId"=${row.tenant_id} AND u.status='ACTIVE'
        WHERE fc.id=${call.id} AND ${visibleCallSql(row.tenant_id)} AND COALESCE(fc.notification_policy,'') <> 'SUPPRESSED'
        ON CONFLICT DO NOTHING RETURNING user_id`)
      if (!claimed.length) return 0
      await tx.notification.create({data:{id:randomUUID(),tenant_id:row.tenant_id,user_id:row.member.user_id,title,body,category:'FUNDING_MATCH',
        link_url:`/funding-dept/calls/${call.id}?school=${row.org_unit_id}`}})
      return 1
    })
    result.notified+=sent
  }
  return result
}

export function notifyCoveringOfficersQuietly(fundingCallId: string): void {
  void notifyCoveringOfficers(fundingCallId).catch(error => console.warn('[DEPT-NOTICE] Delivery failed:',error instanceof Error ? error.message : String(error)))
}
