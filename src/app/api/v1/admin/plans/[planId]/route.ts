import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/middleware'

export const dynamic = 'force-dynamic'

const VALID_STATUS = ['ACTIVE', 'INACTIVE', 'DEPRECATED'] as const

/** PATCH — rename a plan or change its cycle/status (code is immutable). */
export async function PATCH(request: NextRequest, { params }: { params: { planId: string } }) {
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const plan = await prisma.plan.findUnique({ where: { id: params.planId } })
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const data: { name?: string; cycle?: string; status?: (typeof VALID_STATUS)[number] } = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if (typeof body.cycle === 'string' && body.cycle.trim()) data.cycle = body.cycle.trim()
    if (typeof body.status === 'string') {
      if (!VALID_STATUS.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      data.status = body.status
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    const updated = await prisma.plan.update({ where: { id: plan.id }, data })
    return NextResponse.json({ plan: { id: updated.id, code: updated.code, name: updated.name, status: updated.status } })
  } catch (error) {
    console.error('[admin/plans/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
  }
}

/**
 * DELETE — remove a plan. Blocked when active tenant plans reference it; the
 * caller should reassign those tenants first. Prefer DEPRECATED status for
 * catalog plans; deletion is intended for unused custom plans.
 */
export async function DELETE(request: NextRequest, { params }: { params: { planId: string } }) {
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const plan = await prisma.plan.findUnique({ where: { id: params.planId } })
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const activeTenantPlans = await prisma.tenantPlan.count({
      where: { planId: plan.id, status: 'ACTIVE' }
    })
    if (activeTenantPlans > 0) {
      return NextResponse.json(
        {
          error: `Plan is assigned to ${activeTenantPlans} active tenant(s). Reassign them before deleting, or set the plan to DEPRECATED.`,
          code: 'PLAN_IN_USE'
        },
        { status: 409 }
      )
    }

    // Remove feature membership then the plan (avoids FK violations). Historical
    // tenant plans (non-active) keep referencing the plan, so only delete when
    // there are none at all.
    const anyTenantPlans = await prisma.tenantPlan.count({ where: { planId: plan.id } })
    if (anyTenantPlans > 0) {
      return NextResponse.json(
        {
          error: 'Plan has historical tenant assignments. Set it to DEPRECATED instead of deleting.',
          code: 'PLAN_HAS_HISTORY'
        },
        { status: 409 }
      )
    }

    await prisma.$transaction([
      prisma.planFeature.deleteMany({ where: { planId: plan.id } }),
      prisma.plan.delete({ where: { id: plan.id } })
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/plans/:id] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete plan' }, { status: 500 })
  }
}
