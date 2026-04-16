/**
 * Super Admin LLM Configuration API
 * 
 * Manages:
 * - LLM Models registry (add/update/toggle models)
 * - Workflow stages
 * - Plan → Stage → Model mappings
 * 
 * Only accessible by SUPER_ADMIN role
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { clearModelCache } from '@/lib/metering/model-resolver'
import { llmGateway } from '@/lib/metering/gateway'
import { refreshPricingCache } from '@/lib/metering/cost-calculator'

// ============================================================================
// Auth Helper
// ============================================================================

async function verifySuperAdmin(request: NextRequest): Promise<{ userId: string; email: string } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true, email: true, roles: true }
  })

  if (!user?.roles?.includes('SUPER_ADMIN')) return null
  return { userId: user.id, email: user.email }
}

// ============================================================================
// GET - Fetch all LLM configuration data
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const section = url.searchParams.get('section') || 'all'
    const planId = url.searchParams.get('planId')

    const result: any = {}

    // Fetch models
    if (section === 'all' || section === 'models') {
      result.models = await prisma.lLMModel.findMany({
        orderBy: [{ provider: 'asc' }, { displayName: 'asc' }]
      })
    }

    // Fetch stages
    if (section === 'all' || section === 'stages') {
      result.stages = await prisma.workflowStage.findMany({
        where: { isActive: true },
        orderBy: [{ featureCode: 'asc' }, { sortOrder: 'asc' }]
      })
    }

    // Fetch plans
    if (section === 'all' || section === 'plans') {
      result.plans = await prisma.plan.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { code: 'asc' }
      })
    }

    // Fetch plan stage configs
    if (section === 'all' || section === 'configs') {
      const where = planId ? { planId } : {}
      result.stageConfigs = await prisma.planStageModelConfig.findMany({
        where,
        include: {
          plan: { select: { id: true, code: true, name: true } },
          stage: { select: { id: true, code: true, displayName: true, featureCode: true } },
          model: { select: { id: true, code: true, displayName: true, provider: true } }
        },
        orderBy: [{ planId: 'asc' }, { stage: { sortOrder: 'asc' } }]
      })

      result.taskConfigs = await prisma.planTaskModelConfig.findMany({
        where,
        include: {
          plan: { select: { id: true, code: true, name: true } },
          model: { select: { id: true, code: true, displayName: true, provider: true } }
        },
        orderBy: { planId: 'asc' }
      })
    }

    // Fetch providers summary
    if (section === 'all' || section === 'providers') {
      const models = await prisma.lLMModel.findMany({
        where: { isActive: true },
        select: { provider: true }
      })
      
      const providerCounts: Record<string, number> = {}
      models.forEach(m => {
        providerCounts[m.provider] = (providerCounts[m.provider] || 0) + 1
      })
      
      result.providers = Object.entries(providerCounts).map(([name, count]) => ({
        name,
        modelCount: count,
        hasApiKey: checkProviderApiKey(name)
      }))
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('GET /api/super-admin/llm-config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function checkProviderApiKey(provider: string): boolean {
  const envMap: Record<string, string> = {
    google: 'GOOGLE_AI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    groq: 'GROQ_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
    qwen: 'QWEN_API_KEY'
  }
  const envVar = envMap[provider]
  return envVar ? !!process.env[envVar] : false
}

// ============================================================================
// POST - Create or update configurations
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    switch (action) {
      case 'refresh_cache':
        return refreshCache()
      case 'create_model':
        return createModel(body)
      case 'update_model':
        return updateModel(body)
      case 'toggle_model':
        return toggleModel(body)
      case 'set_default_model':
        return setDefaultModel(body)
      case 'create_stage':
        return createStage(body)
      case 'update_stage':
        return updateStage(body)
      case 'set_stage_model':
        return setStageModel(body)
      case 'set_task_model':
        return setTaskModel(body)
      case 'bulk_set_plan_models':
        return bulkSetPlanModels(body)
      case 'copy_plan_config':
        return copyPlanConfig(body)
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('POST /api/super-admin/llm-config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function refreshCache() {
  // Clears model-resolution cache, reinitializes provider routing, and
  // refreshes pricing cache so admin changes are reflected immediately.
  clearModelCache()
  await llmGateway.refreshProviders()
  await refreshPricingCache()

  return NextResponse.json({
    success: true,
    message: 'LLM cache refreshed. New model/stage config will apply to upcoming requests immediately.'
  })
}

// ============================================================================
// Model Management
// ============================================================================

// Valid providers that have implementations
const VALID_PROVIDERS = ['google', 'openai', 'anthropic', 'deepseek', 'groq', 'zhipu', 'qwen']

async function createModel(body: any) {
  const { code, displayName, provider, contextWindow, supportsVision, supportsStreaming, inputCostPer1M, outputCostPer1M } = body

  if (!code || !displayName || !provider) {
    return NextResponse.json({ error: 'code, displayName, and provider are required' }, { status: 400 })
  }

  // Validate provider
  if (!VALID_PROVIDERS.includes(provider.toLowerCase())) {
    return NextResponse.json({ 
      error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` 
    }, { status: 400 })
  }

  // Validate code format (alphanumeric, dashes, dots)
  if (!/^[a-zA-Z0-9.-]+$/.test(code)) {
    return NextResponse.json({ 
      error: 'Model code must contain only alphanumeric characters, dashes, and dots' 
    }, { status: 400 })
  }

  const existing = await prisma.lLMModel.findUnique({ where: { code } })
  if (existing) {
    return NextResponse.json({ error: 'Model with this code already exists' }, { status: 400 })
  }

  const model = await prisma.lLMModel.create({
    data: {
      code: code.toLowerCase(),
      displayName,
      provider: provider.toLowerCase(),
      contextWindow: Math.max(1000, contextWindow || 128000),
      supportsVision: supportsVision ?? false,
      supportsStreaming: supportsStreaming ?? true,
      inputCostPer1M: Math.max(0, inputCostPer1M || 0),
      outputCostPer1M: Math.max(0, outputCostPer1M || 0),
      isActive: true,
      isDefault: false
    }
  })

  clearModelCache()
  return NextResponse.json({ success: true, model })
}

async function updateModel(body: any) {
  const { id, displayName, contextWindow, supportsVision, supportsStreaming, inputCostPer1M, outputCostPer1M } = body

  if (!id) {
    return NextResponse.json({ error: 'Model id is required' }, { status: 400 })
  }

  const model = await prisma.lLMModel.update({
    where: { id },
    data: {
      ...(displayName && { displayName }),
      ...(contextWindow !== undefined && { contextWindow }),
      ...(supportsVision !== undefined && { supportsVision }),
      ...(supportsStreaming !== undefined && { supportsStreaming }),
      ...(inputCostPer1M !== undefined && { inputCostPer1M }),
      ...(outputCostPer1M !== undefined && { outputCostPer1M })
    }
  })

  clearModelCache()
  return NextResponse.json({ success: true, model })
}

async function toggleModel(body: any) {
  const { id, isActive } = body

  if (!id || isActive === undefined) {
    return NextResponse.json({ error: 'id and isActive are required' }, { status: 400 })
  }

  const model = await prisma.lLMModel.update({
    where: { id },
    data: { isActive }
  })

  clearModelCache()
  return NextResponse.json({ success: true, model })
}

async function setDefaultModel(body: any) {
  const { id } = body

  if (!id) {
    return NextResponse.json({ error: 'Model id is required' }, { status: 400 })
  }

  // Clear all defaults first
  await prisma.lLMModel.updateMany({
    where: { isDefault: true },
    data: { isDefault: false }
  })

  // Set new default
  const model = await prisma.lLMModel.update({
    where: { id },
    data: { isDefault: true }
  })

  clearModelCache()
  return NextResponse.json({ success: true, model })
}

// ============================================================================
// Stage Management
// ============================================================================

async function createStage(body: any) {
  const { code, displayName, featureCode, description, sortOrder } = body

  if (!code || !displayName || !featureCode) {
    return NextResponse.json({ error: 'code, displayName, and featureCode are required' }, { status: 400 })
  }

  const existing = await prisma.workflowStage.findUnique({ where: { code } })
  if (existing) {
    return NextResponse.json({ error: 'Stage with this code already exists' }, { status: 400 })
  }

  const stage = await prisma.workflowStage.create({
    data: {
      code,
      displayName,
      featureCode,
      description: description || null,
      sortOrder: sortOrder || 0,
      isActive: true
    }
  })

  return NextResponse.json({ success: true, stage })
}

async function updateStage(body: any) {
  const { id, displayName, description, sortOrder, isActive } = body

  if (!id) {
    return NextResponse.json({ error: 'Stage id is required' }, { status: 400 })
  }

  const stage = await prisma.workflowStage.update({
    where: { id },
    data: {
      ...(displayName && { displayName }),
      ...(description !== undefined && { description }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(isActive !== undefined && { isActive })
    }
  })

  return NextResponse.json({ success: true, stage })
}

// ============================================================================
// Plan Model Configuration
// ============================================================================

async function setStageModel(body: any) {
  const { planId, stageId, modelId, fallbackModelIds, maxTokensIn, maxTokensOut, temperature } = body

  if (!planId || !stageId || !modelId) {
    return NextResponse.json({ error: 'planId, stageId, and modelId are required' }, { status: 400 })
  }

  // Validate that plan, stage, and model exist
  const [plan, stage, model] = await Promise.all([
    prisma.plan.findUnique({ where: { id: planId }, select: { id: true } }),
    prisma.workflowStage.findUnique({ where: { id: stageId }, select: { id: true } }),
    prisma.lLMModel.findUnique({ where: { id: modelId }, select: { id: true, isActive: true } })
  ])

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  if (!stage) {
    return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
  }
  if (!model) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }
  if (!model.isActive) {
    return NextResponse.json({ error: 'Cannot assign inactive model' }, { status: 400 })
  }

  // Validate fallback model IDs if provided
  let validatedFallbacks: string | null = null
  if (fallbackModelIds && Array.isArray(fallbackModelIds) && fallbackModelIds.length > 0) {
    // Limit to 3 fallbacks
    const limitedFallbacks = fallbackModelIds.slice(0, 3)
    const fallbackModels = await prisma.lLMModel.findMany({
      where: { id: { in: limitedFallbacks }, isActive: true },
      select: { id: true }
    })
    // Only include valid, active fallback IDs
    const validIds = limitedFallbacks.filter(id => fallbackModels.some(m => m.id === id))
    if (validIds.length > 0) {
      validatedFallbacks = JSON.stringify(validIds)
    }
  }

  const config = await prisma.planStageModelConfig.upsert({
    where: {
      planId_stageId: { planId, stageId }
    },
    update: {
      modelId,
      fallbackModelIds: validatedFallbacks,
      maxTokensIn: maxTokensIn || null,
      maxTokensOut: maxTokensOut || null,
      temperature: temperature || null,
      isActive: true
    },
    create: {
      planId,
      stageId,
      modelId,
      fallbackModelIds: validatedFallbacks,
      maxTokensIn: maxTokensIn || null,
      maxTokensOut: maxTokensOut || null,
      temperature: temperature || null,
      isActive: true
    },
    include: {
      stage: true,
      model: true
    }
  })

  // Clear ALL model cache to ensure changes take effect immediately
  clearModelCache()
  return NextResponse.json({ success: true, config })
}

async function setTaskModel(body: any) {
  const { planId, taskCode, modelId, fallbackModelIds, maxTokensIn, maxTokensOut, temperature } = body

  if (!planId || !taskCode || !modelId) {
    return NextResponse.json({ error: 'planId, taskCode, and modelId are required' }, { status: 400 })
  }

  // Validate plan and model exist
  const [plan, model] = await Promise.all([
    prisma.plan.findUnique({ where: { id: planId }, select: { id: true } }),
    prisma.lLMModel.findUnique({ where: { id: modelId }, select: { id: true, isActive: true } })
  ])

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  if (!model) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }
  if (!model.isActive) {
    return NextResponse.json({ error: 'Cannot assign inactive model' }, { status: 400 })
  }

  // Validate fallbacks
  let validatedFallbacks: string | null = null
  if (fallbackModelIds && Array.isArray(fallbackModelIds) && fallbackModelIds.length > 0) {
    const limitedFallbacks = fallbackModelIds.slice(0, 3)
    const fallbackModels = await prisma.lLMModel.findMany({
      where: { id: { in: limitedFallbacks }, isActive: true },
      select: { id: true }
    })
    const validIds = limitedFallbacks.filter(id => fallbackModels.some(m => m.id === id))
    if (validIds.length > 0) {
      validatedFallbacks = JSON.stringify(validIds)
    }
  }

  const config = await prisma.planTaskModelConfig.upsert({
    where: {
      planId_taskCode: { planId, taskCode }
    },
    update: {
      modelId,
      fallbackModelIds: validatedFallbacks,
      maxTokensIn: maxTokensIn || null,
      maxTokensOut: maxTokensOut || null,
      temperature: temperature || null,
      isActive: true
    },
    create: {
      planId,
      taskCode,
      modelId,
      fallbackModelIds: validatedFallbacks,
      maxTokensIn: maxTokensIn || null,
      maxTokensOut: maxTokensOut || null,
      temperature: temperature || null,
      isActive: true
    },
    include: {
      model: true
    }
  })

  // Clear ALL model cache to ensure changes take effect immediately
  // (clearPlanCache might miss entries if user is on a different plan)
  clearModelCache()
  return NextResponse.json({ success: true, config })
}

async function bulkSetPlanModels(body: any) {
  const { planId, stageModels } = body

  if (!planId || !stageModels || !Array.isArray(stageModels)) {
    return NextResponse.json({ error: 'planId and stageModels array are required' }, { status: 400 })
  }

  const results = []

  for (const { stageId, modelId, fallbackModelIds } of stageModels) {
    if (!stageId || !modelId) continue

    const config = await prisma.planStageModelConfig.upsert({
      where: {
        planId_stageId: { planId, stageId }
      },
      update: {
        modelId,
        fallbackModelIds: fallbackModelIds ? JSON.stringify(fallbackModelIds) : null,
        isActive: true
      },
      create: {
        planId,
        stageId,
        modelId,
        fallbackModelIds: fallbackModelIds ? JSON.stringify(fallbackModelIds) : null,
        isActive: true
      }
    })
    results.push(config)
  }

  // Clear ALL model cache for bulk updates
  clearModelCache()
  return NextResponse.json({ success: true, count: results.length })
}

async function copyPlanConfig(body: any) {
  const { sourcePlanId, targetPlanId } = body

  if (!sourcePlanId || !targetPlanId) {
    return NextResponse.json({ error: 'sourcePlanId and targetPlanId are required' }, { status: 400 })
  }

  // Get source configs
  const sourceConfigs = await prisma.planStageModelConfig.findMany({
    where: { planId: sourcePlanId }
  })

  // Copy to target
  let copied = 0
  for (const config of sourceConfigs) {
    await prisma.planStageModelConfig.upsert({
      where: {
        planId_stageId: { planId: targetPlanId, stageId: config.stageId }
      },
      update: {
        modelId: config.modelId,
        fallbackModelIds: config.fallbackModelIds,
        maxTokensIn: config.maxTokensIn,
        maxTokensOut: config.maxTokensOut,
        temperature: config.temperature,
        isActive: true
      },
      create: {
        planId: targetPlanId,
        stageId: config.stageId,
        modelId: config.modelId,
        fallbackModelIds: config.fallbackModelIds,
        maxTokensIn: config.maxTokensIn,
        maxTokensOut: config.maxTokensOut,
        temperature: config.temperature,
        isActive: true
      }
    })
    copied++
  }

  // Clear ALL model cache when copying configs
  clearModelCache()
  return NextResponse.json({ success: true, copied })
}

// ============================================================================
// DELETE - Remove configurations
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const type = url.searchParams.get('type')
    const id = url.searchParams.get('id')

    if (!type || !id) {
      return NextResponse.json({ error: 'type and id are required' }, { status: 400 })
    }

    switch (type) {
      case 'model':
        // Check if model is in use
        const modelUsage = await prisma.planStageModelConfig.count({
          where: { modelId: id }
        })
        if (modelUsage > 0) {
          return NextResponse.json({ 
            error: `Cannot delete model: it is used in ${modelUsage} stage configurations` 
          }, { status: 400 })
        }
        await prisma.lLMModel.delete({ where: { id } })
        clearModelCache()
        break

      case 'stage':
        // Check if stage is in use
        const stageUsage = await prisma.planStageModelConfig.count({
          where: { stageId: id }
        })
        if (stageUsage > 0) {
          return NextResponse.json({ 
            error: `Cannot delete stage: it has ${stageUsage} model configurations` 
          }, { status: 400 })
        }
        await prisma.workflowStage.delete({ where: { id } })
        break

      case 'stage_config':
        await prisma.planStageModelConfig.delete({ where: { id } })
        clearModelCache() // Clear all cache
        break

      case 'task_config':
        await prisma.planTaskModelConfig.delete({ where: { id } })
        clearModelCache() // Clear all cache
        break

      default:
        return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/super-admin/llm-config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

