const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createEnterpriseUser() {
  console.log('🏢 Creating new enterprise user with tenant and enterprise plan...');

  try {
    // Step 1: Create a new tenant
    const tenantName = 'Enterprise Corp';
    const tenantAtiId = 'ENTERPRISE_CORP_' + Date.now(); // Unique ATI ID

    console.log('📋 Step 1: Creating tenant...');
    const tenant = await prisma.tenant.create({
      data: {
        name: tenantName,
        atiId: tenantAtiId,
        type: 'ENTERPRISE',
        status: 'ACTIVE'
      }
    });

    console.log(`✅ Created tenant: ${tenant.name} (ATI ID: ${tenant.atiId})`);

    // Step 2: Create a new user for this tenant
    const userEmail = 'analysts@spotiPR.com'; // Using the email the user asked about
    const userPassword = 'Analyst123!';
    const userName = 'Enterprise Analyst';

    console.log('👤 Step 2: Creating user...');

    // Hash the password
    const hashedPassword = await bcrypt.hash(userPassword, 12);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: userEmail }
    });

    if (existingUser) {
      console.log(`⚠️  User ${userEmail} already exists. Skipping user creation.`);
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: hashedPassword,
        name: userName,
        roles: ['ANALYST'], // Enterprise tenant with strict role separation
        tenantId: tenant.id,
        status: 'ACTIVE'
      }
    });

    console.log(`✅ Created user: ${user.email} (${user.roles.join(', ')})`);

    // Step 3: Assign enterprise plan to the tenant
    console.log('📋 Step 3: Assigning enterprise plan...');

    // Get the enterprise plan
    const enterprisePlan = await prisma.plan.findUnique({
      where: { code: 'ENTERPRISE_PLAN' }
    });

    if (!enterprisePlan) {
      throw new Error('Enterprise plan not found. Please run plan seeding first.');
    }

    // Check if tenant already has a plan
    const existingTenantPlan = await prisma.tenantPlan.findFirst({
      where: { tenantId: tenant.id }
    });

    if (existingTenantPlan) {
      console.log('⚠️  Tenant already has a plan assigned. Updating to enterprise plan...');
      await prisma.tenantPlan.update({
        where: { id: existingTenantPlan.id },
        data: {
          planId: enterprisePlan.id,
          status: 'ACTIVE'
        }
      });
    } else {
      // Create new tenant plan assignment
      await prisma.tenantPlan.create({
        data: {
          tenantId: tenant.id,
          planId: enterprisePlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      });
    }

    console.log(`✅ Assigned enterprise plan to tenant: ${tenant.name}`);

    // Step 4: Verification - Get the complete setup
    console.log('\n🔍 Step 4: Verification...');

    const verification = await prisma.user.findUnique({
      where: { email: userEmail },
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

    if (verification) {
      console.log('\n🎉 SUCCESS! Enterprise user created successfully!');
      console.log('='.repeat(50));
      console.log(`User Email: ${verification.email}`);
      console.log(`User Name: ${verification.name}`);
      console.log(`User Roles: ${verification.roles.join(', ')}`);
      console.log(`User Status: ${verification.status}`);
      console.log(`Tenant: ${verification.tenant?.name} (${verification.tenant?.type})`);

      if (verification.tenant?.tenantPlans && verification.tenant.tenantPlans.length > 0) {
        const activePlan = verification.tenant.tenantPlans[0];
        console.log(`Active Plan: ${activePlan.plan.name} (${activePlan.plan.code})`);
        console.log(`Effective From: ${activePlan.effectiveFrom}`);
        console.log(`Plan Status: ${activePlan.status}`);

        console.log('\nPlan Features & Limits:');
        activePlan.plan.planFeatures.forEach(pf => {
          console.log(`  • ${pf.feature.name}: Monthly ${pf.monthlyQuota || 'unlimited'}, Daily ${pf.dailyQuota || 'unlimited'}`);
        });
      }

      console.log('\n🔐 Login Credentials:');
      console.log(`  Email: ${userEmail}`);
      console.log(`  Password: ${userPassword}`);
      console.log('='.repeat(50));
    }

  } catch (error) {
    console.error('❌ Error creating enterprise user:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createEnterpriseUser();





























