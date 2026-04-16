/**
 * Complete TRIAL Plan Seeder
 * 
 * This script creates the TRIAL plan with:
 * 1. Plan record with status ACTIVE
 * 2. PlanFeature entries for all features
 * 3. PlanStageModelConfig entries for ALL workflow stages (including IDEATION)
 * 
 * Run: npx tsx scripts/seed-trial-plan-complete.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Default trial limits
const DEFAULT_TRIAL_LIMITS = {
  patentDraftLimit: 3,
  noveltySearchLimit: 10,
  ideationRunLimit: 5,
  priorArtSearchLimit: 10,
  diagramLimit: 20,
  totalTokenBudget: 70000
}

// Model assignments for TRIAL plan (same as FREE_PLAN - cost-effective)
const TRIAL_STAGE_MODELS: Record<string, string> = {
  // Core drafting stages
  'DRAFT_IDEA_ENTRY':                   'gemini-2.5-flash-lite',
  'DRAFT_CLAIM_GENERATION':             'gemini-2.5-flash-lite',
  'DRAFT_PRIOR_ART_ANALYSIS':           'gemini-2.5-flash-lite',
  'DRAFT_CLAIM_REFINEMENT':             'gemini-2.5-flash-lite',
  'DRAFT_FIGURE_PLANNER':               'gemini-2.5-flash-lite',
  'DRAFT_SKETCH_GENERATION':            'gemini-3-pro-image-preview',
  'DRAFT_DIAGRAM_GENERATION':           'gemini-2.5-flash-lite',
  // Annexure/Section stages
  'DRAFT_ANNEXURE_TITLE':               'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_PREAMBLE':            'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_FIELD':               'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_BACKGROUND':          'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_OBJECTS':             'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_SUMMARY':             'gemini-2.5-pro',
  'DRAFT_ANNEXURE_TECHNICAL_PROBLEM':   'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_TECHNICAL_SOLUTION':  'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS':'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_DRAWINGS':            'gemini-2.5-flash-lite',
  'DRAFT_REFERENCE_DRAFT_PASS1':        'claude-opus-4.5',
  'DRAFT_ANNEXURE_DESCRIPTION':         'gemini-2.5-pro',
  'DRAFT_ANNEXURE_BEST_MODE':           'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': 'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_CLAIMS':              'gemini-2.5-pro',
  'DRAFT_ANNEXURE_ABSTRACT':            'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_NUMERALS':            'gemini-2.5-flash-lite',
  'DRAFT_ANNEXURE_CROSS_REFERENCE':     'gemini-2.5-flash-lite',
  'DRAFT_REVIEW':                       'gemini-2.5-pro',
  // Novelty search stages
  'NOVELTY_QUERY_GENERATION':           'gemini-2.5-flash-lite',
  'NOVELTY_RELEVANCE_SCORING':          'gemini-2.5-flash-lite',
  'NOVELTY_FEATURE_ANALYSIS':           'gemini-2.5-flash-lite',
  'NOVELTY_COMPARISON':                 'gemini-2.5-flash-lite',
  'NOVELTY_REPORT_GENERATION':          'gemini-2.5-pro',
  // Idea bank stages
  'IDEA_BANK_GENERATION':               'gemini-2.5-pro',
  'IDEA_BANK_NORMALIZE':                'gemini-2.5-flash-lite',
  'IDEA_BANK_SEARCH':                   'gemini-2.5-flash-lite',
  // Diagram stages
  'DIAGRAM_PLANTUML':                   'gemini-2.5-flash-lite',
  'DIAGRAM_FLOWCHART':                  'gemini-2.5-flash-lite',
  'DIAGRAM_SEQUENCE':                   'gemini-2.5-flash-lite',
  'DIAGRAM_BLOCK':                      'gemini-2.5-flash-lite',
  // IDEATION stages - Use Pro for heavy reasoning, Flash Lite for lighter tasks
  'IDEATION_NORMALIZE':                 'gemini-2.5-flash-lite',
  'IDEATION_CLASSIFY':                  'gemini-2.5-flash-lite',
  'IDEATION_CONTRADICTION_MAPPING':     'gemini-2.5-pro',
  'IDEATION_EXPAND':                    'gemini-2.5-flash-lite',
  'IDEATION_OBVIOUSNESS_FILTER':        'gemini-2.5-pro',
  'IDEATION_GENERATE':                  'gemini-2.5-pro',
  'IDEATION_NOVELTY':                   'gemini-2.5-pro',
}

// Token limits per stage (from seed-llm-models.js)
const TOKEN_LIMITS: Record<string, { maxTokensIn: number; maxTokensOut: number }> = {
  'DRAFT_IDEA_ENTRY':                   { maxTokensIn: 20000,  maxTokensOut: 16000 },
  'DRAFT_CLAIM_GENERATION':             { maxTokensIn: 30000,  maxTokensOut: 16000 },
  'DRAFT_PRIOR_ART_ANALYSIS':           { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'DRAFT_CLAIM_REFINEMENT':             { maxTokensIn: 50000,  maxTokensOut: 16000 },
  'DRAFT_FIGURE_PLANNER':               { maxTokensIn: 50000,  maxTokensOut: 16000 },
  'DRAFT_SKETCH_GENERATION':            { maxTokensIn: 8192,   maxTokensOut: 1000 },
  'DRAFT_DIAGRAM_GENERATION':           { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'DRAFT_ANNEXURE_TITLE':               { maxTokensIn: 50000,  maxTokensOut: 1000 },
  'DRAFT_ANNEXURE_PREAMBLE':            { maxTokensIn: 50000,  maxTokensOut: 2000 },
  'DRAFT_ANNEXURE_FIELD':               { maxTokensIn: 50000,  maxTokensOut: 2000 },
  'DRAFT_ANNEXURE_BACKGROUND':          { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'DRAFT_ANNEXURE_OBJECTS':             { maxTokensIn: 50000,  maxTokensOut: 4000 },
  'DRAFT_ANNEXURE_SUMMARY':             { maxTokensIn: 50000,  maxTokensOut: 16000 },
  'DRAFT_ANNEXURE_TECHNICAL_PROBLEM':   { maxTokensIn: 50000,  maxTokensOut: 4000 },
  'DRAFT_ANNEXURE_TECHNICAL_SOLUTION':  { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS':{ maxTokensIn: 50000,  maxTokensOut: 8192 },
  'DRAFT_ANNEXURE_DRAWINGS':            { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'DRAFT_REFERENCE_DRAFT_PASS1':        { maxTokensIn: 80000,  maxTokensOut: 40000 },
  'DRAFT_ANNEXURE_DESCRIPTION':         { maxTokensIn: 80000,  maxTokensOut: 40000 },
  'DRAFT_ANNEXURE_BEST_MODE':           { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': { maxTokensIn: 50000, maxTokensOut: 2000 },
  'DRAFT_ANNEXURE_CLAIMS':              { maxTokensIn: 80000,  maxTokensOut: 32000 },
  'DRAFT_ANNEXURE_ABSTRACT':            { maxTokensIn: 50000,  maxTokensOut: 2000 },
  'DRAFT_ANNEXURE_NUMERALS':            { maxTokensIn: 50000,  maxTokensOut: 4000 },
  'DRAFT_ANNEXURE_CROSS_REFERENCE':     { maxTokensIn: 50000,  maxTokensOut: 2000 },
  'DRAFT_REVIEW':                       { maxTokensIn: 100000, maxTokensOut: 16000 },
  'NOVELTY_QUERY_GENERATION':           { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'NOVELTY_RELEVANCE_SCORING':          { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'NOVELTY_FEATURE_ANALYSIS':           { maxTokensIn: 50000,  maxTokensOut: 8192 },
  'NOVELTY_COMPARISON':                 { maxTokensIn: 100000, maxTokensOut: 16000 },
  'NOVELTY_REPORT_GENERATION':          { maxTokensIn: 100000, maxTokensOut: 32000 },
  'IDEA_BANK_GENERATION':               { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'IDEA_BANK_NORMALIZE':                { maxTokensIn: 20000,  maxTokensOut: 8192 },
  'IDEA_BANK_SEARCH':                   { maxTokensIn: 20000,  maxTokensOut: 8192 },
  'DIAGRAM_PLANTUML':                   { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'DIAGRAM_FLOWCHART':                  { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'DIAGRAM_SEQUENCE':                   { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'DIAGRAM_BLOCK':                      { maxTokensIn: 30000,  maxTokensOut: 8192 },
  // IDEATION stages
  'IDEATION_NORMALIZE':                 { maxTokensIn: 20000,  maxTokensOut: 8192 },
  'IDEATION_CLASSIFY':                  { maxTokensIn: 20000,  maxTokensOut: 8192 },
  'IDEATION_CONTRADICTION_MAPPING':     { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'IDEATION_EXPAND':                    { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'IDEATION_OBVIOUSNESS_FILTER':        { maxTokensIn: 30000,  maxTokensOut: 8192 },
  'IDEATION_GENERATE':                  { maxTokensIn: 40000,  maxTokensOut: 16000 },
  'IDEATION_NOVELTY':                   { maxTokensIn: 50000,  maxTokensOut: 16000 },
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  SEEDING COMPLETE TRIAL PLAN')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // Step 1: Create/update TRIAL plan
  console.log('1️⃣  Creating/updating TRIAL plan...')
  const plan = await prisma.plan.upsert({
    where: { code: 'TRIAL' },
    update: {
      name: 'Trial Plan',
      status: 'ACTIVE' // Ensure it's ACTIVE
    },
    create: {
      code: 'TRIAL',
      name: 'Trial Plan',
      cycle: 'ONE_TIME',
      status: 'ACTIVE'
    }
  })
  console.log(`   ✅ TRIAL plan: ${plan.id} (status: ${plan.status})\n`)

  // Step 2: Create PlanFeature entries
  console.log('2️⃣  Creating PlanFeature entries...')
  const featureConfigs = [
    { code: 'PATENT_DRAFTING' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.patentDraftLimit },
    { code: 'PRIOR_ART_SEARCH' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.priorArtSearchLimit },
    { code: 'IDEATION' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.ideationRunLimit },
    { code: 'DIAGRAM_GENERATION' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.diagramLimit },
    { code: 'IDEA_BANK' as const, monthlyQuota: 5 }
  ]

  for (const config of featureConfigs) {
    const feature = await prisma.feature.upsert({
      where: { code: config.code },
      update: {},
      create: {
        code: config.code,
        name: config.code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        unit: 'operations'
      }
    })

    const existingPlanFeature = await prisma.planFeature.findUnique({
      where: {
        planId_featureId: {
          planId: plan.id,
          featureId: feature.id
        }
      }
    })

    if (!existingPlanFeature) {
      await prisma.planFeature.create({
        data: {
          planId: plan.id,
          featureId: feature.id,
          monthlyQuota: config.monthlyQuota,
          dailyQuota: null,
          monthlyTokenLimit: DEFAULT_TRIAL_LIMITS.totalTokenBudget,
          dailyTokenLimit: null
        }
      })
      console.log(`   ✅ Created PlanFeature: ${config.code}`)
    } else {
      console.log(`   ⏭️  PlanFeature exists: ${config.code}`)
    }
  }
  console.log('')

  // Step 3: Get all workflow stages
  console.log('3️⃣  Configuring PlanStageModelConfig for all workflow stages...')
  const stages = await prisma.workflowStage.findMany({
    where: { isActive: true }
  })
  console.log(`   Found ${stages.length} active workflow stages\n`)

  // Step 4: Create PlanStageModelConfig for each stage
  let configuredCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const stage of stages) {
    const modelCode = TRIAL_STAGE_MODELS[stage.code]
    if (!modelCode) {
      console.log(`   ⏭️  No config for: ${stage.code} (skipped)`)
      skippedCount++
      continue
    }

    // Find the model
    const model = await prisma.lLMModel.findFirst({
      where: { code: modelCode, isActive: true }
    })

    if (!model) {
      console.log(`   ⚠️  Model not found: ${modelCode} for ${stage.code}`)
      errorCount++
      continue
    }

    const tokenLimit = TOKEN_LIMITS[stage.code] || { maxTokensIn: 30000, maxTokensOut: 8192 }

    try {
      await prisma.planStageModelConfig.upsert({
        where: {
          planId_stageId: {
            planId: plan.id,
            stageId: stage.id
          }
        },
        update: {
          modelId: model.id,
          maxTokensIn: tokenLimit.maxTokensIn,
          maxTokensOut: tokenLimit.maxTokensOut,
          temperature: 0.7,
          isActive: true
        },
        create: {
          planId: plan.id,
          stageId: stage.id,
          modelId: model.id,
          maxTokensIn: tokenLimit.maxTokensIn,
          maxTokensOut: tokenLimit.maxTokensOut,
          temperature: 0.7,
          isActive: true
        }
      })
      configuredCount++
      
      // Highlight ideation stages
      if (stage.featureCode === 'IDEATION') {
        console.log(`   ✅ ${stage.code} → ${modelCode} (IDEATION)`)
      }
    } catch (err: any) {
      console.log(`   ❌ Error configuring ${stage.code}: ${err.message}`)
      errorCount++
    }
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`   Plan ID: ${plan.id}`)
  console.log(`   Plan Status: ${plan.status}`)
  console.log(`   Stages Configured: ${configuredCount}`)
  console.log(`   Stages Skipped: ${skippedCount}`)
  console.log(`   Errors: ${errorCount}`)
  console.log('')
  
  // Verify ideation stages
  const ideationConfigs = await prisma.planStageModelConfig.findMany({
    where: {
      planId: plan.id,
      stage: { featureCode: 'IDEATION' }
    },
    include: {
      stage: true,
      model: true
    }
  })
  
  console.log(`   IDEATION stage configs: ${ideationConfigs.length}/7`)
  if (ideationConfigs.length < 7) {
    console.log('   ⚠️  Some ideation stages are missing configurations!')
  } else {
    console.log('   ✅ All ideation stages configured!')
  }
  
  console.log('')
  console.log('✨ TRIAL plan seeding complete!')
  console.log('   You can now see TRIAL plan in Super Admin LLM Config')
  console.log('   and use ideation features for trial users.')
  console.log('')

  await prisma.$disconnect()
}

main().catch(e => {
  console.error('Error:', e)
  prisma.$disconnect()
  process.exit(1)
})

