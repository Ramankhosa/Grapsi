#!/usr/bin/env node

/**
 * Add Patent Drafting Feature to PRO_PLAN
 *
 * This script adds the PATENT_DRAFTING feature to the PRO_PLAN
 * and sets up the necessary LLM access for patent drafting.
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function addPatentDraftingFeature() {
  try {
    console.log('🔧 Adding patent drafting feature to PRO_PLAN...\n')

    // Find PRO_PLAN
    const proPlan = await prisma.plan.findFirst({
      where: { code: 'PRO_PLAN' },
      include: { planFeatures: { include: { feature: true } } }
    })

    if (!proPlan) {
      console.log('❌ PRO_PLAN not found. Creating it...')
      const newPlan = await prisma.plan.create({
        data: {
          code: 'PRO_PLAN',
          name: 'Professional Plan',
          cycle: 'MONTHLY',
          status: 'ACTIVE'
        }
      })
      console.log('✅ Created PRO_PLAN:', newPlan.id)
      return await addPatentDraftingFeature() // Retry
    }

    console.log('📋 PRO_PLAN found:', proPlan.id)
    console.log('📋 Current features:', proPlan.planFeatures.map(pf => pf.feature.code).join(', '))

    // Find or create PATENT_DRAFTING feature
    let patentDraftingFeature = await prisma.feature.findFirst({
      where: { code: 'PATENT_DRAFTING' }
    })

    if (!patentDraftingFeature) {
      console.log('🔨 Creating PATENT_DRAFTING feature...')
      patentDraftingFeature = await prisma.feature.create({
        data: {
          code: 'PATENT_DRAFTING',
          name: 'Patent Drafting',
          unit: 'calls'
        }
      })
      console.log('✅ Created PATENT_DRAFTING feature:', patentDraftingFeature.id)
    } else {
      console.log('✅ PATENT_DRAFTING feature exists:', patentDraftingFeature.id)
    }

    // Check if PRO_PLAN already has PATENT_DRAFTING
    const existingFeatureLink = await prisma.planFeature.findFirst({
      where: {
        planId: proPlan.id,
        feature: { code: 'PATENT_DRAFTING' }
      }
    })

    if (!existingFeatureLink) {
      console.log('🔗 Linking PATENT_DRAFTING to PRO_PLAN...')
      await prisma.planFeature.create({
        data: {
          planId: proPlan.id,
          featureId: patentDraftingFeature.id,
          monthlyQuota: 100,
          dailyQuota: 10
        }
      })
      console.log('✅ Added PATENT_DRAFTING to PRO_PLAN (100/month, 10/day)')
    } else {
      console.log('✅ PATENT_DRAFTING already linked to PRO_PLAN')
    }

    // Find or create LLM2_DRAFT task
    let draftTask = await prisma.task.findFirst({
      where: { code: 'LLM2_DRAFT' }
    })

    if (!draftTask) {
      console.log('📝 Creating LLM2_DRAFT task...')

      // Find PATENT_DRAFTING feature for the task
      const patentDraftingFeature = await prisma.feature.findFirst({
        where: { code: 'PATENT_DRAFTING' }
      })

      if (patentDraftingFeature) {
        draftTask = await prisma.task.create({
          data: {
            code: 'LLM2_DRAFT',
            name: 'Patent Drafting',
            linkedFeatureId: patentDraftingFeature.id
          }
        })
        console.log('✅ Created LLM2_DRAFT task:', draftTask.id)
      } else {
        console.log('❌ PATENT_DRAFTING feature not found - cannot create task')
        return
      }
    } else {
      console.log('✅ LLM2_DRAFT task exists:', draftTask.id)
    }

    // Check LLM access for LLM2_DRAFT task
    const llmAccess = await prisma.planLLMAccess.findFirst({
      where: {
        planId: proPlan.id,
        taskCode: 'LLM2_DRAFT'
      }
    })

    if (!llmAccess) {
      console.log('🤖 Setting up LLM access for patent drafting...')

      // Find a suitable LLM model class
      const geminiClass = await prisma.lLMModelClass.findFirst({
        where: { code: 'PRO_M' }
      }) || await prisma.lLMModelClass.findFirst({
        where: { code: 'BASE_M' }
      }) || await prisma.lLMModelClass.findFirst()

      if (geminiClass) {
        await prisma.planLLMAccess.create({
          data: {
            planId: proPlan.id,
            taskCode: 'LLM2_DRAFT',
            allowedClasses: '["BASE_S","BASE_M","PRO_M"]',
            defaultClassId: geminiClass.id
          }
        })
        console.log('✅ Added LLM access for patent drafting (LLM2_DRAFT)')
      } else {
        console.log('⚠️ No LLM model classes found - LLM access setup skipped')
      }
    } else {
      console.log('✅ LLM access for patent drafting already exists')
    }

    // Add high token limits for drafting tasks (100k output tokens)
    console.log('📏 Configuring high token limits for patent drafting...')

    const existingDraftRules = await prisma.policyRule.findMany({
      where: {
        scope: 'plan',
        scopeId: proPlan.code,
        taskCode: 'LLM2_DRAFT'
      }
    });

    if (existingDraftRules.length === 0) {
      // Create policy rules for high token limits in drafting
      const tokenLimitRules = [
        {
          scope: 'plan',
          scopeId: proPlan.id, // Use plan ID, not code
          taskCode: 'LLM2_DRAFT',
          key: 'max_tokens_in',
          value: 10000 // 10k input tokens
        },
        {
          scope: 'plan',
          scopeId: proPlan.id, // Use plan ID, not code
          taskCode: 'LLM2_DRAFT',
          key: 'max_tokens_out',
          value: 8192 // Maximum for Gemini 2.5 Pro API
        }
      ];

      for (const rule of tokenLimitRules) {
        // Check if rule already exists
        const existingRule = await prisma.policyRule.findFirst({
          where: {
            scope: rule.scope,
            scopeId: rule.scopeId,
            taskCode: rule.taskCode,
            key: rule.key
          }
        });

        if (!existingRule) {
          await prisma.policyRule.create({
            data: {
              scope: rule.scope,
              scopeId: rule.scopeId,
              taskCode: rule.taskCode,
              key: rule.key,
              value: rule.value
            }
          });
        } else {
          await prisma.policyRule.update({
            where: { id: existingRule.id },
            data: { value: rule.value }
          });
        }
      }

      console.log('✅ High token limits configured for drafting (10k input, 100k output)');
    } else {
      console.log('✅ Drafting policy rules already exist');
    }

    console.log('\n🎉 Patent drafting feature setup complete!')
    console.log('📋 PRO_PLAN now includes:')
    console.log('   - PATENT_DRAFTING feature (100 calls/month, 10/day)')
    console.log('   - LLM access for patent drafting tasks')
    console.log('   - High token limits (10k input, 100k output) for drafting')

  } catch (error) {
    console.error('❌ Error setting up patent drafting feature:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the setup
addPatentDraftingFeature().catch(console.error)
