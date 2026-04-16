const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTenants() {
  console.log('🏢 Creating basic tenants...');

  try {
    // Create platform tenant (ENTERPRISE - system tenant)
    let platformTenant = await prisma.tenant.findUnique({
      where: { atiId: 'PLATFORM' }
    });

    if (!platformTenant) {
      platformTenant = await prisma.tenant.create({
        data: {
          name: 'Platform Administration',
          atiId: 'PLATFORM',
          type: 'ENTERPRISE'
        }
      });
      console.log('✅ Created platform tenant (ENTERPRISE)');
    } else {
      console.log('✓ Platform tenant exists');
    }

    // Create test tenant (ENTERPRISE - demo enterprise)
    let testTenant = await prisma.tenant.findUnique({
      where: { atiId: 'TESTTENANT' }
    });

    if (!testTenant) {
      testTenant = await prisma.tenant.create({
        data: {
          name: 'Test Company Inc.',
          atiId: 'TESTTENANT',
          type: 'ENTERPRISE'
        }
      });
      console.log('✅ Created test tenant (ENTERPRISE)');
    } else {
      console.log('✓ Test tenant exists');
    }

    // Create individual tenant (for solo users)
    let individualTenant = await prisma.tenant.findUnique({
      where: { atiId: 'INDIVIDUAL_DEMO' }
    });

    if (!individualTenant) {
      individualTenant = await prisma.tenant.create({
        data: {
          name: 'Solo User Demo',
          atiId: 'INDIVIDUAL_DEMO',
          type: 'INDIVIDUAL'
        }
      });
      console.log('✅ Created individual tenant (INDIVIDUAL)');
    } else {
      console.log('✓ Individual tenant exists');
    }

    console.log('🎉 Tenants created successfully!');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTenants();
