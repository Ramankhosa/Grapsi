/**
 * Add "thinking/reasoning" models to LLM Control (llm_models table)
 *
 * This script upserts:
 * - OpenAI GPT-5.2 + "thinking" aliases for GPT-5.1 / GPT-5.2
 * - Gemini 3 Pro Preview + "thinking" alias
 *
 * Notes:
 * - Thinking aliases are model codes in our system and are translated by providers:
 *   - OpenAI: `*-thinking` -> base model + `reasoning.effort`
 *   - Gemini 3: `*-thinking` -> base model + `thinking_level`
 *
 * Usage:
 *   npx tsx scripts/add-thinking-models.ts
 *   OR
 *   npx ts-node scripts/add-thinking-models.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface LLMModelSeed {
  code: string
  displayName: string
  provider: 'openai' | 'google'
  contextWindow: number
  supportsVision: boolean
  supportsStreaming: boolean
  inputCostPer1M: number // USD cents
  outputCostPer1M: number // USD cents
  isActive?: boolean
}

const MODELS: LLMModelSeed[] = [
  // OpenAI GPT-5.x
  {
    code: 'gpt-5.2',
    displayName: 'GPT-5.2',
    provider: 'openai',
    contextWindow: 256000,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true
  },
  {
    code: 'gpt-5.1-thinking',
    displayName: 'GPT-5.1 (Thinking)',
    provider: 'openai',
    contextWindow: 256000,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true
  },
  {
    code: 'gpt-5.2-thinking',
    displayName: 'GPT-5.2 (Thinking)',
    provider: 'openai',
    contextWindow: 256000,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true
  },

  // Gemini 3
  {
    code: 'gemini-3-pro-preview',
    displayName: 'Gemini 3 Pro (Preview)',
    provider: 'google',
    contextWindow: 2097152,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true
  },
  {
    code: 'gemini-3-pro-preview-thinking',
    displayName: 'Gemini 3 Pro (Preview, Thinking)',
    provider: 'google',
    contextWindow: 2097152,
    supportsVision: true,
    supportsStreaming: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true
  }
]

async function main() {
  console.log('🚀 Adding Thinking/Reasoning Models to LLM Control...\n')

  let created = 0
  let updated = 0
  let skipped = 0

  for (const model of MODELS) {
    try {
      const existing = await prisma.lLMModel.findUnique({ where: { code: model.code } })
      if (existing) {
        await prisma.lLMModel.update({
          where: { code: model.code },
          data: {
            displayName: model.displayName,
            provider: model.provider,
            contextWindow: model.contextWindow,
            supportsVision: model.supportsVision,
            supportsStreaming: model.supportsStreaming,
            inputCostPer1M: model.inputCostPer1M,
            outputCostPer1M: model.outputCostPer1M,
            isActive: model.isActive ?? true
          }
        })
        console.log(`✅ Updated: ${model.code} (${model.displayName})`)
        updated++
      } else {
        await prisma.lLMModel.create({
          data: {
            code: model.code,
            displayName: model.displayName,
            provider: model.provider,
            contextWindow: model.contextWindow,
            supportsVision: model.supportsVision,
            supportsStreaming: model.supportsStreaming,
            inputCostPer1M: model.inputCostPer1M,
            outputCostPer1M: model.outputCostPer1M,
            isActive: model.isActive ?? true,
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
  console.log(`   Total:   ${MODELS.length}`)

  console.log('\n✅ Done! You can now select these models in Super Admin → LLM Config.')
}

main()
  .catch((e) => {
    console.error('Script failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })


