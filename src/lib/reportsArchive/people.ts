/**
 * Who ran a report.
 *
 * Both report tables record only a `userId`, and the archive has to name that
 * person — including where they sit in the org tree, because the people running
 * these reviews are DSR members and school heads and "which school was this
 * for" is the first question an administrator asks.
 *
 * The org placement lives on `ResearcherProfile`, which is optional: a user may
 * have no profile, a profile with no org unit, or a profile whose `school` is
 * only the denormalized string the faculty import wrote. Every one of those is
 * reported as blank rather than guessed at.
 */

import prisma from '@/lib/prisma'

export interface ReportRunner {
  userId: string
  name: string | null
  email: string | null
  employeeId: string | null
  designation: string | null
  department: string | null
  /** School (or whichever root unit the person hangs under), blank if unknown. */
  school: string | null
  orgUnitId: string | null
  /** The unit the person is actually placed in, which may be a department. */
  orgUnitName: string | null
  tenantId: string | null
}

export function emptyRunner(userId: string | null): ReportRunner {
  return {
    userId: userId || '',
    name: null,
    email: null,
    employeeId: null,
    designation: null,
    department: null,
    school: null,
    orgUnitId: null,
    orgUnitName: null,
    tenantId: null,
  }
}

/** Resolve `userIds` into runners, keyed by user id. Unknown ids are absent. */
export async function loadRunners(userIds: string[]): Promise<Map<string, ReportRunner>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (ids.length === 0) return new Map()

  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true, tenantId: true },
    }),
    prisma.researcherProfile.findMany({
      where: { user_id: { in: ids } },
      select: {
        user_id: true,
        employee_id: true,
        designation: true,
        department: true,
        school: true,
        org_unit_id: true,
        org_unit: { select: { id: true, name: true, depth: true, path: true } },
      },
    }),
  ])

  // A department's school is the root of its materialized path, so the label
  // stays right for a three-level tree (Faculty > School > Department) instead
  // of naming the department as the school.
  const rootIds = Array.from(
    new Set(
      profiles
        .map((profile) => profile.org_unit?.path?.[0])
        .filter((value): value is string => Boolean(value))
    )
  )
  const roots = rootIds.length
    ? await prisma.tenantOrgUnit.findMany({
        where: { id: { in: rootIds } },
        select: { id: true, name: true },
      })
    : []
  const rootNames = new Map(roots.map((root) => [root.id, root.name]))

  const profileByUser = new Map(profiles.map((profile) => [profile.user_id, profile]))

  const runners = new Map<string, ReportRunner>()
  for (const user of users) {
    const profile = profileByUser.get(user.id)
    const rootId = profile?.org_unit?.path?.[0] ?? null
    runners.set(user.id, {
      userId: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
      employeeId: profile?.employee_id ?? null,
      designation: profile?.designation ?? null,
      department: profile?.department ?? null,
      school: (rootId ? rootNames.get(rootId) ?? null : null) ?? profile?.school ?? null,
      orgUnitId: profile?.org_unit_id ?? null,
      orgUnitName: profile?.org_unit?.name ?? null,
      tenantId: user.tenantId ?? null,
    })
  }
  return runners
}

/**
 * Users whose name, email, employee id or school matches `search`.
 *
 * Needed because idea-intelligence runs have no user relation to filter
 * through: the people search is resolved to ids first, then folded into both
 * report queries.
 */
export async function findUserIdsMatching(
  search: string,
  tenantId: string | null
): Promise<string[]> {
  const contains = { contains: search, mode: 'insensitive' as const }
  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        OR: [{ name: contains }, { email: contains }],
      },
      select: { id: true },
    }),
    prisma.researcherProfile.findMany({
      where: {
        ...(tenantId ? { user: { tenantId } } : {}),
        OR: [
          { display_name: contains },
          { employee_id: contains },
          { school: contains },
          { department: contains },
          { org_unit: { name: contains } },
        ],
      },
      select: { user_id: true },
    }),
  ])

  return Array.from(new Set([...users.map((u) => u.id), ...profiles.map((p) => p.user_id)]))
}

/**
 * Members of an org unit's subtree.
 *
 * Falls back to the denormalized `school` name as well as the unit link,
 * because faculty imported before the org tree existed carry the school name
 * with a null `org_unit_id` — and a school filter that silently drops those
 * people would under-report the school it claims to describe.
 */
export async function findUserIdsInOrgUnit(orgUnitId: string): Promise<string[]> {
  const unit = await prisma.tenantOrgUnit.findUnique({
    where: { id: orgUnitId },
    select: { id: true, name: true, tenant_id: true },
  })
  if (!unit) return []

  const subtree = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: unit.tenant_id, path: { has: unit.id } },
    select: { id: true },
  })
  const unitIds = subtree.length ? subtree.map((row) => row.id) : [unit.id]

  const profiles = await prisma.researcherProfile.findMany({
    where: {
      OR: [
        { org_unit_id: { in: unitIds } },
        { org_unit_id: null, school: unit.name, user: { tenantId: unit.tenant_id } },
      ],
    },
    select: { user_id: true },
  })
  return Array.from(new Set(profiles.map((profile) => profile.user_id)))
}

/** Root org units (schools) of a tenant, for the archive's school filter. */
export async function loadSchools(tenantId: string | null) {
  if (!tenantId) return []
  return prisma.tenantOrgUnit.findMany({
    where: { tenant_id: tenantId, depth: 0, is_active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}
