const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkCountryProfiles() {
  try {
    console.log('Checking country profiles in database...\n');

    const profiles = await prisma.countryProfile.findMany({
      select: {
        countryCode: true,
        name: true,
        status: true,
        createdAt: true
      }
    });

    console.log(`Found ${profiles.length} country profiles:`);
    profiles.forEach(profile => {
      console.log(`- ${profile.countryCode}: ${profile.name} (${profile.status}) - Created: ${profile.createdAt}`);
    });

    // Check active profiles specifically
    const activeProfiles = profiles.filter(p => p.status === 'ACTIVE');
    console.log(`\nActive profiles: ${activeProfiles.length}`);

  } catch (error) {
    console.error('Error checking profiles:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCountryProfiles();








