const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function assignPlans() {
  try {
    // Find free plan
    const freePlan = await prisma.plan.findFirst({
      where: { code: 'FREE_PLAN' }
    });
    
    if (!freePlan) {
      console.log('❌ FREE_PLAN not found. Run seed-llm-models.ts first.');
      return;
    }
    
    console.log('✅ Found FREE_PLAN:', freePlan.id);
    
    // Find tenants without plans
    const tenants = await prisma.tenant.findMany({
      include: { tenantPlans: true }
    });
    
    for (const tenant of tenants) {
      if (tenant.tenantPlans.length === 0) {
        await prisma.tenantPlan.create({
          data: {
            tenantId: tenant.id,
            planId: freePlan.id,
            effectiveFrom: new Date(),
            status: 'ACTIVE'
          }
        });
        console.log('✅ Assigned FREE_PLAN to tenant:', tenant.name);
      } else {
        console.log('ℹ️  Tenant already has plan:', tenant.name);
      }
    }
    
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

assignPlans();

