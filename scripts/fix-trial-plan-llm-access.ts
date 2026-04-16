/**
 * Fix Trial Plan LLM Access
 * 
 * This script adds the missing PlanLLMAccess entries for the TRIAL plan,
 * allowing trial users to use ideation and other LLM-powered features.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixTrialPlanLLMAccess() {
  console.log('=== Fixing Trial Plan LLM Access ===\n')

  // 1. Find the TRIAL plan
  const trialPlan = await prisma.plan.findUnique({
    where: { code: 'TRIAL' }
  })

  if (!trialPlan) {
    console.error('❌ TRIAL plan not found! Run seedTrialPlan() first.')
    await prisma.$disconnect()
    return
  }

  console.log(`✓ Found TRIAL plan: ${trialPlan.id}`)

  // 2. Get the BASE_S model class (most cost-effective for trial users)
  const baseModelClass = await prisma.lLMModelClass.findFirst({
    where: { code: 'BASE_S' }
  })

  if (!baseModelClass) {
    console.error('❌ BASE_S model class not found!')
    await prisma.$disconnect()
    return
  }

  console.log(`✓ Found BASE_S model class: ${baseModelClass.id}`)

  // 3. Define all task codes that trial users need access to
  const taskCodes = [
    // Ideation tasks (7 stages)
    'IDEATION_NORMALIZE',
    'IDEATION_CLASSIFY',
    'IDEATION_CONTRADICTION_MAPPING',
    'IDEATION_EXPAND',
    'IDEATION_OBVIOUSNESS_FILTER',
    'IDEATION_GENERATE',
    'IDEATION_NOVELTY',
    // Other LLM tasks
    'LLM1_PRIOR_ART',
    'LLM2_DRAFT',
    'LLM3_DIAGRAM',
    'LLM4_NOVELTY_SCREEN',
    'LLM5_NOVELTY_ASSESS',
    'LLM6_REPORT_GENERATION',
    'LLM1_CLAIM_REFINEMENT',
    'IDEA_BANK_ACCESS',
    'IDEA_BANK_RESERVE',
    'IDEA_BANK_EDIT',
    'PERSONA_SYNC_LEARN'
  ] as const

  // 4. Create PlanLLMAccess entries for each task
  console.log('\n📝 Creating PlanLLMAccess entries...')

  let created = 0
  let skipped = 0

  for (const taskCode of taskCodes) {
    // Check if already exists
    const existing = await prisma.planLLMAccess.findFirst({
      where: {
        planId: trialPlan.id,
        taskCode: taskCode
      }
    })

    if (existing) {
      console.log(`   ⏭️ ${taskCode}: already exists`)
      skipped++
      continue
    }

    try {
      await prisma.planLLMAccess.create({
        data: {
          planId: trialPlan.id,
          taskCode: taskCode,
          defaultClassId: baseModelClass.id,
          allowedClasses: JSON.stringify(['BASE_S'])
        }
      })
      console.log(`   ✅ ${taskCode}: created`)
      created++
    } catch (error: any) {
      if (error.code === 'P2002') {
        console.log(`   ⏭️ ${taskCode}: already exists (race condition)`)
        skipped++
      } else {
        console.error(`   ❌ ${taskCode}: ${error.message}`)
      }
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`Created: ${created}`)
  console.log(`Skipped (already existed): ${skipped}`)

  // 5. Verify the setup
  console.log('\n📊 Verifying TRIAL plan configuration...')
  
  const planAccess = await prisma.planLLMAccess.findMany({
    where: { planId: trialPlan.id },
    include: { defaultClass: true }
  })

  console.log(`\nTRIAL plan now has ${planAccess.length} LLM access entries:`)
  for (const access of planAccess) {
    console.log(`   - ${access.taskCode}: ${access.defaultClass.code}`)
  }

  await prisma.$disconnect()
  console.log('\n✅ Done! Trial users should now be able to use ideation.')
}

fixTrialPlanLLMAccess().catch(e => {
  console.error('Error:', e)
  prisma.$disconnect()
  process.exit(1)
})

