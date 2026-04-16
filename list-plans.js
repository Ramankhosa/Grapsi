const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listPlans() {
  try {
    const plans = await prisma.plan.findMany({
      include: {
        planFeatures: {
          include: { feature: true }
        }
      }
    });

    console.log('Available plans:');
    plans.forEach(plan => {
      console.log(`- ${plan.name} (${plan.code}) - Status: ${plan.status}`);
      console.log('  Features:');
      plan.planFeatures.forEach(pf => {
        console.log(`    * ${pf.feature.name}: Monthly ${pf.monthlyQuota || 'unlimited'}, Daily ${pf.dailyQuota || 'unlimited'}`);
      });
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

listPlans();





























