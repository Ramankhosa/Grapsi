import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/lib/prisma-generated'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { scopedProfileSql } from '@/lib/orgUnits/scope'
import { listSubtreeUnitIds } from '@/lib/orgUnits/tree'

export const dynamic = 'force-dynamic'

/**
 * Faculty roster for the caller's tenant.
 *
 * Raw SQL because the embedding columns are Unsupported() in Prisma and we want
 * to surface whether each profile is actually matchable.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)
  const search = (searchParams.get('q') || '').trim()
  const orgUnitId = (searchParams.get('orgUnitId') || '').trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  const conditions: Prisma.Sql[] = [Prisma.sql`u."tenantId" = ${context.tenantId}`]

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

  // A head sees their own branch of the roster; tenant-wide callers see all.
  if (!context.scope.isTenantWide && context.scope.isHead) {
    conditions.push(scopedProfileSql(context.scope))
  }

  const where = conditions.reduce(
    (combined, condition, index) => (index === 0 ? condition : Prisma.sql`${combined} AND ${condition}`),
    Prisma.sql`TRUE`
  )

  const [rows, totals] = await Promise.all([
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
        (rp.embedding IS NOT NULL OR rp.embedding_voyage_1024 IS NOT NULL) AS "hasEmbedding"
      FROM researcher_profiles rp
      JOIN users u ON u.id = rp.user_id
      WHERE ${where}
      ORDER BY COALESCE(rp.display_name, u.name, u.email) ASC
      LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<[{ total: bigint; embedded: bigint }]>(Prisma.sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (
          WHERE rp.embedding IS NOT NULL OR rp.embedding_voyage_1024 IS NOT NULL
        ) AS embedded
      FROM researcher_profiles rp
      JOIN users u ON u.id = rp.user_id
      WHERE ${where}
    `),
  ])

  return NextResponse.json({
    faculty: rows,
    total: Number(totals[0]?.total || 0),
    embedded: Number(totals[0]?.embedded || 0),
    limit,
    offset,
  })
}
