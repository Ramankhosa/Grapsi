import { NextRequest, NextResponse } from 'next/server'
import { FeatureCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/middleware'
import { PRODUCT_MODULE_LIST, MODULE_FEATURE_CODES } from '@/lib/access/modules'

export const dynamic = 'force-dynamic'

const ALL_FEATURE_CODES = Object.values(FeatureCode) as FeatureCode[]

function isFeatureCode(value: unknown): value is FeatureCode {
  return typeof value === 'string' && (ALL_FEATURE_CODES as string[]).includes(value)
}

/**
 * GET — list every plan with its feature membership + quotas, plus the feature
 * catalog and product-module grouping the UI needs to render the plans board.
 */
export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'])(request)
  if (roleCheck) return roleCheck

  try {
    const [plans, features, tenantPlans] = await Promise.all([
      prisma.plan.findMany({
        include: { planFeatures: { include: { feature: true } } },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.feature.findMany({ orderBy: { code: 'asc' } }),
      prisma.tenantPlan.findMany({
        where: { status: 'ACTIVE' },
        include: {
          plan: { select: { id: true } },
          tenant: { select: { id: true, name: true, users: { select: { id: true } } } }
        }
      })
    ])

    const counts: Record<string, { tenantCount: number; userCount: number }> = {}
    for (const tp of tenantPlans) {
      const key = tp.plan.id
      if (!counts[key]) counts[key] = { tenantCount: 0, userCount: 0 }
      counts[key].tenantCount += 1
      counts[key].userCount += tp.tenant.users.length
    }

    const seededFeatureCodes = new Set(features.map((f) => f.code as string))

    const data = plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      cycle: plan.cycle,
      status: plan.status,
      isCustom: plan.code.startsWith('CUSTOM_'),
      tenantCount: counts[plan.id]?.tenantCount || 0,
      userCount: counts[plan.id]?.userCount || 0,
      features: plan.planFeatures.map((pf) => ({
        featureCode: pf.feature.code,
        dailyQuota: pf.dailyQuota,
        monthlyQuota: pf.monthlyQuota,
        dailyTokenLimit: pf.dailyTokenLimit,
        monthlyTokenLimit: pf.monthlyTokenLimit
      }))
    }))

    // Feature catalog covers all enum codes; flag those without a Feature row yet
    // (need a seed run) so the UI can warn rather than silently drop them.
    const featureCatalog = ALL_FEATURE_CODES.map((code) => {
      const row = features.find((f) => (f.code as string) === code)
      return {
        code,
        name: row?.name ?? code,
        unit: row?.unit ?? 'calls',
        seeded: seededFeatureCodes.has(code),
        isModuleFeature: (MODULE_FEATURE_CODES as string[]).includes(code)
      }
    })

    return NextResponse.json({
      plans: data,
      featureCatalog,
      modules: PRODUCT_MODULE_LIST.map((m) => ({
        key: m.key,
        name: m.name,
        description: m.description,
        featureCodes: m.featureCodes,
        minTier: m.minTier
      }))
    })
  } catch (error) {
    console.error('[admin/plans] GET error:', error)
    return NextResponse.json({ error: 'Failed to load plans' }, { status: 500 })
  }
}

/**
 * POST — create a plan (used for both catalog plans and per-tenant custom plans)
 * with an initial feature set. Optionally assign it to a tenant in one call
 * (custom-plan-for-tenant flow) by passing `assignTenantId`.
 */
export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'A plan name is required' }, { status: 400 })
    }

    const name: string = body.name.trim()
    const cycle: string = typeof body.cycle === 'string' && body.cycle.trim() ? body.cycle.trim() : 'MONTHLY'
    const rawFeatureCodes: unknown[] = Array.isArray(body.featureCodes) ? body.featureCodes : []
    const featureCodes = rawFeatureCodes.filter(isFeatureCode)
    const assignTenantId: string | null =
      typeof body.assignTenantId === 'string' && body.assignTenantId.trim() ? body.assignTenantId.trim() : null

    // Derive a stable, unique code. Custom (tenant-scoped) plans get a CUSTOM_ prefix.
    let code: string
    if (typeof body.code === 'string' && body.code.trim()) {
      code = body.code.trim().toUpperCase().replace(/[\s-]+/g, '_')
    } else {
      const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      code = assignTenantId ? `CUSTOM_${slug}_${assignTenantId.slice(-6).toUpperCase()}` : slug
    }

    const existing = await prisma.plan.findUnique({ where: { code } })
    if (existing) {
      return NextResponse.json({ error: `A plan with code ${code} already exists` }, { status: 409 })
    }

    const featureRows = featureCodes.length
      ? await prisma.feature.findMany({ where: { code: { in: featureCodes as any } }, select: { id: true } })
      : []

    const plan = await prisma.plan.create({
      data: {
        code,
        name,
        cycle,
        status: 'ACTIVE',
        planFeatures: {
          create: featureRows.map((f) => ({ featureId: f.id }))
        }
      }
    })

    // Optional: assign the new plan to a tenant immediately.
    let assignment: { assigned: boolean; error?: string } = { assigned: false }
    if (assignTenantId) {
      try {
        const { grantTenantEntitlement } = await import('@/lib/entitlement-service')
        await grantTenantEntitlement({
          tenantId: assignTenantId,
          planCode: code,
          source: 'SUPERADMIN_GRANT',
          sourceRef: `custom-plan:${plan.id}`,
          metadata: { reason: 'custom_plan_for_tenant', planId: plan.id }
        })
        assignment = { assigned: true }
      } catch (err) {
        assignment = { assigned: false, error: err instanceof Error ? err.message : 'assignment failed' }
      }
    }

    return NextResponse.json({ plan: { id: plan.id, code: plan.code, name: plan.name }, assignment }, { status: 201 })
  } catch (error) {
    console.error('[admin/plans] POST error:', error)
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
  }
}
