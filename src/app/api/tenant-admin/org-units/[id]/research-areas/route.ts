import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  TENANT_SCOPED_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
  requireTenantUser,
} from '@/lib/auth/tenantAccess'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic = 'force-dynamic'

/**
 * The discipline profile of one org unit — which research areas this school,
 * department or centre works in.
 *
 * Reading is open to any tenant user (the funding-department queue and the
 * structure page both need it); writing is tenant admin, like the rest of the
 * structure. Unlike headship this is not a privilege grant — it changes which
 * calls surface where, not who may do what — so it sits with the broader
 * TENANT_SCOPED_ADMIN_ROLES that own the org tree rather than TENANT_ADMIN_ROLES.
 */

const putSchema = z.object({
  taxonomyAreaIds: z.array(z.string().trim().min(1)).max(30),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  /** Where the confirmed selection came from, for provenance only. */
  source: z.enum(['manual', 'suggested_name', 'suggested_faculty']).default('manual'),
})

interface AreaRow {
  id: string
  taxonomy_area_id: string
  source: string
  created_at: Date
  level1_code: string
  level1_name: string
  level2_code: string
  level2_name: string
}

function serialize(row: AreaRow) {
  return {
    id: row.id,
    taxonomyAreaId: row.taxonomy_area_id,
    level1Code: row.level1_code,
    level1Name: row.level1_name,
    level2Code: row.level2_code,
    level2Name: row.level2_name,
    label: row.level2_name ? `${row.level1_name} → ${row.level2_name}` : row.level1_name,
    source: row.source,
    createdAt: row.created_at,
  }
}

async function listAreas(orgUnitId: string) {
  const rows = await prisma.$queryRaw<AreaRow[]>(Prisma.sql`
    SELECT ra.id, ra.taxonomy_area_id, ra.source, ra.created_at,
           area.level1_code, area.level1_name, area.level2_code, area.level2_name
      FROM tenant_org_unit_research_areas ra
      INNER JOIN research_area_taxonomy_areas area ON area.id = ra.taxonomy_area_id
     WHERE ra.org_unit_id = ${orgUnitId}
     ORDER BY area.sort_order ASC NULLS LAST, area.level1_name ASC, area.level2_name ASC
  `)
  return rows.map(serialize)
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: params.id, tenant_id: context.tenantId },
    select: { id: true, name: true, keywords: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  // Areas inherited from ancestors are shown read-only, so an admin can see
  // that a department is already covered by its school before adding anything.
  const inherited = await prisma.$queryRaw<Array<{ label: string; unit_name: string }>>(Prisma.sql`
    SELECT DISTINCT
      CASE WHEN area.level2_name <> '' THEN area.level1_name || ' → ' || area.level2_name
           ELSE area.level1_name END AS label,
      ancestor.name AS unit_name
      FROM tenant_org_units self
      CROSS JOIN LATERAL unnest(self.path) AS p(ancestor_id)
      INNER JOIN tenant_org_units ancestor ON ancestor.id = p.ancestor_id
      INNER JOIN tenant_org_unit_research_areas ra ON ra.org_unit_id = ancestor.id
      INNER JOIN research_area_taxonomy_areas area ON area.id = ra.taxonomy_area_id
     WHERE self.id = ${unit.id}
       AND ancestor.id <> self.id
     ORDER BY label ASC
  `)

  return NextResponse.json({
    unit: { id: unit.id, name: unit.name },
    areas: await listAreas(unit.id),
    keywords: unit.keywords || [],
    inherited,
  })
}

/**
 * Replaces the unit's areas and keywords in one call.
 *
 * A whole-set PUT rather than add/remove endpoints because the UI is a
 * multi-select: the admin's intent is "these are the areas", and expressing
 * that as a diff would invent an ordering problem the picker does not have.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: params.id, tenant_id: context.tenantId },
    select: { id: true, name: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  let payload
  try {
    payload = putSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const areaIds = Array.from(new Set(payload.taxonomyAreaIds))
  const keywords = Array.from(
    new Set((payload.keywords || []).map((keyword) => keyword.trim()).filter(Boolean))
  )

  if (areaIds.length > 0) {
    const found = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT area.id
        FROM research_area_taxonomy_areas area
        INNER JOIN research_area_taxonomy_uploads upload ON upload.id = area.upload_id
       WHERE area.id = ANY(ARRAY[${Prisma.join(areaIds.map((id) => Prisma.sql`${id}`))}]::text[])
         AND area.is_active = true
         AND upload.status = 'ACTIVE'
    `)
    if (found.length !== areaIds.length) {
      return NextResponse.json(
        { error: 'One or more selected research areas are not in the active catalog.' },
        { status: 400 }
      )
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM tenant_org_unit_research_areas WHERE org_unit_id = ${unit.id}
    `)

    for (const areaId of areaIds) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO tenant_org_unit_research_areas (
          id, tenant_id, org_unit_id, taxonomy_area_id, source, created_by_user_id, created_at
        )
        VALUES (
          ${`toura_${crypto.randomUUID().replace(/-/g, '')}`},
          ${context.tenantId},
          ${unit.id},
          ${areaId},
          ${payload.source},
          ${context.user.id},
          ${new Date()}
        )
        ON CONFLICT (org_unit_id, taxonomy_area_id) DO NOTHING
      `)
    }

    await tx.tenantOrgUnit.update({
      where: { id: unit.id },
      data: { keywords },
    })
  })

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: context.user.id,
        tenantId: context.tenantId,
        action: 'ORG_RESEARCH_AREAS_SET',
        resource: `tenant_org_unit:${unit.id}`,
        meta: {
          unitName: unit.name,
          areaCount: areaIds.length,
          keywordCount: keywords.length,
          source: payload.source,
        },
      },
    })
  } catch (err) {
    console.warn('Org research areas: audit log failed', err)
  }

  return NextResponse.json({
    unit: { id: unit.id, name: unit.name },
    areas: await listAreas(unit.id),
    keywords,
  })
}
