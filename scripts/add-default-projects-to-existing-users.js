#!/usr/bin/env node

/**
 * Add Default Project to existing users who don't have one
 * This ensures all users have a Default Project for quick drafting and searching
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addDefaultProjectsToExistingUsers() {
  try {
    console.log('🔧 Adding Default Projects to existing users...\n');

    // Find all users
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        createdAt: true
      }
    });

    console.log(`Found ${allUsers.length} total users`);

    let usersWithoutDefaultProject = 0;
    let defaultProjectsCreated = 0;

    for (const user of allUsers) {
      // Check if user already has a Default Project
      const existingDefaultProject = await prisma.project.findFirst({
        where: {
          userId: user.id,
          name: 'Default Project'
        }
      });

      if (!existingDefaultProject) {
        usersWithoutDefaultProject++;

        // Create Default Project for this user
        const defaultProject = await prisma.project.create({
          data: {
            name: 'Default Project',
            userId: user.id
          }
        });

        defaultProjectsCreated++;
        console.log(`✅ Created Default Project for ${user.email}: ${defaultProject.id}`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total users: ${allUsers.length}`);
    console.log(`   Users without Default Project: ${usersWithoutDefaultProject}`);
    console.log(`   Default Projects created: ${defaultProjectsCreated}`);

    if (defaultProjectsCreated > 0) {
      console.log(`\n🎉 Successfully added Default Projects to ${defaultProjectsCreated} users!`);
      console.log(`   All users now have a Default Project for quick drafting and searching.`);
    } else {
      console.log(`\n✅ All users already have Default Projects.`);
    }

  } catch (error) {
    console.error('❌ Error adding Default Projects:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
addDefaultProjectsToExistingUsers();
