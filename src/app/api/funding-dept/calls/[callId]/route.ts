import { NextRequest, NextResponse } from 'next/server'

import { assignmentInclude, serializeAssignment } from '@/lib/assignments/shared'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { canReviewDept } from '@/lib/fundingDept/shared'
import { prisma } from '@/lib/prisma'

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
  })
}
