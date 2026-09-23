import { NextRequest, NextResponse } from 'next/server'
import { getManagementReport, managementWindow } from '@/lib/fundingDept/managementService'
import { readReportSnapshot, reportFilterKey, reportScopeKey } from '@/lib/fundingDept/reportSnapshot'
import { ManagementError } from '@/lib/fundingDept/managementActions'
import { managementAccess, schoolIsAccessible } from '@/lib/fundingDept/managementAccess'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { userId: string } }) {
  const access = await managementAccess(request)
  if ('response' in access) return access.response
  try {
  const person = await prisma.user.findFirst({
    where: { id: params.userId, tenantId: access.context.tenantId, status: 'ACTIVE' },
    select: { id: true, name: true, email: true, researcher_profile: { select: { org_unit: { select: { path: true } } } } },
  })
  const schoolId = person?.researcher_profile?.org_unit?.path[0]
  if (!person || !schoolId || !(await schoolIsAccessible(access, schoolId))) {
    return NextResponse.json({ error: 'Researcher not found in your accessible schools.' }, { status: 404 })
  }

  const query=new URL(request.url).searchParams
  const snapshot=query.get('snapshot')
  const report=snapshot?await readReportSnapshot(snapshot,access.context.tenantId,access.context.user.id,reportScopeKey(access),reportFilterKey(query,'coverage')):
    await getManagementReport(access.context.tenantId,{...await managementWindow(access.context.tenantId,query),mode:'portfolio',schoolIds:[schoolId],includeExpired:query.get('includeExpired')==='true',facultyId:person.id})
  const faculty=report.faculty.find(p=>p.id===person.id)
  const all=report.members.flatMap(m=>m.schools.filter(s=>s.id===schoolId).flatMap(s=>s.calls.filter(c=>c.matches.some(match=>match.user_id===person.id)).map(c=>({...c,match:c.matches.find(match=>match.user_id===person.id)}))))
  const page=Math.max(1,Number.parseInt(query.get('page')||'1',10)||1),pageSize=20
  return NextResponse.json({person:{id:person.id,name:person.name||person.email,schoolId},readiness:{isUnprofiled:!faculty?.profileReady},calls:all.slice((page-1)*pageSize,page*pageSize),total:all.length,page,pageSize,options:report.options},{headers:{'Cache-Control':'private, no-store'}})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Matching calls unavailable.'},{status:error instanceof ManagementError?error.status:500})}
}
