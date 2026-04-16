/**
 * Add Gemini Image Generation Models to LLM Control
 * 
 * This script adds the best Gemini models for sketch/image generation
 * to the llm_models table so they appear in the admin LLM control panel.
 * 
 * Usage:
 *   npx ts-node scripts/add-gemini-image-models.ts
 *   OR
 *   npx tsx scripts/add-gemini-image-models.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface GeminiImageModel {
  code: string
  displayName: string
  contextWindow: number
  supportsVision: boolean
  supportsStreaming: boolean
  inputCostPer1M: number  // USD cents
  outputCostPer1M: number // USD cents
  description?: string
}

// Best Gemini models for image generation (sketch generation)
const GEMINI_IMAGE_MODELS: GeminiImageModel[] = [
  {
    code: 'gemini-3.1-flash-image',
    displayName: 'Gemini 3.1 Flash Image (Nano Banana 2)',
    contextWindow: 128000,
    supportsVision: true,
    supportsStreaming: false,
    inputCostPer1M: 75,   // $0.75 per 1M
    outputCostPer1M: 300,  // $3.00 per 1M
    description: 'Latest image generation model. 14-object consistency, improved text rendering, extreme aspect ratios. Best for publication-grade scientific figures.'
  },
  {
    code: 'gemini-2.0-flash-exp',
    displayName: 'Gemini 2.0 Flash Experimental (Best Image Output)',
    contextWindow: 1048576, // 1M tokens
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 10,   // $0.10 per 1M
    outputCostPer1M: 40,  // $0.40 per 1M
    description: 'Best for sketch/diagram generation. Experimental but stable with excellent image output quality.'
  },
  {
    code: 'gemini-2.0-flash-thinking-exp',
    displayName: 'Gemini 2.0 Flash Thinking (Higher Quality Reasoning)',
    contextWindow: 1048576,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 30,   // $0.30 per 1M
    outputCostPer1M: 120, // $1.20 per 1M
    description: 'Higher quality through reasoning. Slower but produces more accurate/detailed outputs.'
  },
  {
    code: 'gemini-exp-1206',
    displayName: 'Gemini Experimental (Dec 2024)',
    contextWindow: 2097152, // 2M tokens
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 10,
    outputCostPer1M: 40,
    description: 'Latest experimental Gemini model with improved capabilities.'
  },
  // Also add the standard stable models if they don't exist
  {
    code: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash (Stable)',
    contextWindow: 1048576,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 10,
    outputCostPer1M: 40,
    description: 'Production-stable Gemini 2.0 Flash model with image output capability.'
  },
  {
    code: 'gemini-2.0-flash-lite',
    displayName: 'Gemini 2.0 Flash Lite (Fast & Cheap)',
    contextWindow: 1048576,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 8,    // $0.08 per 1M
    outputCostPer1M: 30,  // $0.30 per 1M
    description: 'Faster and cheaper. Good for high-volume use cases.'
  }
]

async function main() {
  console.log('🚀 Adding Gemini Image Generation Models to LLM Control...\n')

  let created = 0
  let updated = 0
  let skipped = 0

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      // Check if model already exists
      const existing = await prisma.lLMModel.findUnique({
        where: { code: model.code }
      })

      if (existing) {
        // Update existing model
        await prisma.lLMModel.update({
          where: { code: model.code },
          data: {
            displayName: model.displayName,
            contextWindow: model.contextWindow,
            supportsVision: model.supportsVision,
            supportsStreaming: model.supportsStreaming,
            inputCostPer1M: model.inputCostPer1M,
            outputCostPer1M: model.outputCostPer1M,
            isActive: true,
            updatedAt: new Date()
          }
        })
        console.log(`✅ Updated: ${model.code} (${model.displayName})`)
        updated++
      } else {
        // Create new model
        await prisma.lLMModel.create({
          data: {
            code: model.code,
            displayName: model.displayName,
            provider: 'google',
            contextWindow: model.contextWindow,
            supportsVision: model.supportsVision,
            supportsStreaming: model.supportsStreaming,
            inputCostPer1M: model.inputCostPer1M,
            outputCostPer1M: model.outputCostPer1M,
            isActive: true,
            isDefault: false
          }
        })
        console.log(`🆕 Created: ${model.code} (${model.displayName})`)
        created++
      }
    } catch (error) {
      console.error(`❌ Error processing ${model.code}:`, error)
      skipped++
    }
  }

  console.log('\n📊 Summary:')
  console.log(`   Created: ${created}`)
  console.log(`   Updated: ${updated}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Total:   ${GEMINI_IMAGE_MODELS.length}`)

  // List all Gemini models now in the database
  console.log('\n📋 All Gemini models in database:')
  const allGeminiModels = await prisma.lLMModel.findMany({
    where: { provider: 'google' },
    orderBy: { code: 'asc' }
  })
  
  console.log('┌────────────────────────────────────┬────────────────────────────────────────────────────┬────────┐')
  console.log('│ Code                               │ Display Name                                       │ Active │')
  console.log('├────────────────────────────────────┼────────────────────────────────────────────────────┼────────┤')
  for (const m of allGeminiModels) {
    const code = m.code.padEnd(34)
    const name = m.displayName.substring(0, 50).padEnd(50)
    const active = m.isActive ? '  ✓   ' : '  ✗   '
    console.log(`│ ${code} │ ${name} │${active}│`)
  }
  console.log('└────────────────────────────────────┴────────────────────────────────────────────────────┴────────┘')

  console.log('\n✅ Done! You can now select these models in the Super Admin LLM Control panel.')
}

main()
  .catch((e) => {
    console.error('Script failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })






























