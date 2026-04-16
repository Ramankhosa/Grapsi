/**
 * Super Admin Service Control API
 * 
 * Comprehensive endpoint for managing service quotas, monitoring usage,
 * and controlling access across all tenants and plans.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { 
  getTenantServiceUsage, 
  getTenantUserUsage, 
  getTenantCostBreakdown,
  resetUsageCounters 
} from '@/lib/service-usage-tracker'
import type { ServiceType } from '@prisma/client'

// Verify super admin access
async function verifySuperAdmin(request: NextRequest) {
  const authResult = await authenticateUser(request)
  if (!authResult.user) {
    return { error: 'Unauthorized', status: 401 }
  }
  
  const isSuperAdmin = authResult.user.roles?.some(
    (role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER'
  )
  
  if (!isSuperAdmin) {
    return { error: 'Super admin access required', status: 403 }
  }
  
  return { user: authResult.user }
}

/**
 * GET - Retrieve service control data
 * Query params:
 * - action: 'dashboard' | 'plans' | 'tenant_usage' | 'cost_breakdown'
 * - tenantId: (optional) specific tenant for detailed view
 */
export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'dashboard'
  const tenantId = searchParams.get('tenantId')
  
  try {
    switch (action) {
      case 'dashboard':
        return await getDashboardData()
      
      case 'plans':
        return await getPlansWithQuotas()
      
      case 'tenant_usage':
        if (!tenantId) {
          return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
        }
        return await getTenantUsageData(tenantId)
      
      case 'cost_breakdown':
        if (!tenantId) {
          return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
        }
        return await getCostBreakdownData(tenantId)
      
      case 'all_tenants':
        return await getAllTenantsUsage()
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[SuperAdmin/ServiceControl] GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST - Modify service control settings
 * Body:
 * - action: 'update_plan_quota' | 'create_plan' | 'reset_usage'
 */
export async function POST(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  
  // Verify write access (not viewer)
  const isViewer = auth.user.roles?.includes('SUPER_ADMIN_VIEWER') && 
    !auth.user.roles?.includes('SUPER_ADMIN')
  
  if (isViewer) {
    return NextResponse.json(
      { error: 'Write access required. You have viewer-only access.' },
      { status: 403 }
    )
  }
  
  try {
    const body = await request.json()
    const { action } = body
    
    switch (action) {
      case 'update_plan_quota':
        return await updatePlanQuota(body)
      
      case 'create_plan':
        return await createPlan(body)
      
      case 'update_plan':
        return await updatePlan(body)
      
      case 'reset_usage':
        return await resetTenantUsage(body, auth.user.id)
      
      case 'update_model_cost':
        return await updateModelCost(body)
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[SuperAdmin/ServiceControl] POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ============================================================================
// Dashboard Data
// ============================================================================

async function getDashboardData() {
  const currentDay = new Date().toISOString().substring(0, 10)
  const currentMonth = new Date().toISOString().substring(0, 7)
  
  // Get all tenants with their plans
  const tenants = await prisma.tenant.findMany({
    include: {
      tenantPlans: {
        where: { status: 'ACTIVE' },
        include: { plan: true }
      },
      _count: {
        select: { users: true }
      }
    }
  })
  
  // Get plans summary
  const plans = await prisma.plan.findMany({
    include: {
      planFeatures: {
        include: { feature: true }
      },
      _count: {
        select: { tenantPlans: true }
      }
    }
  })
  
  // Get today's usage summary across all tenants
  const todayUsage = await prisma.serviceCompletionUsage.groupBy({
    by: ['serviceType'],
    where: { completionDate: currentDay, isCompleted: true },
    _count: { id: true },
    _sum: { totalTokensUsed: true, estimatedCostUsd: true }
  })
  
  // Get this month's usage summary
  const monthUsage = await prisma.serviceCompletionUsage.groupBy({
    by: ['serviceType'],
    where: { completionMonth: currentMonth, isCompleted: true },
    _count: { id: true },
    _sum: { totalTokensUsed: true, estimatedCostUsd: true }
  })
  
  // Get model prices
  const modelPrices = await prisma.lLMModelPrice.findMany()
  
  return NextResponse.json({
    summary: {
      totalTenants: tenants.length,
      totalUsers: tenants.reduce((sum, t) => sum + t._count.users, 0),
      totalPlans: plans.length,
      activeSubscriptions: tenants.filter(t => t.tenantPlans.length > 0).length
    },
    todayUsage: todayUsage.map(u => ({
      serviceType: u.serviceType,
      completions: u._count.id,
      tokens: u._sum.totalTokensUsed || 0,
      costUsd: u._sum.estimatedCostUsd || 0
    })),
    monthUsage: monthUsage.map(u => ({
      serviceType: u.serviceType,
      completions: u._count.id,
      tokens: u._sum.totalTokensUsed || 0,
      costUsd: u._sum.estimatedCostUsd || 0
    })),
    plans: plans.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      tenantCount: p._count.tenantPlans,
      features: p.planFeatures.map(pf => ({
        featureCode: pf.feature.code,
        featureName: pf.feature.name,
        dailyQuota: pf.dailyQuota,
        monthlyQuota: pf.monthlyQuota,
        dailyTokenLimit: (pf as any).dailyTokenLimit,
        monthlyTokenLimit: (pf as any).monthlyTokenLimit
      }))
    })),
    tenants: tenants.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      userCount: t._count.users,
      plan: t.tenantPlans[0]?.plan?.name || 'No Plan'
    })),
    modelPrices: modelPrices.map(mp => ({
      id: mp.id,
      provider: mp.provider,
      modelClass: mp.modelClass,
      inputPricePerMTokens: mp.inputPricePerMTokens,
      outputPricePerMTokens: mp.outputPricePerMTokens,
      currency: mp.currency
    }))
  })
}

