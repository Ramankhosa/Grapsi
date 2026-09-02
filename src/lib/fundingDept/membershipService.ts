/**
 * Funding Department membership and school coverage.
 *
 * Two invariants are enforced by database indexes rather than by this code, so
 * that a concurrent request cannot slip past a read-then-write check:
 *
 *   funding_dept_one_head_key          one active head per tenant
 *   funding_dept_school_one_member_key one covering member per school
 *
 * The service's job is to turn the resulting P2002 into a sentence a human can
 * act on, and to keep the coverage rows consistent when a member leaves.
 */
import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { isMemberAway, memberInclude } from './shared'

export class FundingDeptError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'FundingDeptError'
    this.status = status
  }
}

function isUniqueViolation(error: unknown, target?: string) {
  const known = error as Prisma.PrismaClientKnownRequestError
  if (!known || known.code !== 'P2002') return false
  if (!target) return true
  const meta = (known.meta || {}) as { target?: string | string[] }
  const raw = Array.isArray(meta.target) ? meta.target.join(',') : String(meta.target ?? '')
  return raw.includes(target)
}

export async function listMembers(tenantId: string, options: { includeInactive?: boolean } = {}) {
  return prisma.fundingDeptMember.findMany({
    where: {
      tenant_id: tenantId,
      ...(options.includeInactive ? {} : { is_active: true }),
    },
    include: memberInclude,
    orderBy: [{ is_head: 'desc' }, { created_at: 'asc' }],
  })
}

export async function getMembership(tenantId: string, userId: string) {
  return prisma.fundingDeptMember.findFirst({
    where: { tenant_id: tenantId, user_id: userId },
    include: memberInclude,
  })
}

export async function getMemberById(tenantId: string, memberId: string) {
  return prisma.fundingDeptMember.findFirst({
    where: { id: memberId, tenant_id: tenantId },
    include: memberInclude,
  })
}

/**
 * Adds a member, or reactivates one who was removed earlier. Re-adding is an
 * update rather than a 409 because the UI's "Add to department" control is the
 * same control an admin reaches for after someone returns from leave.
 */
