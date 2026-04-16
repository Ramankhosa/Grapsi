/**
 * Trial Plan Management API
 * GET - Get current trial plan and default limits
 * POST - Seed/create the TRIAL plan (super admin only)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'
import { seedTrialPlan, DEFAULT_TRIAL_LIMITS } from '@/lib/trial-plan-service'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Missing token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Invalid token' }, { status: 401 })
    }

    // Only super admins can access
    if (!payload.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ code: 'FORBIDDEN', message: 'Super admin access required' }, { status: 403 })
    }

    // Get trial plan
    const plan = await prisma.plan.findUnique({
      where: { code: 'TRIAL' },
      include: {
        planFeatures: {
          include: { feature: true }
        }
      }
    })

    // Get trial tenant
    const trialTenant = await prisma.tenant.findFirst({
      where: { atiId: 'TRIAL' }
    })

    // Get trial user count
    const trialUserCount = trialTenant
      ? await prisma.user.count({ where: { tenantId: trialTenant.id } })
      : 0

    return NextResponse.json({
      planExists: !!plan,
      plan: plan ? {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        status: plan.status,
        features: plan.planFeatures.map(pf => ({
          featureCode: pf.feature.code,
          monthlyQuota: pf.monthlyQuota,
          dailyQuota: pf.dailyQuota,
          monthlyTokenLimit: pf.monthlyTokenLimit,
          dailyTokenLimit: pf.dailyTokenLimit
        }))
      } : null,
      defaultLimits: DEFAULT_TRIAL_LIMITS,
      trialTenant: trialTenant ? {
        id: trialTenant.id,
        name: trialTenant.name,
        userCount: trialUserCount
      } : null
    })
  } catch (error) {
    console.error('Get trial plan error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to get trial plan' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Missing token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Invalid token' }, { status: 401 })
    }

    // Only super admins can seed
    if (!payload.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ code: 'FORBIDDEN', message: 'Super admin access required' }, { status: 403 })
    }

    // Check if already exists
    const existing = await prisma.plan.findUnique({
      where: { code: 'TRIAL' }
    })

    if (existing) {
      return NextResponse.json(
        { message: 'TRIAL plan already exists', planId: existing.id },
        { status: 200 }
      )
    }

    // Seed the trial plan
    await seedTrialPlan()

    const plan = await prisma.plan.findUnique({
      where: { code: 'TRIAL' }
    })

    return NextResponse.json({
      message: 'TRIAL plan created successfully',
      planId: plan?.id
    }, { status: 201 })
  } catch (error) {
    console.error('Seed trial plan error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to seed trial plan' },
      { status: 500 }
    )
  }
}

