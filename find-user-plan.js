const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findUserPlan() {
  try {
    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: 'analysts@spotiPR.com' },
      include: {
        tenant: {
          include: {
            tenantPlans: {
              where: { status: 'ACTIVE' },
              include: {
                plan: {
                  include: {
                    planFeatures: {
                      include: { feature: true }
                    }
                  }
                }
              },
              orderBy: { effectiveFrom: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    if (!user) {
      console.log('User analysts@spotiPR.com not found in database');
      return;
    }

    console.log('User found:');
    console.log('- Email:', user.email);
    console.log('- Name:', user.name || 'N/A');
    console.log('- Tenant:', user.tenant?.name || 'No tenant');
    console.log('- Status:', user.status);
    console.log('- Roles:', user.roles);

    if (user.tenant?.tenantPlans && user.tenant.tenantPlans.length > 0) {
      const activePlan = user.tenant.tenantPlans[0];
      console.log('\nActive Plan:');
      console.log('- Plan Name:', activePlan.plan.name);
      console.log('- Plan Code:', activePlan.plan.code);
      console.log('- Effective From:', activePlan.effectiveFrom);
      console.log('- Expires At:', activePlan.expiresAt || 'No expiration');
      console.log('- Plan Status:', activePlan.status);

      console.log('\nPlan Features:');
      activePlan.plan.planFeatures.forEach(pf => {
        console.log(`- ${pf.feature.name} (${pf.feature.code}): Monthly ${pf.monthlyQuota || 'unlimited'}, Daily ${pf.dailyQuota || 'unlimited'}`);
      });
    } else {
      console.log('\nNo active plan found for this user\'s tenant');
    }

  } catch (error) {
    console.error('Error querying database:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

findUserPlan();





