export async function addMember(input: {
  tenantId: string
  userId: string
  title?: string | null
  isHead?: boolean
  actorUserId: string
}) {
  const user = await prisma.user.findFirst({
    where: { id: input.userId, tenantId: input.tenantId },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    throw new FundingDeptError('That person is not part of your organization.', 404)
  }

  const member = await prisma.$transaction(async (tx) => {
    if (input.isHead) {
      await demoteCurrentHead(tx, input.tenantId, null)
    }
    return tx.fundingDeptMember.upsert({
      where: { tenant_id_user_id: { tenant_id: input.tenantId, user_id: user.id } },
      create: {
        tenant_id: input.tenantId,
        user_id: user.id,
        title: input.title || null,
        is_head: Boolean(input.isHead),
        added_by_user_id: input.actorUserId,
      },
      update: {
        title: input.title === undefined ? undefined : input.title || null,
        ...(input.isHead === undefined ? {} : { is_head: input.isHead }),
        is_active: true,
      },
      include: memberInclude,
    })
  })

  await writeAudit({
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    action: 'FUNDING_DEPT_MEMBER_ADD',
    resource: `funding_dept_member:${member.id}`,
    meta: { userId: user.id, userEmail: user.email, isHead: member.is_head },
  })

  return member
}

/**
 * Updates a member. Deactivating releases their schools in the same
 * transaction — the unique index means an inactive member would otherwise sit
 * on slots nobody can claim, and an uncovered school is a visible problem
 * while a school covered by someone on leave is an invisible one.
 */
export async function updateMember(input: {
  tenantId: string
  memberId: string
  title?: string | null
  isActive?: boolean
  isHead?: boolean
  /** Leave window. Pass null to either to clear it. */
  awayFrom?: string | Date | null
  awayUntil?: string | Date | null
  actorUserId: string
}) {
  const existing = await prisma.fundingDeptMember.findFirst({
    where: { id: input.memberId, tenant_id: input.tenantId },
    include: memberInclude,
  })
  if (!existing) {
    throw new FundingDeptError('Department member not found.', 404)
  }

  const deactivating = input.isActive === false && existing.is_active
  const freedSchools = deactivating
    ? existing.school_assignments.map((s) => ({
        id: s.org_unit?.id ?? s.org_unit_id,
        name: s.org_unit?.name ?? null,
      }))
    : []

  const member = await prisma.$transaction(async (tx) => {
    if (input.isHead) {
      await demoteCurrentHead(tx, input.tenantId, existing.id)
    }
    if (deactivating) {
      await tx.fundingDeptSchoolAssignment.deleteMany({ where: { member_id: existing.id } })
    }
    return tx.fundingDeptMember.update({
      where: { id: existing.id },
      data: {
        title: input.title === undefined ? undefined : input.title || null,
        ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
        // A departing head is not a head; leaving the flag set would block the
        // slot for their successor via the partial unique index.
        ...(input.isHead === undefined ? {} : { is_head: input.isHead }),
        ...(deactivating ? { is_head: false } : {}),
        ...(input.awayFrom === undefined
          ? {}
          : { away_from: input.awayFrom ? new Date(input.awayFrom) : null }),
        ...(input.awayUntil === undefined
          ? {}
          : { away_until: input.awayUntil ? new Date(input.awayUntil) : null }),
      },
      include: memberInclude,
    })
  })

  await writeAudit({
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    action: 'FUNDING_DEPT_MEMBER_UPDATE',
    resource: `funding_dept_member:${member.id}`,
    meta: {
      userId: member.user_id,
      isActive: member.is_active,
      isHead: member.is_head,
      freedSchools: freedSchools.map((s) => s.name),
    },
  })

  return { member, freedSchools }
}

export async function removeMember(input: {
  tenantId: string
  memberId: string
  actorUserId: string
}) {
  const existing = await prisma.fundingDeptMember.findFirst({
    where: { id: input.memberId, tenant_id: input.tenantId },
    include: memberInclude,
  })
  if (!existing) {
    throw new FundingDeptError('Department member not found.', 404)
  }

  // Coverage rows cascade. Assignments they already made are deliberately left
  // alone: assigned_by_user_id is provenance, and rewriting history to tidy up
  // an org chart would make every past report lie.
  await prisma.fundingDeptMember.delete({ where: { id: existing.id } })

  await writeAudit({
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    action: 'FUNDING_DEPT_MEMBER_REMOVE',
    resource: `funding_dept_member:${existing.id}`,
    meta: {
      userId: existing.user_id,
      freedSchools: existing.school_assignments.map((s) => s.org_unit?.name ?? s.org_unit_id),
    },
  })

  return {
    freedSchools: existing.school_assignments.map((s) => ({
      id: s.org_unit?.id ?? s.org_unit_id,
      name: s.org_unit?.name ?? null,
    })),
  }
}

/**
 * Replaces a member's school set wholesale. The caller sends the schools they
 * should end up with, not a diff, so a stale tab cannot silently re-add a
 * school someone else has since taken over — it fails loudly instead.
 */
export async function setMemberSchools(input: {
  tenantId: string
  memberId: string
  orgUnitIds: string[]
  actorUserId: string
  /**
   * Deputy rota rather than primary. A deputy is a standing backup: they get
   * the school's reach and receive its nudges while the primary is away, but
   * the primary stays the person answerable for it.
   */
  asDeputy?: boolean
}) {
  const asDeputy = input.asDeputy === true
  const member = await prisma.fundingDeptMember.findFirst({
    where: { id: input.memberId, tenant_id: input.tenantId },
    include: memberInclude,
  })
  if (!member) {
    throw new FundingDeptError('Department member not found.', 404)
  }
  if (!member.is_active) {
    throw new FundingDeptError(
      'That member is inactive. Reactivate them before assigning schools.',
      409
    )
  }

  const wanted = Array.from(new Set(input.orgUnitIds.filter(Boolean)))

  if (wanted.length > 0) {
    const units = await prisma.tenantOrgUnit.findMany({
      where: { id: { in: wanted }, tenant_id: input.tenantId, is_active: true },
      select: { id: true, name: true, depth: true },
    })
    if (units.length !== wanted.length) {
      throw new FundingDeptError('One or more schools were not found in your organization.', 404)
    }
    const nonRoot = units.filter((unit) => unit.depth !== 0)
    if (nonRoot.length > 0) {
      // Coverage is per school because that is the unit a department member is
      // held accountable for; a subtree grant already reaches the departments
      // underneath it.
      throw new FundingDeptError(
        `Coverage is assigned per school. ${nonRoot[0].name} sits below the top level.`,
        400
      )
    }
  }

  // Each rota is replaced independently: setting someone's deputy schools must
  // not silently drop the schools they are primary for.
  const existingIds = member.school_assignments
    .filter((s) => Boolean((s as { is_deputy?: boolean }).is_deputy) === asDeputy)
    .map((s) => s.org_unit_id)
  const toRemove = existingIds.filter((id) => !wanted.includes(id))
  const toAdd = wanted.filter((id) => !existingIds.includes(id))

  try {
    await prisma.$transaction(async (tx) => {
      if (toRemove.length > 0) {
        await tx.fundingDeptSchoolAssignment.deleteMany({
          where: { member_id: member.id, org_unit_id: { in: toRemove }, is_deputy: asDeputy },
        })
      }
      if (toAdd.length > 0) {
        await tx.fundingDeptSchoolAssignment.createMany({
          data: toAdd.map((orgUnitId) => ({
            tenant_id: input.tenantId,
            member_id: member.id,
            org_unit_id: orgUnitId,
            assigned_by_user_id: input.actorUserId,
            is_deputy: asDeputy,
          })),
        })
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const clash = await findCoveringMember(input.tenantId, toAdd)
      if (asDeputy) {
        throw new FundingDeptError(
          'They already cover one of those schools. A member cannot deputise for their own school.',
          409
        )
      }
      throw new FundingDeptError(
        clash
          ? `${clash.schoolName} is already covered by ${clash.memberName}. Remove it from them first.`
          : 'One of those schools is already covered by another member.',
        409
      )
    }
    throw error
  }

  await writeAudit({
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    action: asDeputy ? 'FUNDING_DEPT_DEPUTY_SET' : 'FUNDING_DEPT_COVERAGE_SET',
    resource: `funding_dept_member:${member.id}`,
    meta: { userId: member.user_id, added: toAdd, removed: toRemove, asDeputy },
  })

  return getMemberById(input.tenantId, member.id)
}

/** Every top-level school with whoever covers it, uncovered ones included. */
export async function getSchoolCoverage(tenantId: string) {
  const [schools, coverage] = await Promise.all([
    prisma.tenantOrgUnit.findMany({
      where: { tenant_id: tenantId, depth: 0, is_active: true },
      select: { id: true, name: true, code: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    }),
    prisma.fundingDeptSchoolAssignment.findMany({
      where: { tenant_id: tenantId },
      select: {
        org_unit_id: true,
        is_deputy: true,
        member: {
          select: {
            id: true,
            is_active: true,
            is_head: true,
            away_from: true,
            away_until: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    }),
  ])

  const byUnit = new Map(
    coverage.filter((row) => !row.is_deputy).map((row) => [row.org_unit_id, row.member])
  )
  const deputyByUnit = new Map<string, (typeof coverage)[number]['member']>()
  for (const row of coverage) {
    if (row.is_deputy && !deputyByUnit.has(row.org_unit_id)) {
      deputyByUnit.set(row.org_unit_id, row.member)
    }
  }

  return schools.map((school) => {
    const member = byUnit.get(school.id)
    const deputy = deputyByUnit.get(school.id)
    const primaryAway = member ? isMemberAway(member) : false
    return {
      id: school.id,
      name: school.name,
      code: school.code,
      memberId: member?.id ?? null,
      memberUserId: member?.user?.id ?? null,
      memberName: member?.user?.name || member?.user?.email || null,
      memberIsHead: member?.is_head ?? false,
      covered: Boolean(member),
      deputyMemberId: deputy?.id ?? null,
      deputyName: deputy?.user?.name || deputy?.user?.email || null,
      // A covered school whose officer is away and has no deputy is not
      // covered in any way that matters, and the head needs to see that.
      primaryAway,
      uncoveredRightNow: Boolean(member) && primaryAway && !deputy,
    }
  })
}

async function findCoveringMember(tenantId: string, orgUnitIds: string[]) {
  if (orgUnitIds.length === 0) return null
  const row = await prisma.fundingDeptSchoolAssignment.findFirst({
    where: { tenant_id: tenantId, org_unit_id: { in: orgUnitIds } },
    select: {
      org_unit: { select: { name: true } },
      member: { select: { user: { select: { name: true, email: true } } } },
    },
  })
  if (!row) return null
  return {
    schoolName: row.org_unit?.name ?? 'That school',
    memberName: row.member?.user?.name || row.member?.user?.email || 'another member',
  }
}

/** Clears the head flag so the partial unique index has a free slot. */
async function demoteCurrentHead(
  tx: Prisma.TransactionClient,
  tenantId: string,
  exceptMemberId: string | null
) {
  await tx.fundingDeptMember.updateMany({
    where: {
      tenant_id: tenantId,
      is_head: true,
      is_active: true,
      ...(exceptMemberId ? { id: { not: exceptMemberId } } : {}),
    },
    data: { is_head: false },
  })
}

async function writeAudit(input: {
  actorUserId: string
  tenantId: string
  action: string
  resource: string
  meta: Record<string, unknown>
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        action: input.action,
        resource: input.resource,
        meta: input.meta as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    console.warn(`Funding department: audit log failed (${input.action})`, error)
  }
}
