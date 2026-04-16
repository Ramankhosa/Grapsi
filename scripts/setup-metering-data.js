#!/usr/bin/env node

/**
 * Setup script for metering system test data
 * Creates plans, features, and tenant associations for testing
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function setupMeteringData() {
  console.log('🔧 Setting up metering test data...\n')

  try {
    // Create features
    console.log('1. Creating features...')
    const features = await Promise.all([
      prisma.feature.upsert({
        where: { code: 'PATENT_DRAFTING' },
        update: {},
        create: {
          code: 'PATENT_DRAFTING',
          name: 'Patent Drafting',
          unit: 'tokens'
        }
      }),
      prisma.feature.upsert({
        where: { code: 'PRIOR_ART_SEARCH' },
        update: {},
        create: {
          code: 'PRIOR_ART_SEARCH',
          name: 'Prior Art Search',
          unit: 'calls'
        }
      })
    ])
    console.log('✅ Features ready:', features.map(f => f.code))

    // Create tasks
    console.log('\n2. Creating tasks...')
    const tasks = await Promise.all([
      prisma.task.upsert({
        where: { code: 'LLM2_DRAFT' },
        update: {},
        create: {
          code: 'LLM2_DRAFT',
          name: 'Patent Drafting',
          linkedFeatureId: features[0].id
        }
      }),
      prisma.task.upsert({
        where: { code: 'LLM1_PRIOR_ART' },
        update: {},
        create: {
          code: 'LLM1_PRIOR_ART',
          name: 'Prior Art Analysis',
          linkedFeatureId: features[1].id
        }
      })
    ])
    console.log('✅ Tasks ready:', tasks.map(t => t.code))

    // Create model classes
    console.log('\n3. Creating model classes...')
    const modelClasses = await Promise.all([
      prisma.lLMModelClass.upsert({
        where: { code: 'BASE_S' },
        update: {},
        create: {
          code: 'BASE_S',
          name: 'Base Small'
        }
      }),
      prisma.lLMModelClass.upsert({
        where: { code: 'PRO_M' },
        update: {},
        create: {
          code: 'PRO_M',
          name: 'Pro Medium'
        }
      })
    ])
    console.log('✅ Model classes ready:', modelClasses.map(m => m.code))

    // Create plans
    console.log('\n4. Creating plans...')
    const plans = await Promise.all([
      prisma.plan.upsert({
        where: { code: 'FREE_PLAN' },
        update: {},
        create: {
          code: 'FREE_PLAN',
          name: 'Free Plan',
          cycle: 'MONTHLY',
          status: 'ACTIVE'
        }
      }),
      prisma.plan.upsert({
        where: { code: 'PRO_PLAN' },
        update: {},
        create: {
          code: 'PRO_PLAN',
          name: 'Professional Plan',
          cycle: 'MONTHLY',
          status: 'ACTIVE'
        }
      })
    ])
    console.log('✅ Plans ready:', plans.map(p => p.code))

    // Create plan features
    console.log('\n5. Creating plan features...')
    const planFeatures = await Promise.all([
      // Free plan - limited features
      prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plans[0].id,
            featureId: features[0].id
          }
        },
        update: {},
        create: {
          planId: plans[0].id,
          featureId: features[0].id,
          monthlyQuota: 1000, // 1000 tokens/month
          dailyQuota: 100     // 100 tokens/day
        }
      }),
      prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plans[0].id,
            featureId: features[1].id
          }
        },
        update: {},
        create: {
          planId: plans[0].id,
          featureId: features[1].id,
          monthlyQuota: 50,   // 50 searches/month
          dailyQuota: 5       // 5 searches/day
        }
      }),

      // Pro plan - higher limits
      prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plans[1].id,
            featureId: features[0].id
          }
        },
        update: {},
        create: {
          planId: plans[1].id,
          featureId: features[0].id,
          monthlyQuota: 50000, // 50k tokens/month
          dailyQuota: 5000     // 5k tokens/day
        }
      }),
      prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plans[1].id,
            featureId: features[1].id
          }
        },
        update: {},
        create: {
          planId: plans[1].id,
          featureId: features[1].id,
          monthlyQuota: 1000,  // 1000 searches/month
          dailyQuota: 100      // 100 searches/day
        }
      })
    ])
    console.log('✅ Plan features ready:', planFeatures.length, 'feature assignments')

    // Create plan LLM access
    console.log('\n6. Creating plan LLM access...')
    const planAccess = await Promise.all([
      // Free plan - limited models
      prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: plans[0].id,
            taskCode: 'LLM2_DRAFT'
          }
        },
        update: {},
        create: {
          planId: plans[0].id,
          taskCode: 'LLM2_DRAFT',
          allowedClasses: JSON.stringify(['BASE_S']),
          defaultClassId: modelClasses[0].id
        }
      }),

      // Pro plan - more models
      prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: plans[1].id,
            taskCode: 'LLM2_DRAFT'
          }
        },
        update: {},
        create: {
          planId: plans[1].id,
          taskCode: 'LLM2_DRAFT',
          allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
          defaultClassId: modelClasses[1].id
        }
      }),
      prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: plans[1].id,
            taskCode: 'LLM1_PRIOR_ART'
          }
        },
        update: {},
        create: {
          planId: plans[1].id,
          taskCode: 'LLM1_PRIOR_ART',
          allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
          defaultClassId: modelClasses[1].id
        }
      })
    ])
    console.log('✅ Plan LLM access ready:', planAccess.length, 'access rules')

    // Check existing tenants and assign plans if needed
    console.log('\n7. Checking tenant plan assignments...')
    const existingTenants = await prisma.tenant.findMany({
      include: { tenantPlans: true }
    })

    for (const tenant of existingTenants) {
      if (tenant.tenantPlans.length === 0) {
        // Assign free plan to tenants without plans
        await prisma.tenantPlan.create({
          data: {
            tenantId: tenant.id,
            planId: plans[0].id, // Free plan
            effectiveFrom: new Date(),
            status: 'ACTIVE'
          }
        })
        console.log(`✅ Assigned free plan to tenant: ${tenant.name}`)
      } else {
        console.log(`ℹ️  Tenant ${tenant.name} already has ${tenant.tenantPlans.length} plan(s)`)
      }
    }

    console.log('\n🎉 Metering data setup complete!')
    console.log('\n📊 Summary:')
    console.log(`   Features: ${features.length}`)
    console.log(`   Tasks: ${tasks.length}`)
    console.log(`   Model Classes: ${modelClasses.length}`)
    console.log(`   Plans: ${plans.length}`)
    console.log(`   Plan Features: ${planFeatures.length}`)
    console.log(`   Plan LLM Access: ${planAccess.length}`)
    console.log(`   Tenants with plans: ${existingTenants.length}`)

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the setup
setupMeteringData()
  .then(() => {
    console.log('\n✨ Setup complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Setup failed:', error)
    process.exit(1)
  })
