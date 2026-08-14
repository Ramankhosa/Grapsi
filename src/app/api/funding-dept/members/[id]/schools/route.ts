import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { FundingDeptError, setMemberSchools } from '@/lib/fundingDept/membershipService'
import { canReviewDept, serializeMember } from '@/lib/fundingDept/shared'

export const dynamic = 'force-dynamic'

/**
 * The school rota. PUT replaces the member's whole set, so the request states
 * the intended end state instead of a diff — a stale tab then fails on the
 * unique index rather than quietly re-claiming a school someone else took over.
 */
const schoolsSchema = z.object({
  orgUnitIds: z.array(z.string().trim().min(1)).max(200),
})

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!canReviewDept(context, context.scope)) {
    return NextResponse.json(
      { error: 'Only the department head or an organization admin can move schools.' },
      { status: 403 }
    )
  }

  let payload
  try {
    payload = schoolsSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    const member = await setMemberSchools({
      tenantId: context.tenantId,
      memberId: params.id,
      orgUnitIds: payload.orgUnitIds,
      actorUserId: context.user.id,
    })
    return NextResponse.json({ member: member ? serializeMember(member) : null })
  } catch (error) {
    if (error instanceof FundingDeptError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Funding department: set schools failed', error)
    return NextResponse.json({ error: 'Could not update school coverage.' }, { status: 500 })
  }
}
