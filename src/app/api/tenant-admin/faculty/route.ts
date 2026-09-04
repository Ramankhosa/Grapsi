import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/lib/prisma-generated'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope, type TenantScopeContext } from '@/lib/auth/tenantAccess'
import { scopedProfileSql } from '@/lib/orgUnits/scope'
import { listSubtreeUnitIds } from '@/lib/orgUnits/tree'

export const dynamic = 'force-dynamic'

/**
 * Faculty roster for the caller's tenant.
 *
 * Raw SQL because the embedding columns are Unsupported() in Prisma and we want
 * to surface whether each profile is actually matchable.
 *
 * LEFT JOIN on researcher_profiles: seeded users get a profile row at import
 * time, but self-signup (ATI) users have none until they fill one in — they
 * must still appear here, e.g. in the funding-department member picker.
 */

/** The tenant + "is faculty" predicate every query on this route shares. */
function baseScopeConditions(context: TenantScopeContext): Prisma.Sql[] {
  return [
    Prisma.sql`u."tenantId" = ${context.tenantId}`,
    // Platform staff attached to a tenant are not faculty.
    Prisma.sql`NOT (u.roles && ARRAY['SUPER_ADMIN','SUPER_ADMIN_VIEWER']::"UserRole"[])`,
  ]
}

const andAll = (conditions: Prisma.Sql[]) =>
  conditions.reduce(
    (combined, condition, index) =>
      index === 0 ? condition : Prisma.sql`${combined} AND ${condition}`,
    Prisma.sql`TRUE`
  )

