import { NextRequest, NextResponse } from 'next/server'

import { assignmentInclude, serializeAssignment } from '@/lib/assignments/shared'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { mapCallToSchools } from '@/lib/fundingDept/callSchoolMapping'
import { canReviewDept } from '@/lib/fundingDept/shared'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

/**
 * One call's funnel drill-in: who the alert dispatcher matched (with score,
 * tier and delivery outcome — until now these rows were write-only) and who
 * was actually assigned, side by side. The gap between the two lists is the
 * department's to-do for this call.
 */
export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!canReviewDept(context, context.scope)) {
    return NextResponse.json(
      { error: 'The call funnel is available to administrators and the department head.' },
      { status: 403 }
    )
  }

  const call = await prisma.fundingCall.findFirst({
    where: {
      AND: [
        { id: params.callId },
        visibleFundingCallWhere(context.tenantId, { includeTenantDrafts: true }),
      ],
    },
    select: {
      id: true,
      title: true,
      scheme_title: true,
      agencyName: true,
      agency_name: true,
      close_date: true,
      visibility: true,
      status: true,
      catalog_status: true,
    },
  })
  if (!call) {
    return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })
  }

  const [alerts, assignments] = await Promise.all([
    prisma.fundingCallAlert.findMany({
      where: { funding_call_id: call.id, user: { tenantId: context.tenantId } },
      select: {
        id: true,
        match_score: true,
        match_tier: true,
        match_reason: true,
        matched_sources: true,
        in_app_status: true,
        email_status: true,
        email_error: true,
        emailed_at: true,
        created_at: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            researcher_profile: { select: { school: true, department: true } },
          },
        },
      },
      orderBy: { match_score: 'desc' },
      take: 200,
    }),
    prisma.callAssignment.findMany({
      where: { funding_call_id: call.id, tenant_id: context.tenantId },
      include: assignmentInclude,
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
      take: 200,
    }),
  ])

  const assignedUserIds = new Set(assignments.map((row) => row.assignee_user_id))

  // The shortlist: everyone considered, including the people who were passed
  // over. Without it the record of a call shows only whoever said yes.
  const candidates = await prisma.callCandidate.findMany({
    where: { tenant_id: context.tenantId, funding_call_id: call.id },
    select: {
      id: true,
      status: true,
      note: true,
      match_score: true,
      match_tier: true,
      updated_at: true,
      created_by: { select: { id: true, name: true, email: true } },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          researcher_profile: { select: { school: true, department: true, employee_id: true } },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
  })

  return NextResponse.json({
    call: {
      id: call.id,
      title: call.scheme_title || call.title,
      agency: call.agency_name || call.agencyName || null,
      closeDate: call.close_date,
      visibility: call.visibility,
      isDraft:
        call.visibility === 'TENANT_PRIVATE' &&
        call.status !== 'PUBLISHED' &&
        call.catalog_status !== 'PUBLISHED',
    },
    matched: alerts.map((alert) => ({
      id: alert.id,
      userId: alert.user.id,
      name: alert.user.name || alert.user.email,
      email: alert.user.email,
      school: alert.user.researcher_profile?.school ?? null,
      department: alert.user.researcher_profile?.department ?? null,
      score: alert.match_score,
      tier: alert.match_tier,
      reason: alert.match_reason,
      sources: alert.matched_sources,
      inAppStatus: alert.in_app_status,
      emailStatus: alert.email_status,
      emailError: alert.email_error,
      emailedAt: alert.emailed_at,
      alertedAt: alert.created_at,
      assigned: assignedUserIds.has(alert.user.id),
    })),
    assignments: assignments.map(serializeAssignment),
    candidates: candidates.map((row) => ({
      id: row.id,
      status: row.status,
      note: row.note,
      score: row.match_score,
      tier: row.match_tier,
      updatedAt: row.updated_at,
      addedBy: row.created_by?.name || row.created_by?.email || null,
      userId: row.user.id,
      name: row.user.name || row.user.email,
      email: row.user.email,
      employeeId: row.user.researcher_profile?.employee_id ?? null,
      school: row.user.researcher_profile?.school ?? null,
      department: row.user.researcher_profile?.department ?? null,
      assigned: assignedUserIds.has(row.user.id),
    })),
  })
}

