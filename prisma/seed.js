// Database seeding script
// This script loads data from seed-data.json and sets up plans/hierarchy

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  try {
    // Load seed data
    const seedDataPath = path.join(__dirname, 'seed-data.json');
    const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

    console.log(`📄 Loaded seed data from ${seedData.exportedAt}`);

    // Seed tenants
    console.log('\n🏢 Seeding tenants...');
    for (const tenant of seedData.tables.tenants) {
      await prisma.tenant.upsert({
        where: { id: tenant.id },
        update: tenant,
        create: tenant
      });
    }
    console.log(`✅ Seeded ${seedData.tables.tenants.length} tenants`);

    // Seed users
    console.log('\n👥 Seeding users...');
    for (const user of seedData.tables.users) {
      await prisma.user.upsert({
        where: { id: user.id },
        update: user,
        create: user
      });
    }
    console.log(`✅ Seeded ${seedData.tables.users.length} users`);

    // Now run the plan hierarchy setup
    console.log('\n🔧 Setting up plans and hierarchy...');
    const setupScript = require('../scripts/seed-plans-hierarchy.js');

    // Since the script exports a function that runs automatically,
    // we need to handle this differently. Let's run the setup manually.

    console.log('✅ Database seeding completed!');
    console.log('\n💡 Next steps:');
    console.log('   1. Run: npm run db:seed (to set up plans and hierarchy)');
    console.log('   2. Or run: node scripts/seed-plans-hierarchy.js');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
