const { PrismaClient } = require('@prisma/client');

async function testCountryService() {
  try {
    console.log('Testing country profile service directly...\n');

    // Import the service - need to use dynamic import for TS
    const { getActiveCountryProfiles } = await import('./src/lib/country-profile-service.ts');

    const profiles = await getActiveCountryProfiles();
    console.log(`Found ${profiles.size} active country profiles:`);

    profiles.forEach((profile, code) => {
      console.log(`- ${code}: ${profile.name} (${profile.status})`);
    });

    if (profiles.size === 0) {
      console.log('\nNo profiles found! Checking database directly...');

      const prisma = new PrismaClient();
      const dbProfiles = await prisma.countryProfile.findMany({
        where: { status: 'ACTIVE' },
        select: {
          countryCode: true,
          name: true,
          status: true
        }
      });

      console.log(`Database query found ${dbProfiles.length} profiles:`);
      dbProfiles.forEach(profile => {
        console.log(`- ${profile.countryCode}: ${profile.name} (${profile.status})`);
      });

      await prisma.$disconnect();
    }

  } catch (error) {
    console.error('Error testing service:', error);
  }
}

testCountryService();








