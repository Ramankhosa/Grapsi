/**
 * Seed script to add Search Strategy as a Pro feature
 * 
 * Run this script with: node scripts/seed-search-strategy-feature.js
 * 
 * This adds:
 * 1. SEARCH_STRATEGY feature
 * 2. SEARCH_STRATEGY_GEN task linked to the feature
 * 3. Plan features for PRO_PLAN and ENTERPRISE_PLAN
 * 4. LLM access configurations
 * 
 * Note: Requires SEARCH_STRATEGY in FeatureCode enum and 
 *       SEARCH_STRATEGY_GEN in TaskCode enum in schema.prisma
 */

const { PrismaClient } = require('@prisma/client');

async function seedSearchStrategyFeature() {
  const prisma = new PrismaClient();

  try {
    console.log('🌱 Starting Search Strategy feature seeding...\n');

    // 1. Create the Search Strategy feature (using enum value)
    console.log('📋 Step 1: Creating SEARCH_STRATEGY feature...');
    let searchStrategyFeature = await prisma.feature.findUnique({
      where: { code: 'SEARCH_STRATEGY' } // Prisma uses string representation of enum
    });

    if (!searchStrategyFeature) {
      searchStrategyFeature = await prisma.feature.create({
        data: {
          code: 'SEARCH_STRATEGY', // Must match FeatureCode enum value
          name: 'AI Search Strategy Generation',
          unit: 'strategies'
        }
      });
      console.log('✅ Created feature: SEARCH_STRATEGY');
    } else {
      console.log('✓ Feature exists: SEARCH_STRATEGY');
    }

    // 2. Create the task linked to this feature (using enum value)
    console.log('\n🎯 Step 2: Creating SEARCH_STRATEGY_GEN task...');
    let searchStrategyTask = await prisma.task.findUnique({
      where: { code: 'SEARCH_STRATEGY_GEN' } // Must match TaskCode enum value
    });

    if (!searchStrategyTask) {
      searchStrategyTask = await prisma.task.create({
        data: {
          code: 'SEARCH_STRATEGY_GEN', // Must match TaskCode enum value
          name: 'Search Strategy Generation',
          linkedFeatureId: searchStrategyFeature.id
        }
      });
      console.log('✅ Created task: SEARCH_STRATEGY_GEN');
    } else {
      console.log('✓ Task exists: SEARCH_STRATEGY_GEN');
    }

    // 3. Get plans
    console.log('\n📋 Step 3: Looking up plans...');
    const proPlan = await prisma.plan.findUnique({ where: { code: 'PRO_PLAN' } });
    const enterprisePlan = await prisma.plan.findUnique({ where: { code: 'ENTERPRISE_PLAN' } });

    if (!proPlan || !enterprisePlan) {
      console.log('⚠️  PRO_PLAN or ENTERPRISE_PLAN not found. Run seed-plans-hierarchy.js first.');
      console.log('   Running: node scripts/seed-plans-hierarchy.js');
      
      // Let's create them if they don't exist
      const plans = [
        { code: 'PRO_PLAN', name: 'Professional Plan', cycle: 'MONTHLY', status: 'ACTIVE' },
        { code: 'ENTERPRISE_PLAN', name: 'Enterprise Plan', cycle: 'MONTHLY', status: 'ACTIVE' }
      ];
      
      for (const planData of plans) {
        const existingPlan = await prisma.plan.findUnique({ where: { code: planData.code } });
        if (!existingPlan) {
          await prisma.plan.create({ data: planData });
          console.log(`✅ Created plan: ${planData.code}`);
        }
      }
    }

    // Refetch plans
    const proPlanFinal = await prisma.plan.findUnique({ where: { code: 'PRO_PLAN' } });
    const enterprisePlanFinal = await prisma.plan.findUnique({ where: { code: 'ENTERPRISE_PLAN' } });

    // 4. Add feature to Pro and Enterprise plans
    console.log('\n🔗 Step 4: Adding SEARCH_STRATEGY to Pro and Enterprise plans...');
    
    const planFeatures = [
      { planId: proPlanFinal?.id, monthlyQuota: 20, dailyQuota: 5 },
      { planId: enterprisePlanFinal?.id, monthlyQuota: 100, dailyQuota: 20 }
    ];

    for (const pf of planFeatures) {
      if (!pf.planId) continue;
      
      const existing = await prisma.planFeature.findFirst({
        where: {
          planId: pf.planId,
          featureId: searchStrategyFeature.id
        }
      });

      if (!existing) {
        await prisma.planFeature.create({
          data: {
            planId: pf.planId,
            featureId: searchStrategyFeature.id,
            monthlyQuota: pf.monthlyQuota,
            dailyQuota: pf.dailyQuota
          }
        });
        console.log(`✅ Added SEARCH_STRATEGY to plan with quota ${pf.monthlyQuota}/month`);
      } else {
        console.log(`✓ SEARCH_STRATEGY already exists for plan`);
      }
    }

    // 5. Set up LLM access for the task
    console.log('\n🤖 Step 5: Setting up LLM access for SEARCH_STRATEGY_GEN...');
    
    // Get model classes
    const proMClass = await prisma.lLMModelClass.findUnique({ where: { code: 'PRO_M' } });
    const advancedClass = await prisma.lLMModelClass.findUnique({ where: { code: 'ADVANCED' } });
    
    if (!proMClass || !advancedClass) {
      console.log('⚠️  Model classes not found. Creating them...');
      
      const modelClasses = [
        { code: 'BASE_S', name: 'Base Small' },
        { code: 'BASE_M', name: 'Base Medium' },
        { code: 'PRO_M', name: 'Professional Medium' },
        { code: 'PRO_L', name: 'Professional Large' },
        { code: 'ADVANCED', name: 'Advanced' }
      ];
      
      for (const mc of modelClasses) {
        const existing = await prisma.lLMModelClass.findUnique({ where: { code: mc.code } });
        if (!existing) {
          await prisma.lLMModelClass.create({ data: mc });
          console.log(`✅ Created model class: ${mc.code}`);
        }
      }
    }

    const proMFinal = await prisma.lLMModelClass.findUnique({ where: { code: 'PRO_M' } });
    const advancedFinal = await prisma.lLMModelClass.findUnique({ where: { code: 'ADVANCED' } });

    const llmAccess = [
      { 
        planCode: 'PRO_PLAN', 
        allowedClasses: ['BASE_M', 'PRO_M'], 
        defaultClassId: proMFinal?.id 
      },
      { 
        planCode: 'ENTERPRISE_PLAN', 
        allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], 
        defaultClassId: advancedFinal?.id 
      }
    ];

    for (const access of llmAccess) {
      const plan = await prisma.plan.findUnique({ where: { code: access.planCode } });
      if (!plan || !access.defaultClassId) continue;

      const existing = await prisma.planLLMAccess.findFirst({
        where: {
          planId: plan.id,
          taskCode: 'SEARCH_STRATEGY_GEN'
        }
      });

      if (!existing) {
        await prisma.planLLMAccess.create({
          data: {
            planId: plan.id,
            taskCode: 'SEARCH_STRATEGY_GEN',
            allowedClasses: JSON.stringify(access.allowedClasses),
            defaultClassId: access.defaultClassId
          }
        });
        console.log(`✅ Added LLM access for ${access.planCode}`);
      } else {
        console.log(`✓ LLM access already exists for ${access.planCode}`);
      }
    }

    // 6. Update existing users to Pro plan for testing (optional)
    console.log('\n👤 Step 6: Checking/updating user credits...');
    
    const usersWithoutCredits = await prisma.user.findMany({
      where: {
        credits: null
      },
      take: 10
    });

    console.log(`Found ${usersWithoutCredits.length} users without credits`);

    for (const user of usersWithoutCredits) {
      await prisma.userCredit.create({
        data: {
          userId: user.id,
          totalCredits: 100,
          usedCredits: 0,
          monthlyReset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          planTier: 'free'
        }
      });
      console.log(`✅ Created credits for user: ${user.email} (free tier)`);
    }

    // 7. Final stats
    console.log('\n📊 Final Statistics:');
    const stats = {
      features: await prisma.feature.count(),
      tasks: await prisma.task.count(),
      planFeatures: await prisma.planFeature.count(),
      planLLMAccess: await prisma.planLLMAccess.count(),
      userCredits: await prisma.userCredit.count()
    };
    
    Object.entries(stats).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    console.log('\n✅ Search Strategy feature seeding completed!');
    console.log('\n💡 To upgrade a user to Pro plan, run:');
    console.log('   node scripts/upgrade-user-to-pro.js <user-email>');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedSearchStrategyFeature().catch(console.error);

