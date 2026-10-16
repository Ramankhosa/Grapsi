import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { requireRecommendationUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'

export const runtime = 'nodejs'

const MAX_RESULTS = 15
const MAX_IDS = 20

type FunderRow = {
  id: string
  name: string
  acronym: string | null
  countryCode: string | null
  callCount: number
}

/**
 * Funder typeahead for the finder's funder filter.
 *
 *   GET ?q=nih     funders whose name, acronym or alias matches, with at least
 *                  one published call this user can see, most calls first
 *   GET ?ids=a,b   names for funder ids already in a filter (chip labels)
 *
 * Counts only calls the caller could find in the finder: global published,
 * the imported catalogue, and their own tenant's published calls.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }
  const access = toRecommendationAccessScope(auth.actor)
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim().slice(0, 80)
  const ids = (searchParams.get('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{6,64}$/.test(id))
    .slice(0, MAX_IDS)

  if (q.length < 2 && ids.length === 0) {
    return NextResponse.json({ funders: [] })
  }

  const visibleCall = access?.tenantId
    ? Prisma.sql`(c.visibility = 'GLOBAL_PUBLISHED' OR c.visibility = 'GLOBAL_CATALOG' OR (c.visibility = 'TENANT_PRIVATE' AND c."tenantId" = ${access.tenantId}))`
    : Prisma.sql`(c.visibility = 'GLOBAL_PUBLISHED' OR c.visibility = 'GLOBAL_CATALOG')`
  const callCount = Prisma.sql`(
    SELECT COUNT(*)::int FROM funding_calls c
    WHERE c.funder_id = f.id
      AND (c.status = 'PUBLISHED' OR c.catalog_status = 'PUBLISHED')
      AND COALESCE(c.is_active, true) = true
      AND ${visibleCall}
  )`

  try {
    if (ids.length > 0) {
      const rows = await prisma.$queryRaw<FunderRow[]>(Prisma.sql`
        SELECT f.id, f.name, f.acronym, f.country_code AS "countryCode", ${callCount} AS "callCount"
        FROM funders f
        WHERE f.id IN (${Prisma.join(ids)})
      `)
      return NextResponse.json({ funders: rows })
    }

    // ILIKE wildcards in the user's text are matched literally.
    const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    const rows = await prisma.$queryRaw<FunderRow[]>(Prisma.sql`
      SELECT * FROM (
        SELECT f.id, f.name, f.acronym, f.country_code AS "countryCode", ${callCount} AS "callCount"
        FROM funders f
        WHERE f.name ILIKE ${pattern}
           OR f.acronym ILIKE ${pattern}
           OR EXISTS (SELECT 1 FROM unnest(f.aliases) AS alias WHERE alias ILIKE ${pattern})
      ) matched
      WHERE "callCount" > 0
      ORDER BY (LOWER(acronym) = LOWER(${q})) DESC NULLS LAST, "callCount" DESC, name ASC
      LIMIT ${MAX_RESULTS}
    `)
    return NextResponse.json({ funders: rows })
  } catch (error) {
    console.error('Funder lookup failed', error)
    return NextResponse.json({ error: 'Could not look up funders.' }, { status: 500 })
  }
}
