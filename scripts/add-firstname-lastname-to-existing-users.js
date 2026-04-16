#!/usr/bin/env node

/**
 * Add firstName and lastName to existing users
 * This script parses the existing 'name' field and splits it into firstName and lastName
 * to ensure compatibility with the new schema fields.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function parseNameIntoFirstAndLast(name) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return { firstName: null, lastName: null };
  }

  const trimmedName = name.trim();
  const nameParts = trimmedName.split(' ');

  if (nameParts.length === 1) {
    // Only one name part, put it in firstName
    return { firstName: trimmedName, lastName: null };
  } else {
    // Multiple parts, first part is firstName, rest combined is lastName
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ').trim();
    return { firstName, lastName: lastName || null };
  }
}

async function addFirstNameLastNameToExistingUsers() {
  try {
    console.log('🔧 Adding firstName and lastName to existing users...\n');

    // Find all users that don't have firstName or lastName set
    const usersToUpdate = await prisma.user.findMany({
      where: {
        OR: [
          { firstName: null },
          { lastName: null }
        ]
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true
      }
    });

    console.log(`Found ${usersToUpdate.length} users that need firstName/lastName updates`);

    let usersUpdated = 0;
    let skippedUsers = 0;

    for (const user of usersToUpdate) {
      // Parse the name into firstName and lastName
      const { firstName, lastName } = parseNameIntoFirstAndLast(user.name);

      // Only update if we actually have new values to set
      const updateData = {};
      if (firstName !== null && user.firstName === null) {
        updateData.firstName = firstName;
      }
      if (lastName !== null && user.lastName === null) {
        updateData.lastName = lastName;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({
          where: { id: user.id },
          data: updateData
        });

        usersUpdated++;
        console.log(`✅ Updated ${user.email}: firstName="${updateData.firstName || ''}", lastName="${updateData.lastName || ''}"`);
      } else {
        skippedUsers++;
        console.log(`⏭️  Skipped ${user.email}: already has firstName/lastName set`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total users checked: ${usersToUpdate.length}`);
    console.log(`   Users updated: ${usersUpdated}`);
    console.log(`   Users skipped: ${skippedUsers}`);

    if (usersUpdated > 0) {
      console.log(`\n🎉 Successfully updated ${usersUpdated} users with firstName and lastName!`);
      console.log(`   All users now have proper firstName and lastName fields.`);
    } else {
      console.log(`\n✅ All users already have firstName and lastName set.`);
    }

  } catch (error) {
    console.error('❌ Error adding firstName/lastName to users:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
addFirstNameLastNameToExistingUsers();
