const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createBasicUsers() {
  console.log('👥 Creating basic users for testing...');

  try {
    // Get tenants
    const tenants = await prisma.tenant.findMany();
    console.log(`Found ${tenants.length} tenants`);

    if (tenants.length === 0) {
      console.log('❌ No tenants found. Please run tenant seeding first.');
      return;
    }

    // Create basic users for each tenant
    const users = [
      {
        email: 'superadmin@spotipr.com',
        password: 'SuperAdmin123!',
        name: 'Super Admin',
        role: 'SUPER_ADMIN',
        tenantId: tenants[0].id // Platform Administration tenant
      },
      {
        email: 'tenantadmin@spotipr.com',
        password: 'TenantAdmin123!',
        name: 'Tenant Admin',
        role: 'ADMIN',
        tenantId: tenants[1].id // Test Company tenant
      },
      {
        email: 'analyst@spotipr.com',
        password: 'Analyst123!',
        name: 'Patent Analyst',
        roles: ['ANALYST'], // Only ANALYST role for enterprise tenant (strict separation)
        tenantId: tenants[1].id // Test Company tenant (ENTERPRISE)
      },
      {
        email: 'solouser@spotipr.com',
        password: 'SoloUser123!',
        name: 'Solo User',
        roles: ['ADMIN', 'ANALYST'], // Multiple roles for individual tenant (flexible)
        tenantId: tenants[2].id // Individual demo tenant
      }
    ];

    for (const userData of users) {
      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 12);

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { email: userData.email }
      });

      if (existingUser) {
        console.log(`✓ User ${userData.email} already exists`);
        continue;
      }

      // Create user (handle both single role and multiple roles)
      const userRoles = userData.roles || [userData.role];
      const user = await prisma.user.create({
        data: {
          email: userData.email,
          passwordHash: hashedPassword,
          name: userData.name,
          roles: userRoles,
          tenantId: userData.tenantId,
          status: 'ACTIVE'
        }
      });

      console.log(`✅ Created user: ${user.email} (${user.roles.join(', ')})`);
    }

    console.log('\n🎉 Basic users created successfully!');
    console.log('\n📋 Available test accounts:');
    users.forEach(user => {
      const userRoles = user.roles || [user.role];
      const tenantType = user.email === 'solouser@spotipr.com' ? 'INDIVIDUAL' : 'ENTERPRISE';
      console.log(`   ${user.email} / ${user.password} (${userRoles.join(', ')}) [${tenantType}]`);
    });

    console.log('\n💡 Next: Run plan hierarchy again to assign proper plans based on user roles');

  } catch (error) {
    console.error('❌ Error creating users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createBasicUsers();