// ============================================================================
// Plans with Quotas
// ============================================================================

async function getPlansWithQuotas() {
  const plans = await prisma.plan.findMany({
    include: {
      planFeatures: {
        include: { feature: true }
      },
      tenantPlans: {
        where: { status: 'ACTIVE' },
        include: {
          tenant: {
            include: {
              _count: { select: { users: true } }
            }
          }
        }
      }
    }
  })
  
  return NextResponse.json({
    plans: plans.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      cycle: p.cycle,
      status: p.status,
      createdAt: p.createdAt,
      tenantCount: p.tenantPlans.length,
      userCount: p.tenantPlans.reduce((sum, tp) => sum + tp.tenant._count.users, 0),
      features: p.planFeatures.map(pf => ({
        id: pf.id,
        featureId: pf.featureId,
        featureCode: pf.feature.code,
        featureName: pf.feature.name,
        unit: pf.feature.unit,
        dailyQuota: pf.dailyQuota,
        monthlyQuota: pf.monthlyQuota,
        dailyTokenLimit: (pf as any).dailyTokenLimit,
        monthlyTokenLimit: (pf as any).monthlyTokenLimit
      }))
    }))
  })
}

// ============================================================================
// Tenant Usage Data
// ============================================================================

async function getTenantUsageData(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      tenantPlans: {
        where: { status: 'ACTIVE' },
        include: { plan: true }
      },
      users: {
        select: { id: true, email: true, name: true, status: true }
      }
    }
  })
  
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  
  // Get service usage
  const serviceUsage = await getTenantServiceUsage(tenantId)
  
  // Get user-level usage
  const userUsage = await getTenantUserUsage(tenantId)
  
  return NextResponse.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      plan: tenant.tenantPlans[0]?.plan?.name || 'No Plan',
      userCount: tenant.users.length
    },
    users: tenant.users,
    serviceUsage,
    userUsage
  })
}

// ============================================================================
// Cost Breakdown
// ============================================================================

