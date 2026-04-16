import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/middleware'

export const dynamic = 'force-dynamic'

const FEATURE_CODES = [
  'PRIOR_ART_SEARCH',
  'PATENT_DRAFTING',
  'IDEA_BANK',
  'DIAGRAM_GENERATION',
  'PERSONA_SYNC',
  'PATENT_REVIEW',
  'IDEATION',
  'FUNDING_DISCOVERY',
  'GRANT_PREP',
  'GRANT_DRAFTING',
] as const
const PLAN_CODES = ['FREE_PLAN', 'PRO_PLAN', 'ENTERPRISE_PLAN'] as const

type FeatureCode = (typeof FEATURE_CODES)[number]
type PlanCode = (typeof PLAN_CODES)[number]

export async function GET(request: NextRequest) {
  // Allow both SUPER_ADMIN and SUPER_ADMIN_VIEWER to view plan quotas
  const roleCheck = await requireRole(['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'])(request)
  if (roleCheck) return roleCheck

  try {
    const plans = await prisma.plan.findMany({
      where: {
        code: {
          in: PLAN_CODES as any
        }
      },
      include: {
        planFeatures: {
          include: {
            feature: true
          }
        }
      }
    })

    // Preload tenant + user counts per plan for context
    const tenantPlans = await prisma.tenantPlan.findMany({
      where: {
        plan: {
          code: {
            in: PLAN_CODES as any
          }
        },
        status: 'ACTIVE'
      },
      include: {
        plan: true,
        tenant: {
          select: {
            id: true,
            users: {
              select: { id: true }
            }
          }
        }
      }
    })

    const planTenantCounts: Record<string, { tenantCount: number; userCount: number }> = {}

    for (const tp of tenantPlans) {
      const planCode = tp.plan.code
      if (!planTenantCounts[planCode]) {
        planTenantCounts[planCode] = { tenantCount: 0, userCount: 0 }
      }
      planTenantCounts[planCode].tenantCount += 1
      planTenantCounts[planCode].userCount += tp.tenant.users.length
    }

    const data = plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      tenantCount: planTenantCounts[plan.code]?.tenantCount || 0,
      userCount: planTenantCounts[plan.code]?.userCount || 0,
      features: FEATURE_CODES.map((code) => {
        const pf = plan.planFeatures.find((f) => f.feature.code === code)
        return {
          featureCode: code,
          dailyQuota: pf?.dailyQuota ?? 0,
          monthlyQuota: pf?.monthlyQuota ?? 0,
          // Token limits (used by IDEATION feature for dual quota enforcement)
          dailyTokenLimit: (pf as any)?.dailyTokenLimit ?? null,
          monthlyTokenLimit: (pf as any)?.monthlyTokenLimit ?? null
        }
      })
    }))

    return NextResponse.json({ plans: data })
  } catch (error) {
    console.error('[plan-quotas] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load plan quotas' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  // Only full SUPER_ADMIN can modify plan quotas
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const body = await request.json().catch(() => null)

    if (!body || !Array.isArray(body.updates)) {
      return NextResponse.json(
        { error: 'Invalid payload: expected { updates: [...] }' },
        { status: 400 }
      )
    }

    const updates: Array<{
      planCode: PlanCode
      featureCode: FeatureCode
      dailyQuota: number
      monthlyQuota: number
    }> = []

    for (const raw of body.updates) {
      if (
        !PLAN_CODES.includes(raw.planCode) ||
        !FEATURE_CODES.includes(raw.featureCode) ||
        typeof raw.dailyQuota !== 'number' ||
        typeof raw.monthlyQuota !== 'number'
      ) {
        return NextResponse.json(
          { error: 'Invalid update entry in payload' },
          { status: 400 }
        )
      }

      updates.push({
        planCode: raw.planCode,
        featureCode: raw.featureCode,
        dailyQuota: Math.max(0, Math.floor(raw.dailyQuota)),
        monthlyQuota: Math.max(0, Math.floor(raw.monthlyQuota))
      })
    }

    // Load referenced plans and features once
    const [plans, features] = await Promise.all([
      prisma.plan.findMany({
        where: { code: { in: PLAN_CODES as any } },
        select: { id: true, code: true }
      }),
      prisma.feature.findMany({
        where: { code: { in: FEATURE_CODES as any } },
        select: { id: true, code: true }
      })
    ])

    const planByCode = Object.fromEntries(plans.map((p) => [p.code, p]))
    const featureByCode = Object.fromEntries(features.map((f) => [f.code, f]))

    for (const u of updates) {
      const plan = planByCode[u.planCode]
      const feature = featureByCode[u.featureCode]

      if (!plan || !feature) {
        console.warn(
          '[plan-quotas] Skipping update, missing plan/feature:',
          u.planCode,
          u.featureCode
        )
        continue
      }

      await prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plan.id,
            featureId: feature.id
          }
        },
        update: {
          dailyQuota: u.dailyQuota,
          monthlyQuota: u.monthlyQuota
        },
        create: {
          planId: plan.id,
          featureId: feature.id,
          dailyQuota: u.dailyQuota,
          monthlyQuota: u.monthlyQuota
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[plan-quotas] PUT error:', error)
    return NextResponse.json(
      { error: 'Failed to update plan quotas' },
      { status: 500 }
    )
  }
}
