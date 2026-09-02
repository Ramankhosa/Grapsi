import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { TENANT_ADMIN_ROLES, isAccessError, requireTenantRoles } from '@/lib/auth/tenantAccess'
import { FundingDeptError, removeMember, updateMember } from '@/lib/fundingDept/membershipService'
import { serializeMember } from '@/lib/fundingDept/shared'

export const dynamic = 'force-dynamic'

const updateSchema = z
  .object({
    title: z.string().trim().max(120).nullable().optional(),
    isActive: z.boolean().optional(),
    isHead: z.boolean().optional(),
    // Leave window: while it is open this member's ticklers route to whoever
    // deputises for each of their schools.
    awayFrom: z.string().trim().nullable().optional(),
    awayUntil: z.string().trim().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  let payload
  try {
    payload = updateSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    const { member, freedSchools } = await updateMember({
      tenantId: context.tenantId,
      memberId: params.id,
      title: payload.title,
      isActive: payload.isActive,
      isHead: payload.isHead,
      awayFrom: payload.awayFrom,
      awayUntil: payload.awayUntil,
      actorUserId: context.user.id,
    })
    // freedSchools is surfaced so the UI can say which schools now have nobody
    // chasing them, rather than letting them go quiet.
    return NextResponse.json({ member: serializeMember(member), freedSchools })
  } catch (error) {
    if (error instanceof FundingDeptError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Funding department: update member failed', error)
    return NextResponse.json({ error: 'Could not update that member.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  try {
    const { freedSchools } = await removeMember({
      tenantId: context.tenantId,
      memberId: params.id,
      actorUserId: context.user.id,
    })
    return NextResponse.json({ removed: true, freedSchools })
  } catch (error) {
    if (error instanceof FundingDeptError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Funding department: remove member failed', error)
    return NextResponse.json({ error: 'Could not remove that member.' }, { status: 500 })
  }
}