async function getCostBreakdownData(tenantId: string) {
  const costBreakdown = await getTenantCostBreakdown(tenantId)
  
  return NextResponse.json(costBreakdown)
}

// ============================================================================
// All Tenants Usage
// ============================================================================

async function getAllTenantsUsage() {
  const currentMonth = new Date().toISOString().substring(0, 7)
  
  // Get all tenants with their monthly usage
  const tenants = await prisma.tenant.findMany({
    include: {
      tenantPlans: {
        where: { status: 'ACTIVE' },
        include: { plan: true }
      },
      _count: { select: { users: true } }
    }
  })
  
  const tenantsWithUsage = await Promise.all(
    tenants.map(async tenant => {
      const usage = await prisma.serviceCompletionUsage.groupBy({
        by: ['serviceType'],
        where: {
          tenantId: tenant.id,
          completionMonth: currentMonth,
          isCompleted: true
        },
        _count: { id: true },
        _sum: { totalTokensUsed: true, estimatedCostUsd: true }
      })
      
      return {
        id: tenant.id,
        name: tenant.name,
        status: tenant.status,
        plan: tenant.tenantPlans[0]?.plan?.name || 'No Plan',
        userCount: tenant._count.users,
        monthlyUsage: usage.map(u => ({
          serviceType: u.serviceType,
          completions: u._count.id,
          tokens: u._sum.totalTokensUsed || 0,
          costUsd: u._sum.estimatedCostUsd || 0
        })),
        totalMonthlyCost: usage.reduce((sum, u) => sum + (u._sum.estimatedCostUsd || 0), 0)
      }
    })
  )
  
  return NextResponse.json({ tenants: tenantsWithUsage })
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Sanitize quota value: convert empty/negative to null, ensure non-negative
 */
function sanitizeQuotaValue(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null // Unlimited
  }
  const num = Number(value)
  if (isNaN(num) || num < 0) {
    return null // Invalid or negative → unlimited (safe default)
  }
  return Math.floor(num) // Ensure integer
}

// ============================================================================
// Update Plan Quota
// ============================================================================

async function updatePlanQuota(body: any) {
  const { planId, featureCode, updates } = body
  
  if (!planId || !featureCode) {
    return NextResponse.json(
      { error: 'planId and featureCode required' },
      { status: 400 }
    )
  }
  
  // Find the feature
  const feature = await prisma.feature.findFirst({
    where: { code: featureCode }
  })
  
  if (!feature) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 })
  }
  
  // Sanitize all quota values (prevents negative values, converts empty to null)
  const sanitizedUpdates = {
    dailyQuota: sanitizeQuotaValue(updates.dailyQuota),
    monthlyQuota: sanitizeQuotaValue(updates.monthlyQuota),
    dailyTokenLimit: sanitizeQuotaValue(updates.dailyTokenLimit),
    monthlyTokenLimit: sanitizeQuotaValue(updates.monthlyTokenLimit)
  }
  
  // Update the plan feature
  const planFeature = await prisma.planFeature.upsert({
    where: {
      planId_featureId: {
        planId,
        featureId: feature.id
      }
    },
    create: {
      planId,
      featureId: feature.id,
      dailyQuota: sanitizedUpdates.dailyQuota,
      monthlyQuota: sanitizedUpdates.monthlyQuota,
      // Note: TypeScript may not recognize these fields until Prisma client is regenerated
      ...(sanitizedUpdates.dailyTokenLimit !== undefined && { dailyTokenLimit: sanitizedUpdates.dailyTokenLimit }),
      ...(sanitizedUpdates.monthlyTokenLimit !== undefined && { monthlyTokenLimit: sanitizedUpdates.monthlyTokenLimit })
    },
    update: {
      dailyQuota: sanitizedUpdates.dailyQuota,
      monthlyQuota: sanitizedUpdates.monthlyQuota,
      ...(sanitizedUpdates.dailyTokenLimit !== undefined && { dailyTokenLimit: sanitizedUpdates.dailyTokenLimit }),
      ...(sanitizedUpdates.monthlyTokenLimit !== undefined && { monthlyTokenLimit: sanitizedUpdates.monthlyTokenLimit })
    }
  })
  
  return NextResponse.json({ success: true, planFeature })
}

