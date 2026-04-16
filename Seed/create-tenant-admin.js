/**
 * Create Tenant Admin User
 * 
 * Creates tenantadmin@spotipr.com as ADMIN in the same tenant as analyst@spotipr.com
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  const ADMIN_EMAIL = 'tenantadmin@spotipr.com'
  const ANALYST_EMAIL = 'analyst@spotipr.com'
  const PASSWORD = 'Admin123!' // You should change this after first login

  console.log('Looking for existing users...\n')

  // Check if tenant admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    include: { tenant: true }
  })

  if (existingAdmin) {
    console.log('✅ Tenant Admin already exists!')
    console.log('================================')
    console.log(`Email: ${existingAdmin.email}`)
    console.log(`User ID: ${existingAdmin.id}`)
    console.log(`Roles: ${existingAdmin.roles.join(', ')}`)
    console.log(`Tenant: ${existingAdmin.tenant?.name || 'N/A'}`)
    console.log(`Tenant ID: ${existingAdmin.tenantId}`)
    console.log(`Status: ${existingAdmin.status}`)
    console.log('================================')
    console.log('\n⚠️  Password cannot be revealed. Reset if needed.')
    return
  }

  // Find analyst to get tenant
  const analyst = await prisma.user.findUnique({
    where: { email: ANALYST_EMAIL },
    include: { tenant: true }
  })

  if (!analyst) {
    console.log(`❌ Could not find ${ANALYST_EMAIL}`)
    
    // List existing users
    const users = await prisma.user.findMany({
      select: { email: true, tenantId: true, roles: true }
    })
    console.log('\nExisting users:')
    users.forEach(u => console.log(`  - ${u.email} (${u.roles.join(', ')})`))
    return
  }

  console.log(`Found analyst: ${analyst.email}`)
  console.log(`Tenant: ${analyst.tenant?.name || analyst.tenantId}`)

  // Hash password
  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  // Create tenant admin
  const tenantAdmin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash,
      name: 'Tenant Admin',
      firstName: 'Tenant',
      lastName: 'Admin',
      tenantId: analyst.tenantId,
      roles: ['ADMIN'],
      status: 'ACTIVE',
      emailVerified: true
    }
  })

  // Create default project for the admin
  await prisma.project.create({
    data: {
      name: 'Default Project',
      userId: tenantAdmin.id
    }
  })

  console.log('\n✅ Tenant Admin created successfully!')
  console.log('=====================================')
  console.log(`Email: ${ADMIN_EMAIL}`)
  console.log(`Password: ${PASSWORD}`)
  console.log(`User ID: ${tenantAdmin.id}`)
  console.log(`Roles: ${tenantAdmin.roles.join(', ')}`)
  console.log(`Tenant ID: ${tenantAdmin.tenantId}`)
  console.log('=====================================')
  console.log('\n⚠️  Please change the password after first login!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