export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  // Deny by default: tenant-wide callers see everyone, a caller with managed
  // scope (department coverage or an org-unit grant) sees that branch, and
  // anyone else gets nothing — the roster carries emails and employee IDs, so
  // "no scope" must mean "no rows", not "all rows". Checked up front so the
  // facet lists below inherit exactly the same fence.
  if (!context.scope.isTenantWide && !context.scope.isHead) {
    return NextResponse.json(
      { error: 'You do not have access to the faculty roster.' },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(request.url)
  const search = (searchParams.get('q') || '').trim()
  const orgUnitId = (searchParams.get('orgUnitId') || '').trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)
  // Activation filter: 'activated' | 'pending' | 'noid' | '' (all).
  const access = (searchParams.get('access') || '').trim()
  // Field filters. School / department / designation match the denormalized
  // profile text, which is what the facet lists are built from, so a value
  // picked from a dropdown always matches the rows it was counted over —
  // org_unit_id placement can be missing on rows imported without a tree.
  const school = (searchParams.get('school') || '').trim()
  const department = (searchParams.get('department') || '').trim()
  const designation = (searchParams.get('designation') || '').trim()
  const employeeId = (searchParams.get('employeeId') || '').trim()
  const researchArea = (searchParams.get('researchArea') || '').trim()
  // 'yes' = has an embedding, i.e. can actually be matched to a call.
  const matchable = (searchParams.get('matchable') || '').trim()
  // Current workload: 'free' = nothing live, 'busy' = anything live. Answers
  // "who can take this on" without leaving the roster.
  const load = (searchParams.get('load') || '').trim()
  const sort = (searchParams.get('sort') || 'name').trim()

  // Live assignments the person is actually carrying right now. A correlated
  // subquery rather than a join so the LEFT JOIN above keeps returning one row
  // per user, and so the count can be filtered and sorted on.
  const LIVE_ASSIGNMENTS = Prisma.sql`(
    SELECT COUNT(*)::int
    FROM call_assignments ca
    WHERE ca.assignee_user_id = u.id
      AND ca.tenant_id = u."tenantId"
      AND ca.status IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS')
  )`
  const LAST_ASSIGNED = Prisma.sql`(
    SELECT MAX(ca.created_at)
    FROM call_assignments ca
    WHERE ca.assignee_user_id = u.id AND ca.tenant_id = u."tenantId"
  )`

  const conditions = baseScopeConditions(context)

  if (search) {
    const like = `%${search}%`
    conditions.push(Prisma.sql`(
      COALESCE(rp.display_name, u.name, '') ILIKE ${like}
      OR u.email ILIKE ${like}
      OR COALESCE(rp.department, '') ILIKE ${like}
      OR COALESCE(rp.school, '') ILIKE ${like}
      OR COALESCE(rp.designation, '') ILIKE ${like}
      OR COALESCE(rp.employee_id, '') ILIKE ${like}
    )`)
  }
  // Selecting a unit shows everyone at or beneath it — picking a school used to
  // return only the handful of rows attached to the school itself.
  if (orgUnitId) {
    const subtreeIds = await listSubtreeUnitIds(context.tenantId, [orgUnitId])
    conditions.push(
      subtreeIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`rp.org_unit_id = ANY(ARRAY[${Prisma.join(
            subtreeIds.map((id) => Prisma.sql`${id}`)
          )}]::text[])`
    )
  }
  if (school) {
    conditions.push(Prisma.sql`LOWER(COALESCE(rp.school, '')) = LOWER(${school})`)
  }
  if (department) {
    conditions.push(Prisma.sql`LOWER(COALESCE(rp.department, '')) = LOWER(${department})`)
  }
  if (designation) {
    conditions.push(Prisma.sql`LOWER(COALESCE(rp.designation, '')) = LOWER(${designation})`)
  }
  if (employeeId) {
    conditions.push(Prisma.sql`COALESCE(rp.employee_id, '') ILIKE ${`%${employeeId}%`}`)
  }
  if (researchArea) {
    // Substring over both arrays: research areas are free text, so "machine
    // learning" has to find "Applied Machine Learning" too.
    const like = `%${researchArea}%`
    conditions.push(Prisma.sql`(
      EXISTS (
        SELECT 1 FROM unnest(COALESCE(rp.research_areas, ARRAY[]::text[])) AS area
        WHERE area ILIKE ${like}
      )
      OR EXISTS (
        SELECT 1 FROM unnest(COALESCE(rp.keywords, ARRAY[]::text[])) AS kw
        WHERE kw ILIKE ${like}
      )
    )`)
  }
  if (matchable === 'yes') {
    conditions.push(Prisma.sql`(rp.embedding IS NOT NULL OR rp.embedding_voyage_1024 IS NOT NULL)`)
  } else if (matchable === 'no') {
    conditions.push(Prisma.sql`(rp.embedding IS NULL AND rp.embedding_voyage_1024 IS NULL)`)
  }
  if (load === 'free') {
    conditions.push(Prisma.sql`${LIVE_ASSIGNMENTS} = 0`)
  } else if (load === 'busy') {
    conditions.push(Prisma.sql`${LIVE_ASSIGNMENTS} > 0`)
  }

  if (!context.scope.isTenantWide) {
    conditions.push(scopedProfileSql(context.scope))
  }

  // The distinct values actually present in the caller's slice of the roster,
  // so a filter dropdown never offers a school or designation that would come
  // back empty. Scoped to tenant + reach only, deliberately NOT to the other
  // active filters, so the lists stay put while the user filters.
  if (searchParams.get('action') === 'facets') {
    const facetConditions = baseScopeConditions(context)
    if (!context.scope.isTenantWide) {
      facetConditions.push(scopedProfileSql(context.scope))
    }
    const facetRows = await prisma.$queryRaw<
      Array<{ school: string | null; department: string | null; designation: string | null }>
    >(Prisma.sql`
      SELECT DISTINCT rp.school, rp.department, rp.designation
      FROM users u
      LEFT JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE ${andAll(facetConditions)}
    `)

    const distinct = (key: 'school' | 'department' | 'designation') =>
      Array.from(
        new Set(facetRows.map((row) => (row[key] || '').trim()).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right))

    // Departments keyed by school so the department list narrows once a school
    // is picked, the same way the matching screen's facets behave.
    const departmentsBySchool: Record<string, string[]> = {}
    for (const row of facetRows) {
      const schoolName = (row.school || '').trim()
      const departmentName = (row.department || '').trim()
      if (!schoolName || !departmentName) continue
      const list = departmentsBySchool[schoolName] || []
      if (!list.includes(departmentName)) list.push(departmentName)
      departmentsBySchool[schoolName] = list
    }
    for (const key of Object.keys(departmentsBySchool)) {
      departmentsBySchool[key].sort((left, right) => left.localeCompare(right))
    }

    return NextResponse.json({
      schools: distinct('school'),
      departments: distinct('department'),
      designations: distinct('designation'),
      departmentsBySchool,
    })
  }

  // Base filters (tenant + search + unit + field filters + head scope) — the
  // status counts use this so they stay stable while the admin toggles the
  // access filter.
  const baseWhere = andAll(conditions)

  // "Pending" = seeded (no password) but has an Employee ID, so they can
  // self-activate. "No ID" = seeded and no Employee ID, so they cannot.
  // How many publications this person has marked for funding matching. A count,
  // not the rows: the directory is a list of eighty people, and the titles only
  // matter once somebody opens one.
  const PUBLICATION_COUNT = Prisma.sql`(
    SELECT COUNT(*)::int
    FROM reference_library ref
    WHERE ref.user_id = u.id AND ref."isActive" = true AND 'my-publication' = ANY(ref.tags)
  )`

  const HAS_EMPLOYEE_ID = Prisma.sql`rp.employee_id IS NOT NULL AND rp.employee_id <> ''`
  const accessCondition =
    access === 'activated'
      ? Prisma.sql`u."passwordHash" IS NOT NULL`
      : access === 'pending'
        ? Prisma.sql`u."passwordHash" IS NULL AND ${HAS_EMPLOYEE_ID}`
        : access === 'noid'
          ? Prisma.sql`u."passwordHash" IS NULL AND NOT (${HAS_EMPLOYEE_ID})`
          : null

  const where = accessCondition ? Prisma.sql`${baseWhere} AND (${accessCondition})` : baseWhere

  // Busiest-first is how you spot an overloaded professor; quietest-first is how
  // you find someone with capacity. Name stays the default.
  const NAME_ORDER = Prisma.sql`COALESCE(rp.display_name, u.name, u.email) ASC`
  const orderBy =
    sort === 'load'
      ? Prisma.sql`${LIVE_ASSIGNMENTS} DESC, ${NAME_ORDER}`
      : sort === 'load-asc'
        ? Prisma.sql`${LIVE_ASSIGNMENTS} ASC, ${NAME_ORDER}`
        : NAME_ORDER

  const [rows, totals, statusCounts] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        userId: string
        email: string
        name: string
        employeeId: string | null
        school: string | null
        department: string | null
        designation: string | null
        researchAreas: string[]
        keywords: string[]
        orgUnitId: string | null
        hasEmbedding: boolean
        googleScholarUrl: string | null
        scopusUrl: string | null
        orcidUrl: string | null
        linkedinUrl: string | null
        publicationCount: number
        activated: boolean
        liveAssignments: number
        lastAssignedAt: Date | null
      }>
    >(Prisma.sql`
      SELECT
        u.id AS "userId",
        u.email,
        COALESCE(rp.display_name, u.name, '') AS name,
        rp.employee_id AS "employeeId",
        rp.school,
        rp.department,
        rp.designation,
        COALESCE(rp.research_areas, ARRAY[]::text[]) AS "researchAreas",
        COALESCE(rp.keywords, ARRAY[]::text[]) AS keywords,
        rp.org_unit_id AS "orgUnitId",
        (rp.embedding IS NOT NULL OR rp.embedding_voyage_1024 IS NOT NULL) AS "hasEmbedding",
        rp.google_scholar_url AS "googleScholarUrl",
        rp.scopus_url AS "scopusUrl",
        rp.orcid_url AS "orcidUrl",
        rp.linkedin_url AS "linkedinUrl",
        ${PUBLICATION_COUNT} AS "publicationCount",
        (u."passwordHash" IS NOT NULL) AS activated,
        ${LIVE_ASSIGNMENTS} AS "liveAssignments",
        ${LAST_ASSIGNED} AS "lastAssignedAt"
      FROM users u
      LEFT JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<[{ total: bigint; embedded: bigint }]>(Prisma.sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (
          WHERE rp.embedding IS NOT NULL OR rp.embedding_voyage_1024 IS NOT NULL
        ) AS embedded
      FROM users u
      LEFT JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE ${where}
    `),
    // Activation breakdown over the BASE filter (ignores the access toggle) so
    // the chips show stable totals as the admin switches between them.
    prisma.$queryRaw<[{ activated: bigint; pending: bigint; noid: bigint }]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE u."passwordHash" IS NOT NULL) AS activated,
        COUNT(*) FILTER (WHERE u."passwordHash" IS NULL AND ${HAS_EMPLOYEE_ID}) AS pending,
        COUNT(*) FILTER (WHERE u."passwordHash" IS NULL AND NOT (${HAS_EMPLOYEE_ID})) AS noid
      FROM users u
      LEFT JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE ${baseWhere}
    `),
  ])

  return NextResponse.json({
    faculty: rows,
    total: Number(totals[0]?.total || 0),
    activatedCount: Number(statusCounts[0]?.activated || 0),
    pendingCount: Number(statusCounts[0]?.pending || 0),
    noIdCount: Number(statusCounts[0]?.noid || 0),
    embedded: Number(totals[0]?.embedded || 0),
    limit,
    offset,
  })
}
