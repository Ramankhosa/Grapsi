import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  TENANT_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
  requireTenantScope,
} from '@/lib/auth/tenantAccess'
import {
  FundingDeptError,
  addMember,
  getSchoolCoverage,
  listMembers,
} from '@/lib/fundingDept/membershipService'
import { canReviewDept, serializeMember } from '@/lib/fundingDept/shared'

export const dynamic = 'force-dynamic'

/**
 * Funding Department roster.
 *
 * Adding a member is a privilege grant: coverage rows give assign rights and
 * read access to a school's faculty. It therefore stays with full tenant
 * admins, exactly as headship grants do. The head runs the department but does
 * not staff it.
 */

const createSchema = z.object({
  userId: z.string().trim().min(1, 'A person is required'),
  title: z.string().trim().max(120).nullable().optional(),
  isHead: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!canReviewDept(context, context.scope)) {
    return NextResponse.json(
      { error: 'Only the department head or an organization admin can view the roster.' },
      { status: 403 }
    )
  }

  const includeInactive = request.nextUrl.searchParams.get('includeInactive') === 'true'
  const [members, coverage] = await Promise.all([
    listMembers(context.tenantId, { includeInactive }),
    getSchoolCoverage(context.tenantId),
  ])

  return NextResponse.json({
    members: members.map(serializeMember),
    schools: coverage,
    uncoveredCount: coverage.filter((school) => !school.covered).length,
  })
}

export async function POST(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  let payload
  try {
    payload = createSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    const member = await addMember({
      tenantId: context.tenantId,
      userId: payload.userId,
      title: payload.title,
      isHead: payload.isHead,
      actorUserId: context.user.id,
    })
    return NextResponse.json({ member: serializeMember(member) }, { status: 201 })
  } catch (error) {
    if (error instanceof FundingDeptError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Funding department: add member failed', error)
    return NextResponse.json({ error: 'Could not add that person to the department.' }, { status: 500 })
  }
}
