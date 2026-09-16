import { NextRequest, NextResponse } from 'next/server'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import prisma from '@/lib/prisma'
import { getMembership } from './membershipService'
import { canReviewDept } from './shared'

/** Every new report, detail, action and export uses this exact primary/deputy fence. */
export async function managementAccess(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return { response: NextResponse.json({ error: context.error }, { status: context.status }) } as const
  const member = await getMembership(context.tenantId, context.user.id)
  const department = canReviewDept(context, context.scope) || Boolean(member?.is_active && member.is_head)
  if (!department && !member?.is_active) return { response: NextResponse.json({ error: 'Funding department access required.' }, { status: 403 }) } as const
  const deputy = new URL(request.url).searchParams.get('portfolio') === 'deputy'
  const schoolIds = department ? undefined : member!.school_assignments
    .filter(row => row.is_deputy === deputy).map(row => row.org_unit_id)
  return { context, department, memberId: member?.id ?? null, schoolIds, deputy } as const
}
export async function schoolIsAccessible(access: Exclude<Awaited<ReturnType<typeof managementAccess>>, { response: NextResponse }>, id: string) {
  if (access.schoolIds && !access.schoolIds.includes(id)) return false
  return Boolean(await prisma.tenantOrgUnit.findFirst({ where: { id, tenant_id: access.context.tenantId, depth: 0 }, select: { id: true } }))
}
