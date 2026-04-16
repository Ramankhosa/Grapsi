/**
 * Script to upgrade a user to Pro plan
 * 
 * Usage: node scripts/upgrade-user-to-pro.js <user-email>
 * 
 * Example: node scripts/upgrade-user-to-pro.js test@example.com
 */

const { PrismaClient } = require('@prisma/client');

async function upgradeUserToPro() {
  const prisma = new PrismaClient();
  
  const email = process.argv[2];
  const planTier = process.argv[3] || 'pro'; // Can also use 'enterprise'
  
  if (!email) {
    console.log('❌ Usage: node scripts/upgrade-user-to-pro.js <user-email> [plan-tier]');
    console.log('   Plan tiers: free, basic, pro, enterprise');
    console.log('   Example: node scripts/upgrade-user-to-pro.js test@example.com pro');
    process.exit(1);
  }

  const validTiers = ['free', 'basic', 'pro', 'enterprise'];
  if (!validTiers.includes(planTier)) {
    console.log(`❌ Invalid plan tier: ${planTier}`);
    console.log(`   Valid tiers: ${validTiers.join(', ')}`);
    process.exit(1);
  }

  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { credits: true }
    });

    if (!user) {
      console.log(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log(`\n👤 User found: ${user.name || user.email}`);
    console.log(`   Current plan: ${user.credits?.planTier || 'none'}`);

    // Update or create user credits
    const creditsPerPlan = {
      free: 100,
      basic: 500,
      pro: 2000,
      enterprise: 10000
    };

    if (user.credits) {
      await prisma.userCredit.update({
        where: { userId: user.id },
        data: {
          planTier,
          totalCredits: creditsPerPlan[planTier],
          // Reset usage on plan change
          usedCredits: 0,
          monthlyReset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
      console.log(`✅ Updated user to ${planTier} plan`);
    } else {
      await prisma.userCredit.create({
        data: {
          userId: user.id,
          planTier,
          totalCredits: creditsPerPlan[planTier],
          usedCredits: 0,
          monthlyReset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
      console.log(`✅ Created user credits with ${planTier} plan`);
    }

    // Also update tenant plan if user has a tenant
    if (user.tenantId) {
      const planCodeMap = {
        free: 'FREE_PLAN',
        basic: 'FREE_PLAN',
        pro: 'PRO_PLAN',
        enterprise: 'ENTERPRISE_PLAN'
      };

      const plan = await prisma.plan.findUnique({
        where: { code: planCodeMap[planTier] }
      });

      if (plan) {
        const existingTenantPlan = await prisma.tenantPlan.findFirst({
          where: { tenantId: user.tenantId }
        });

        if (existingTenantPlan) {
          await prisma.tenantPlan.update({
            where: { id: existingTenantPlan.id },
            data: {
              planId: plan.id,
              status: 'ACTIVE'
            }
          });
        } else {
          await prisma.tenantPlan.create({
            data: {
              tenantId: user.tenantId,
              planId: plan.id,
              effectiveFrom: new Date(),
              status: 'ACTIVE'
            }
          });
        }
        console.log(`✅ Updated tenant plan to ${planCodeMap[planTier]}`);
      }
    }

    // Display final state
    const updatedUser = await prisma.user.findUnique({
      where: { email },
      include: { credits: true }
    });

    console.log(`\n📊 Final state:`);
    console.log(`   Plan tier: ${updatedUser?.credits?.planTier}`);
    console.log(`   Total credits: ${updatedUser?.credits?.totalCredits}`);
    console.log(`   Used credits: ${updatedUser?.credits?.usedCredits}`);
    console.log(`   Monthly reset: ${updatedUser?.credits?.monthlyReset}`);

    console.log('\n✅ User upgrade completed!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

upgradeUserToPro().catch(console.error);