const originSchoolSchema = z.object({ originSchoolId: z.string().min(1), reason: z.string().trim().min(3).max(2000) })

/** Audited correction for an intake attribution that was selected incorrectly. */
export async function PATCH(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return NextResponse.json({ error: context.error }, { status: context.status })
  if (!canReviewDept(context, context.scope)) return NextResponse.json({ error: 'Department-head access required.' }, { status: 403 })
  try {
    const input = originSchoolSchema.parse(await request.json())
    const [call, school] = await Promise.all([
      prisma.fundingCall.findFirst({where:{id:params.callId,OR:[{tenantId:context.tenantId},{tenantId:null,visibility:'GLOBAL_PUBLISHED',status:'PUBLISHED'}]},select:{id:true,tenantId:true,origin_school_id:true,origin_school_name:true,origin_school_source:true}}),
      prisma.tenantOrgUnit.findFirst({where:{id:input.originSchoolId,tenant_id:context.tenantId,depth:0,is_active:true},select:{id:true,name:true}}),
    ])
    if (!call) return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })
    if (!school) return NextResponse.json({ error: 'Origin school not found.' }, { status: 400 })
    const after={origin_school_id:school.id,origin_school_name:school.name,origin_school_source:'CORRECTED_BY_DSR_HEAD'}
    await prisma.$transaction(async tx=>{
      const priorJobs=await tx.$queryRaw(Prisma.sql`SELECT * FROM dsr_origin_responsibilities WHERE tenant_id=${context.tenantId} AND call_id=${call.id}`)
      if(call.tenantId===context.tenantId)await tx.fundingCall.update({where:{id:call.id},data:after})
      await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_origin_overrides(tenant_id,call_id,school_id) VALUES(${context.tenantId},${call.id},${school.id}) ON CONFLICT(tenant_id,call_id) DO UPDATE SET school_id=EXCLUDED.school_id,updated_at=now()`)
      await tx.fundingImportJob.updateMany({where:{tenantId:context.tenantId,fundingCallId:call.id,OR:[{originSchoolId:call.origin_school_id},{originSchoolId:null}]},data:{originSchoolId:school.id,originSchoolName:school.name,originSchoolSource:after.origin_school_source}})
      await tx.$executeRaw(Prisma.sql`UPDATE funding_intake_jobs j SET origin_school_id=${school.id},origin_school_name=${school.name},origin_school_source=${after.origin_school_source}
        FROM users u WHERE u.id=j.submitted_by_user_id AND u."tenantId"=${context.tenantId} AND j.linked_funding_call_id=${call.id} AND (j.origin_school_id IS NOT DISTINCT FROM ${call.origin_school_id} OR j.origin_school_id IS NULL)`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,actor_user_id,kind,before_data,after_data,reason)
        VALUES(${context.tenantId},${school.id},'ORIGIN_ATTRIBUTION',${call.id},${context.user.id},'CORRECTED',${JSON.stringify({call,intakeEvidence:priorJobs})}::jsonb,${JSON.stringify(after)}::jsonb,${input.reason})`)
    })
    // The corrected origin school owns the call from now on. Add-only: the old
    // origin's mapping stays until the head ends it with a reason.
    await mapCallToSchools(call.id,{tenantIds:[context.tenantId],actorId:context.user.id}).catch(error=>console.warn('[DSR MAPPING] origin correction mapping failed',error))
    return NextResponse.json({ saved:true, originSchool:school })
  } catch (error) {
    return NextResponse.json({ error:error instanceof z.ZodError?'Choose a school and explain the correction.':error instanceof Error?error.message:'Could not correct origin school.' }, { status:400 })
  }
}
