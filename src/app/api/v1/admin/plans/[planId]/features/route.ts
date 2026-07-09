import { NextRequest, NextResponse } from 'next/server'
import { FeatureCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/middleware'
import { clearPlanCache } from '@/lib/metering/model-resolver'

export const dynamic = 'force-dynamic'

const ALL_FEATURE_CODES = Object.values(FeatureCode) as FeatureCode[]

interface FeatureInput {
  featureCode: FeatureCode
  dailyQuota: number | null
  monthlyQuota: number | null
  dailyTokenLimit: number | null
  monthlyTokenLimit: number | null
}

function toNullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.floor(n))
}

/**
 * PUT — replace the plan's entire feature membership. This is how the super
 * admin adds/removes features from a plan: features present in the payload are
 * upserted (with quotas); features absent from the payload are removed from the
 * plan. NULL quota = unlimited.
 */
export async function PUT(request: NextRequest, { params }: { params: { planId: string } }) {
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const plan = await prisma.plan.findUnique({ where: { id: params.planId } })
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    if (!body || !Array.isArray(body.features)) {
      return NextResponse.json({ error: 'Expected { features: [...] }' }, { status: 400 })
    }

    const inputs: FeatureInput[] = []
    const seen = new Set<string>()
    for (const raw of body.features) {
      const code = raw?.featureCode
      if (typeof code !== 'string' || !(ALL_FEATURE_CODES as string[]).includes(code)) {
        return NextResponse.json({ error: `Invalid feature code: ${code}` }, { status: 400 })
      }
      if (seen.has(code)) continue
      seen.add(code)
      inputs.push({
        featureCode: code as FeatureCode,
        dailyQuota: toNullableInt(raw.dailyQuota),
        monthlyQuota: toNullableInt(raw.monthlyQuota),
        dailyTokenLimit: toNullableInt(raw.dailyTokenLimit),
        monthlyTokenLimit: toNullableInt(raw.monthlyTokenLimit)
      })
    }

    const featureRows = await prisma.feature.findMany({
      where: { code: { in: inputs.map((i) => i.featureCode) as any } },
      select: { id: true, code: true }
    })
    const featureIdByCode = new Map(featureRows.map((f) => [f.code as string, f.id]))

    const missing = inputs.filter((i) => !featureIdByCode.has(i.featureCode)).map((i) => i.featureCode)
    if (missing.length) {
      return NextResponse.json(
        {
          error: `These features have no catalog row yet — run the access-control seed first: ${missing.join(', ')}`,
          code: 'FEATURE_NOT_SEEDED'
        },
        { status: 409 }
      )
    }

    const keepFeatureIds = inputs.map((i) => featureIdByCode.get(i.featureCode)!)

    await prisma.$transaction([
      // Remove features no longer in the set
      prisma.planFeature.deleteMany({
        where: { planId: plan.id, featureId: { notIn: keepFeatureIds.length ? keepFeatureIds : ['__none__'] } }
      }),
      // Upsert the desired features + quotas
      ...inputs.map((i) => {
        const featureId = featureIdByCode.get(i.featureCode)!
        return prisma.planFeature.upsert({
          where: { planId_featureId: { planId: plan.id, featureId } },
          update: {
            dailyQuota: i.dailyQuota,
            monthlyQuota: i.monthlyQuota,
            dailyTokenLimit: i.dailyTokenLimit,
            monthlyTokenLimit: i.monthlyTokenLimit
          },
          create: {
            planId: plan.id,
            featureId,
            dailyQuota: i.dailyQuota,
            monthlyQuota: i.monthlyQuota,
            dailyTokenLimit: i.dailyTokenLimit,
            monthlyTokenLimit: i.monthlyTokenLimit
          }
        })
      })
    ])

    clearPlanCache(plan.id)

    return NextResponse.json({ success: true, featureCount: inputs.length })
  } catch (error) {
    console.error('[admin/plans/:id/features] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update plan features' }, { status: 500 })
  }
}
