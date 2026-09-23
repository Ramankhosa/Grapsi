import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { managementAccess, schoolIsAccessible } from '@/lib/fundingDept/managementAccess'
import { getManagementReport, managementWindow } from '@/lib/fundingDept/managementService'
import type { ApplicationRow } from '@/lib/fundingDept/managementRules'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const access = await managementAccess(request)
  if ('response' in access) return access.response
  const tenantId = access.context.tenantId
  const row = (await prisma.$queryRaw<ApplicationRow[]>(Prisma.sql`SELECT * FROM dsr_applications WHERE tenant_id=${tenantId} AND id=${params.id}`))[0]
  if (!row?.school_id || !await schoolIsAccessible(access, row.school_id)) return NextResponse.json({ error: 'Application not found.' }, { status: 404 })
  const window = await managementWindow(tenantId, new URLSearchParams('window=30d'))
  const report = await getManagementReport(tenantId, { ...window, mode: 'portfolio', includeExpired:true, includeCompleted:true, schoolIds: [row.school_id] })
  const [proposal, assignmentDocuments, events] = await Promise.all([
    row.proposal_id ? prisma.grantProposal.findFirst({ where: { id: row.proposal_id, tenant_id: tenantId }, select: {
      id:true,status:true,requested_amount:true,sanctioned_amount:true,currency:true,
      versions: { select: { id:true,version_no:true,file_name:true,note:true,review_status:true,created_at:true,
        uploaded_by:{select:{id:true,name:true}},review:{select:{status:true,overall_score:true,recommendation:true,finished_at:true}} },orderBy:{version_no:'desc'} },
      documents:{select:{id:true,kind:true,file_name:true,title:true,note:true,reference_no:true,created_at:true}},
      events:{select:{id:true,kind:true,from_status:true,to_status:true,payload:true,created_at:true,actor:{select:{id:true,name:true}}},orderBy:{created_at:'desc'}},
    } }) : null,
    row.assignment_id ? prisma.assignmentDocument.findMany({ where: { tenant_id:tenantId,assignment_id:row.assignment_id },select:{id:true,kind:true,file_name:true,note:true,created_at:true} }) : [],
    prisma.$queryRaw(Prisma.sql`SELECT e.id::text,e.entity_type,e.kind,e.before_data,e.after_data,e.reason,e.occurred_at,e.inferred,COALESCE(u.name,u.email) actor
      FROM dsr_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.tenant_id=${tenantId} AND e.school_id=${row.school_id}
      AND (e.entity_type='OWNERSHIP' OR e.entity_id=${row.id} OR e.entity_type='ACTION' AND e.entity_id IN (SELECT id FROM dsr_actions WHERE tenant_id=${tenantId} AND application_id=${row.id}))
      ORDER BY e.occurred_at DESC,e.id DESC`),
  ])
  return NextResponse.json({ application:report.applications.find(a=>a.id===row.id),proposal,assignmentDocuments,events,
    people:report.options.people,accountableOfficer:report.members.find(m=>m.schools.some(s=>s.id===row.school_id))?.name },{headers:{'Cache-Control':'private, no-store'}})
}
