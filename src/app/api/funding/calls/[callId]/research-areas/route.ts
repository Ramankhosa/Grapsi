import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantUser } from '@/lib/auth/tenantAccess'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic = 'force-dynamic'

/**
 * A human's correction to how a call was classified.
 *
 * The classifier is right most of the time and wrong some of the time, and
 * until now being wrong could only be fixed in SQL. This is that fix — but it
 * carries a boundary that matters more than the feature itself.
 *
 * A call's classification row has NO tenant column: it is global. So editing
 * the areas of a call the platform shares would change what EVERY university
 * sees. Only a platform administrator may do that. A tenant administrator may
 * correct their own tenant's calls, because nobody else can see them.
 *
 * A tenant that disagrees about a SHARED call does not edit it. They mark that
 * call RELEVANT (or NOT_RELEVANT) for one of their schools through the queue's
 * triage, which changes their own view and nobody else's.
 *
 * Rows written here carry `source: 'manual'`, which mergeAutoMappings treats as
 * untouchable — a correction survives re-classification, including a forced
 * re-run after the catalog is replaced.
 */

const putSchema = z.object({
  taxonomyAreaIds: z.array(z.string().trim().min(1)).max(12),
})

type Authorized = { ok: true } | { ok: false; error: string; status: number }

/** Who may rewrite this call's classification — and, when not, what to do instead. */
function authorize(
  context: { user: { id: string; roles?: string[] | null }; tenantId: string; isAdmin: boolean },
  call: { tenantId: string | null }
): Authorized {
  const roles = context.user.roles || []
  if (roles.includes('SUPER_ADMIN')) return { ok: true }

  const isTenantAdmin =
    context.isAdmin || roles.some((role) => ['OWNER', 'ADMIN', 'CALL_ADMIN'].includes(role))
  if (!isTenantAdmin) {
    return { ok: false, error: 'You do not have permission to change this.', status: 403 }
  }

  // The boundary. A shared call belongs to the platform, not to any one
  // institution, and every institution reads its classification.
  if (call.tenantId !== context.tenantId) {
    return {
      ok: false,
      error:
        'This call is shared across institutions, so only a platform administrator can change its disciplines. To put it in one of your schools, open it from your queue and mark it as belonging to that school.',
      status: 403,
    }
  }
  return { ok: true }
}

async function loadCall(callId: string) {
  return prisma.fundingCall.findUnique({
    where: { id: callId },
    select: { id: true, tenantId: true, title: true, scheme_title: true },
  })
}

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const call = await loadCall(params.callId)
  if (!call) {
    return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })
  }

  const rows = await prisma.fundingCallResearchAreaTaxonomy.findMany({
    where: { funding_call_id: call.id },
    select: {
      id: true,
      taxonomy_area_id: true,
      taxonomy_level1_name: true,
      taxonomy_level2_name: true,
      source: true,
      confidence: true,
      created_at: true,
      created_by: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ source: 'asc' }, { created_at: 'asc' }],
  })

  const permission = authorize(context, call)

  return NextResponse.json({
    call: {
      id: call.id,
      title: call.scheme_title || call.title,
      isShared: call.tenantId !== context.tenantId,
    },
    canEdit: permission.ok,
    readOnlyReason: permission.ok ? null : permission.error,
    areas: rows.map((row) => ({
      id: row.id,
      taxonomyAreaId: row.taxonomy_area_id,
      label: row.taxonomy_level2_name
        ? `${row.taxonomy_level1_name} → ${row.taxonomy_level2_name}`
        : row.taxonomy_level1_name,
      isGroup: !row.taxonomy_level2_name,
      source: row.source,
      confidence: row.confidence,
      author: row.created_by?.name || row.created_by?.email || null,
      createdAt: row.created_at,
    })),
  })
}

export async function PUT(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const call = await loadCall(params.callId)
  if (!call) {
    return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })
  }

  const permission = authorize(context, call)
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status })
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

  const wanted = Array.from(new Set(payload.taxonomyAreaIds))

  // Only areas from the ACTIVE catalog. An archived area is invisible to every
  // relevance query, so accepting one would silently do nothing at all.
  const areas =
    wanted.length > 0
      ? await prisma.$queryRaw<
          Array<{
            id: string
            level1_code: string
            level1_name: string
            level2_code: string
            level2_name: string
          }>
        >(Prisma.sql`
          SELECT a.id, a.level1_code, a.level1_name, a.level2_code, a.level2_name
            FROM research_area_taxonomy_areas a
            INNER JOIN research_area_taxonomy_uploads u ON u.id = a.upload_id
           WHERE u.status = 'ACTIVE'
             AND a.id = ANY(ARRAY[${Prisma.join(
               wanted.map((id) => Prisma.sql`${id}`)
             )}]::text[])
        `)
      : []

  if (areas.length !== wanted.length) {
    return NextResponse.json(
      { error: 'One or more of those research areas is not in the active catalog.' },
      { status: 400 }
    )
  }

  await prisma.$transaction(async (tx) => {
    // Replace the manual layer wholesale and leave the machine's rows alone.
    // Relevance reads the union of both, so removing a manual row restores
    // whatever the classifier had decided rather than blanking the call.
    await tx.fundingCallResearchAreaTaxonomy.deleteMany({
      where: { funding_call_id: call.id, source: 'manual' },
    })

    for (const area of areas) {
      // An area the classifier already chose gets promoted to `manual` rather
      // than duplicated — the unique key is (call, area).
      await tx.fundingCallResearchAreaTaxonomy.upsert({
        where: {
          funding_call_id_taxonomy_area_id: {
            funding_call_id: call.id,
            taxonomy_area_id: area.id,
          },
        },
        create: {
          funding_call_id: call.id,
          taxonomy_area_id: area.id,
          taxonomy_level1_code: area.level1_code,
          taxonomy_level1_name: area.level1_name,
          taxonomy_level2_code: area.level2_code,
          taxonomy_level2_name: area.level2_name,
          source: 'manual',
          confidence: null,
          created_by_user_id: context.user.id,
        },
        update: {
          source: 'manual',
          confidence: null,
          created_by_user_id: context.user.id,
        },
      })
    }
  })

  return NextResponse.json({ ok: true, manualAreas: areas.length })
}
