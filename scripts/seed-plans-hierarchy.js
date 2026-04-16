const { PrismaClient } = require('@prisma/client');

async function seedPlansAndHierarchy() {
  const prisma = new PrismaClient();

  try {
    console.log('🌱 Starting comprehensive plan and hierarchy seeding...');

    // 1. Create all features
    console.log('\n📋 Step 1: Creating Features...');
    const features = [
      { code: 'PRIOR_ART_SEARCH', name: 'Patent and Literature Search', unit: 'queries' },
      { code: 'PATENT_DRAFTING', name: 'AI-Assisted Patent Drafting', unit: 'tokens' },
      { code: 'DIAGRAM_GENERATION', name: 'Technical Diagram Generation', unit: 'diagrams' },
      { code: 'IDEA_BANK', name: 'Idea Bank Access', unit: 'reservations' },
      { code: 'PERSONA_SYNC', name: 'PersonaSync Style Learning', unit: 'trainings' }
    ];

    const createdFeatures = {};
    for (const featureData of features) {
      let feature = await prisma.feature.findUnique({
        where: { code: featureData.code }
      });

      if (!feature) {
        feature = await prisma.feature.create({
          data: featureData
        });
        console.log(`✅ Created feature: ${feature.code}`);
      } else {
        console.log(`✓ Feature exists: ${feature.code}`);
      }
      createdFeatures[featureData.code] = feature;
    }

    // 2. Create all tasks
    console.log('\n🎯 Step 2: Creating Tasks...');
    const tasks = [
      { code: 'LLM1_PRIOR_ART', name: 'Prior Art Search', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'LLM2_DRAFT', name: 'Patent Drafting', linkedFeature: 'PATENT_DRAFTING' },
      { code: 'LLM3_DIAGRAM', name: 'Diagram Generation', linkedFeature: 'DIAGRAM_GENERATION' },
      { code: 'LLM4_NOVELTY_SCREEN', name: 'Novelty Screening', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'LLM5_NOVELTY_ASSESS', name: 'Novelty Assessment', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'LLM6_REPORT_GENERATION', name: 'Report Generation', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'IDEA_BANK_ACCESS', name: 'Idea Bank Access', linkedFeature: 'IDEA_BANK' },
      { code: 'IDEA_BANK_RESERVE', name: 'Idea Reservation', linkedFeature: 'IDEA_BANK' },
      { code: 'IDEA_BANK_EDIT', name: 'Idea Editing', linkedFeature: 'IDEA_BANK' },
      { code: 'PERSONA_SYNC_LEARN', name: 'Style Learning', linkedFeature: 'PERSONA_SYNC' }
    ];

    const createdTasks = {};
    for (const taskData of tasks) {
      let task = await prisma.task.findUnique({
        where: { code: taskData.code }
      });

      if (!task) {
        task = await prisma.task.create({
          data: {
            code: taskData.code,
            name: taskData.name,
            linkedFeatureId: createdFeatures[taskData.linkedFeature].id
          }
        });
        console.log(`✅ Created task: ${task.code}`);
      } else {
        console.log(`✓ Task exists: ${task.code}`);
      }
      createdTasks[taskData.code] = task;
    }

    // 3. Create LLM Model Classes
    console.log('\n🤖 Step 3: Creating LLM Model Classes...');
    const modelClasses = [
      { code: 'BASE_S', name: 'Base Small' },
      { code: 'BASE_M', name: 'Base Medium' },
      { code: 'PRO_M', name: 'Professional Medium' },
      { code: 'PRO_L', name: 'Professional Large' },
      { code: 'ADVANCED', name: 'Advanced' }
    ];

    const createdModelClasses = {};
    for (const mcData of modelClasses) {
      let modelClass = await prisma.lLMModelClass.findUnique({
        where: { code: mcData.code }
      });

      if (!modelClass) {
        modelClass = await prisma.lLMModelClass.create({
          data: mcData
        });
        console.log(`✅ Created model class: ${modelClass.code}`);
      } else {
        console.log(`✓ Model class exists: ${modelClass.code}`);
      }
      createdModelClasses[mcData.code] = modelClass;
    }

    // 4. Create plans
    console.log('\n📋 Step 4: Creating Plans...');
    const plans = [
      {
        code: 'FREE_PLAN',
        name: 'Basic Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE',
        description: 'Basic access with limited features'
      },
      {
        code: 'PRO_PLAN',
        name: 'Professional Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE',
        description: 'Full access to all features'
      },
      {
        code: 'ENTERPRISE_PLAN',
        name: 'Enterprise Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE',
        description: 'Advanced features with higher limits'
      }
    ];

    const createdPlans = {};
    for (const planData of plans) {
      let plan = await prisma.plan.findUnique({
        where: { code: planData.code }
      });

      if (!plan) {
        plan = await prisma.plan.create({
          data: {
            code: planData.code,
            name: planData.name,
            cycle: planData.cycle,
            status: planData.status
          }
        });
        console.log(`✅ Created plan: ${plan.code}`);
      } else {
        console.log(`✓ Plan exists: ${plan.code}`);
      }
      createdPlans[planData.code] = plan;
    }

    // 5. Set up plan features
    console.log('\n🔗 Step 5: Setting up Plan Features...');
    const planFeatures = [
      // BASIC PLAN (FREE_PLAN) - Patent drafting + novelty search
      { planCode: 'FREE_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 50, dailyQuota: 10 },
      { planCode: 'FREE_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 1000, dailyQuota: 100 },

      // PRO PLAN - Basic services + Idea Bank + Diagram generation
      { planCode: 'PRO_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 1000, dailyQuota: 100 },
      { planCode: 'PRO_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 10000, dailyQuota: 1000 },
      { planCode: 'PRO_PLAN', featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 200, dailyQuota: 40 },
      { planCode: 'PRO_PLAN', featureCode: 'IDEA_BANK', monthlyQuota: 50, dailyQuota: 10 },

      // ENTERPRISE PLAN - Everything (all features)
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 5000, dailyQuota: 500 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 50000, dailyQuota: 5000 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 500, dailyQuota: 100 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'IDEA_BANK', monthlyQuota: 200, dailyQuota: 50 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'PERSONA_SYNC', monthlyQuota: 50, dailyQuota: 10 }
    ];

    for (const pfData of planFeatures) {
      const existing = await prisma.planFeature.findFirst({
        where: {
          planId: createdPlans[pfData.planCode].id,
          featureId: createdFeatures[pfData.featureCode].id
        }
      });

      if (!existing) {
        await prisma.planFeature.create({
          data: {
            planId: createdPlans[pfData.planCode].id,
            featureId: createdFeatures[pfData.featureCode].id,
            monthlyQuota: pfData.monthlyQuota,
            dailyQuota: pfData.dailyQuota
          }
        });
        console.log(`✅ Added ${pfData.featureCode} to ${pfData.planCode}`);
      }
    }

    // 6. Set up LLM access for plans
    console.log('\n🤖 Step 6: Setting up LLM Access...');
    const llmAccess = [
      // BASIC PLAN (FREE_PLAN) - Patent drafting + novelty search
      { planCode: 'FREE_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },

      // PRO PLAN - Basic services + Idea Bank + Diagram generation
      { planCode: 'PRO_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_L' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM3_DIAGRAM', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_ACCESS', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_RESERVE', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_EDIT', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },

      // ENTERPRISE PLAN - All access (everything)
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM3_DIAGRAM', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_L' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_ACCESS', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_RESERVE', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_EDIT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'PERSONA_SYNC_LEARN', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' }
    ];

    for (const accessData of llmAccess) {
      const existing = await prisma.planLLMAccess.findFirst({
        where: {
          planId: createdPlans[accessData.planCode].id,
          taskCode: accessData.taskCode
        }
      });

      if (!existing) {
        await prisma.planLLMAccess.create({
          data: {
            planId: createdPlans[accessData.planCode].id,
            taskCode: accessData.taskCode,
            allowedClasses: JSON.stringify(accessData.allowedClasses), // Store as JSON string
            defaultClassId: createdModelClasses[accessData.defaultClass].id
          }
        });
        console.log(`✅ Added ${accessData.taskCode} access to ${accessData.planCode}`);
      }
    }

    // 7. Assign plans to tenants based on users
    console.log('\n🏢 Step 7: Assigning Plans to Tenants...');

        // Get all tenants and their users
        const tenants = await prisma.tenant.findMany({
          include: {
            users: {
              select: { roles: true }
            }
          }
        });

    for (const tenant of tenants) {
      console.log(`\nProcessing tenant: ${tenant.name} (${tenant.atiId}) [${tenant.type}]`);

      // Determine plan based on tenant users
      let assignedPlanCode = 'FREE_PLAN'; // Default

      // Check if tenant has super admin
      const hasSuperAdmin = tenant.users.some(user => user.roles?.includes('SUPER_ADMIN'));
      const hasTenantAdmin = tenant.users.some(user => user.roles?.includes('ADMIN'));
      const hasAnalyst = tenant.users.some(user => user.roles?.includes('ANALYST'));

      if (hasSuperAdmin) {
        assignedPlanCode = 'ENTERPRISE_PLAN';
        console.log(`  ↳ Super Admin detected → ${assignedPlanCode}`);
      } else if (hasTenantAdmin || hasAnalyst) {
        assignedPlanCode = 'PRO_PLAN';
        console.log(`  ↳ Admin/Analyst detected → ${assignedPlanCode}`);
      } else {
        console.log(`  ↳ Basic users → ${assignedPlanCode}`);
      }

      // Check if plan is already assigned
      const existingTenantPlan = await prisma.tenantPlan.findFirst({
        where: { tenantId: tenant.id },
        include: { plan: true }
      });

      if (existingTenantPlan) {
        if (existingTenantPlan.plan.code !== assignedPlanCode) {
          console.log(`  ↳ Updating plan from ${existingTenantPlan.plan.code} to ${assignedPlanCode}`);
          await prisma.tenantPlan.update({
            where: { id: existingTenantPlan.id },
            data: {
              planId: createdPlans[assignedPlanCode].id,
              status: 'ACTIVE'
            }
          });
        } else {
          console.log(`  ↳ Already has correct plan: ${assignedPlanCode}`);
        }
      } else {
        // Create new tenant plan
        await prisma.tenantPlan.create({
          data: {
            tenantId: tenant.id,
            planId: createdPlans[assignedPlanCode].id,
            effectiveFrom: new Date(),
            status: 'ACTIVE'
          }
        });
        console.log(`  ↳ Assigned new plan: ${assignedPlanCode}`);
      }
    }

    // 8. Create sample data for testing
    console.log('\n🎯 Step 8: Creating Sample Data...');

    // Create some sample ideas if they don't exist
    const existingIdeas = await prisma.ideaBankIdea.count();
    if (existingIdeas === 0) {
      console.log('Creating sample ideas...');

      // Get the first analyst user to use as creator
      const analystUser = await prisma.user.findFirst({
        where: {
          roles: {
            has: 'ANALYST'
          }
        }
      });

      if (analystUser) {
        const sampleIdeas = [
          {
            title: 'AI-Powered Medical Diagnosis System',
            description: 'A machine learning system that analyzes medical images and patient data to provide early disease detection with 95% accuracy.',
            domainTags: ['AI/ML', 'Medical Devices'],
            status: 'PUBLIC',
            createdBy: analystUser.id
          },
          {
            title: 'Smart Grid Energy Optimization',
            description: 'An intelligent energy management system for power grids using predictive analytics.',
            domainTags: ['Energy', 'IoT'],
            status: 'PUBLIC',
            createdBy: analystUser.id
          },
          {
            title: 'Blockchain Supply Chain Tracking',
            description: 'A decentralized platform for transparent supply chain management.',
            domainTags: ['Blockchain', 'Supply Chain'],
            status: 'PUBLIC',
            createdBy: analystUser.id
          }
        ];

        for (const idea of sampleIdeas) {
          await prisma.ideaBankIdea.create({ data: idea });
        }
        console.log('✅ Created sample ideas');
      } else {
        console.log('⚠️  No analyst user found, skipping sample ideas creation');
      }
    }

    // 9. Final verification
    console.log('\n🎉 Step 9: Final Verification...');

    const finalStats = {
      features: await prisma.feature.count(),
      tasks: await prisma.task.count(),
      plans: await prisma.plan.count(),
      tenants: await prisma.tenant.count(),
      tenantPlans: await prisma.tenantPlan.count(),
      users: await prisma.user.count(),
      ideas: await prisma.ideaBankIdea.count()
    };

    console.log('\n📊 Final Statistics:');
    Object.entries(finalStats).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    console.log('\n🏆 PLAN HIERARCHY SUMMARY:');
    console.log('  FREE_PLAN: Basic access (Prior Art, Drafting, Idea Bank)');
    console.log('  PRO_PLAN: Full access (All features, higher limits)');
    console.log('  ENTERPRISE_PLAN: Advanced access (All features, highest limits)');
    console.log('');
    console.log('  Auto-assignment based on tenant users:');
    console.log('  - Super Admin tenants → ENTERPRISE_PLAN');
    console.log('  - Admin/Analyst tenants → PRO_PLAN');
    console.log('  - Basic tenants → FREE_PLAN');

    console.log('\n✅ Seeding completed successfully! 🎉');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding
seedPlansAndHierarchy().catch(console.error);