// ============================================================================
// Create Plan
// ============================================================================

async function createPlan(body: any) {
  const { code, name, cycle = 'MONTHLY', features = [] } = body
  
  if (!code || !name) {
    return NextResponse.json(
      { error: 'code and name required' },
      { status: 400 }
    )
  }
  
  // Check if plan code already exists
  const existing = await prisma.plan.findFirst({ where: { code } })
  if (existing) {
    return NextResponse.json(
      { error: 'Plan code already exists' },
      { status: 400 }
    )
  }
  
  // Create plan with features
  const plan = await prisma.plan.create({
    data: {
      code,
      name,
      cycle,
      status: 'ACTIVE'
    }
  })
  
  // Add features if provided
  if (features.length > 0) {
    for (const f of features) {
      const feature = await prisma.feature.findFirst({
        where: { code: f.featureCode }
      })
      
      if (feature) {
        await prisma.planFeature.create({
          data: {
            planId: plan.id,
            featureId: feature.id,
            dailyQuota: f.dailyQuota ?? null,
            monthlyQuota: f.monthlyQuota ?? null
          }
        })
      }
    }
  }
  
  return NextResponse.json({ success: true, plan })
}

// ============================================================================
// Update Plan
// ============================================================================

async function updatePlan(body: any) {
  const { planId, updates } = body
  
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }
  
  const plan = await prisma.plan.update({
    where: { id: planId },
    data: {
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.cycle !== undefined && { cycle: updates.cycle })
    }
  })
  
  return NextResponse.json({ success: true, plan })
}

// ============================================================================
// Reset Usage (with audit logging)
// ============================================================================

async function resetTenantUsage(body: any, adminUserId?: string) {
  const { tenantId, serviceType, period, reason } = body
  
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
  }
  
  // Get tenant info for logging
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true }
  })
  
  const count = await resetUsageCounters(tenantId, serviceType, period)
  
  // Audit log the reset action
  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: adminUserId || 'system',
        action: 'USAGE_RESET',
        resource: `service_usage:${tenantId}`,
        meta: {
          serviceType: serviceType || 'ALL',
          period: period || 'ALL',
          resetCount: count,
          reason: reason || 'Admin reset',
          resetAt: new Date().toISOString()
        }
      }
    })
  } catch (auditError) {
    // Don't fail the operation if audit logging fails
    console.warn('[SuperAdmin] Failed to create audit log for reset:', auditError)
  }
  
  console.log(`[SuperAdmin] Usage reset: tenant=${tenant?.name || tenantId}, service=${serviceType || 'ALL'}, period=${period || 'ALL'}, count=${count}`)
  
  return NextResponse.json({ success: true, resetCount: count })
}

// ============================================================================
// Update Model Cost
// ============================================================================

async function updateModelCost(body: any) {
  const { provider, modelClass, inputPricePerMTokens, outputPricePerMTokens, currency = 'USD' } = body
  
  if (!provider || !modelClass) {
    return NextResponse.json(
      { error: 'provider and modelClass required' },
      { status: 400 }
    )
  }
  
  const price = await prisma.lLMModelPrice.upsert({
    where: {
      provider_modelClass: { provider, modelClass }
    },
    create: {
      provider,
      modelClass,
      inputPricePerMTokens: inputPricePerMTokens || 0,
      outputPricePerMTokens: outputPricePerMTokens || 0,
      currency
    },
    update: {
      inputPricePerMTokens: inputPricePerMTokens || 0,
      outputPricePerMTokens: outputPricePerMTokens || 0,
      currency
    }
  })
  
  return NextResponse.json({ success: true, price })
}

