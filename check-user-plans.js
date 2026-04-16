const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUserPlans() {
  try {
    // Find all users with their tenant and plan information
    const users = await prisma.user.findMany({
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

    console.log('All users and their plans:\n');

    users.forEach(user => {
      console.log(`User: ${user.email}`);
      console.log(`- Name: ${user.name || 'N/A'}`);
      console.log(`- Status: ${user.status}`);
      console.log(`- Roles: ${user.roles.join(', ')}`);
      console.log(`- Tenant: ${user.tenant?.name || 'No tenant'}`);

      if (user.tenant?.tenantPlans && user.tenant.tenantPlans.length > 0) {
        const activePlan = user.tenant.tenantPlans[0];
        console.log(`- Active Plan: ${activePlan.plan.name} (${activePlan.plan.code})`);
        console.log(`- Effective From: ${activePlan.effectiveFrom}`);
        console.log(`- Expires At: ${activePlan.expiresAt || 'No expiration'}`);

        console.log('- Plan Features:');
        activePlan.plan.planFeatures.forEach(pf => {
          console.log(`  * ${pf.feature.name}: Monthly ${pf.monthlyQuota || 'unlimited'}, Daily ${pf.dailyQuota || 'unlimited'}`);
        });
      } else {
        console.log('- No active plan found');
      }
      console.log('---\n');
    });

  } catch (error) {
    console.error('Error querying database:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserPlans();





























