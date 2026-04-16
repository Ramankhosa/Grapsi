const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setupCompleteProPlan() {
  try {
    console.log('=== COMPLETE PRO PLAN SETUP ===');

    // 1. Create missing features
    console.log('\n1. Creating missing features...');
    const featuresToCreate = [
      { code: 'IDEA_BANK', name: 'Idea Bank Access', unit: 'reservations' }
    ];

    for (const featureData of featuresToCreate) {
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
    }

    // 2. Get PRO plan
    console.log('\n2. Getting PRO plan...');
    let proPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' }
    });

    if (!proPlan) {
      proPlan = await prisma.plan.create({
        data: {
          code: 'PRO_PLAN',
          name: 'Professional Plan',
          cycle: 'MONTHLY',
          status: 'ACTIVE'
        }
      });
      console.log('✅ Created PRO plan');
    }

    // 3. Get all features and add to PRO plan
    console.log('\n3. Adding all features to PRO plan...');
    const allFeatures = await prisma.feature.findMany();

    for (const feature of allFeatures) {
      const existing = await prisma.planFeature.findFirst({
        where: {
          planId: proPlan.id,
          featureId: feature.id
        }
      });

      if (!existing) {
        await prisma.planFeature.create({
          data: {
            planId: proPlan.id,
            featureId: feature.id,
            monthlyQuota: feature.code === 'IDEA_BANK' ? 50 : 1000,
            dailyQuota: feature.code === 'IDEA_BANK' ? 10 : 100
          }
        });
        console.log(`✅ Added ${feature.code} to PRO plan`);
      }
    }

    // 4. Ensure analyst has PRO plan assigned
    console.log('\n4. Assigning PRO plan to analyst tenant...');
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' }
    });

    if (analyst && analyst.tenantId) {
      const existingTenantPlan = await prisma.tenantPlan.findFirst({
        where: { tenantId: analyst.tenantId }
      });

      if (!existingTenantPlan) {
        await prisma.tenantPlan.create({
          data: {
            tenantId: analyst.tenantId,
            planId: proPlan.id,
            effectiveFrom: new Date(),
            status: 'ACTIVE'
          }
        });
        console.log('✅ Assigned PRO plan to analyst tenant');
      } else {
        console.log('✓ Analyst tenant already has a plan assigned');
      }
    }

    // 5. Final verification
    console.log('\n=== FINAL VERIFICATION ===');

    const finalPlanFeatures = await prisma.planFeature.findMany({
      where: { planId: proPlan.id },
      include: { feature: true }
    });

    console.log('PRO PLAN FEATURES:');
    finalPlanFeatures.forEach(pf => {
      console.log(`- ${pf.feature.code}: ${pf.feature.name} (${pf.monthlyQuota}/month)`);
    });

    const tenantPlan = analyst?.tenantId ? await prisma.tenantPlan.findFirst({
      where: { tenantId: analyst.tenantId },
      include: { plan: true }
    }) : null;

    console.log(`\nAnalyst tenant plan: ${tenantPlan?.plan.code}`);

    console.log('\n✅ SETUP COMPLETE! analyst@spotipr.com now has access to all services including Idea Bank');

  } catch (error) {
    console.error('Error in setup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupCompleteProPlan();
