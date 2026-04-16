const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        email: true,
        name: true,
        status: true,
        roles: true,
        tenant: {
          select: { name: true }
        }
      },
      take: 20
    });

    console.log('Users in database:');
    users.forEach(user => {
      console.log(`- ${user.email} (${user.name || 'No name'}) - ${user.status} - Roles: ${user.roles.join(', ')} - Tenant: ${user.tenant?.name || 'No tenant'}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

listUsers();





























