#!/usr/bin/env node

/**
 * Super Admin Creation Script
 *
 * This script creates or updates a Super Admin user in the database.
 * Can be run multiple times to reset the Super Admin password or update details.
 *
 * Usage:
 *   node scripts/create-super-admin.js [email] [password] [name]
 *
 * Default values:
 *   email: superadmin@spotipr.com
 *   password: SuperSecure123!
 *   name: Super Admin
 *
 * Example:
 *   node scripts/create-super-admin.js admin@company.com MyPass123 "John Admin"
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

// Replicate the auth functions needed for the script
function generateATIToken() {
  return crypto.randomBytes(32).toString('hex').toUpperCase()
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12)
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

async function createAuditLog(data) {
  const prisma = new PrismaClient()
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: data.actorUserId,
        tenantId: data.tenantId,
        action: data.action,
        resource: data.resource,
        ip: data.ip,
        meta: data.meta
      }
    })
  } finally {
    await prisma.$disconnect()
  }
}

const prisma = new PrismaClient()

async function createSuperAdmin() {
  // Get command line arguments
  const email = process.argv[2] || 'superadmin@spotipr.com'
  const password = process.argv[3] || 'SuperSecure123!'
  const name = process.argv[4] || 'Super Admin'

  try {
    console.log('🚀 Creating Super Admin User...')
    console.log(`📧 Email: ${email}`)
    console.log(`👤 Name: ${name}`)
    console.log('🔒 Password: [HIDDEN]')

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12)

    // Check if Super Admin already exists
    const existingSuperAdmin = await prisma.user.findFirst({
      where: { roles: { has: 'SUPER_ADMIN' } }
    })

    let superAdmin
    let platformToken = null
    let rawToken = null

    if (existingSuperAdmin) {
      console.log('📝 Super Admin already exists, updating...')
      superAdmin = await prisma.user.update({
        where: { id: existingSuperAdmin.id },
        data: {
          email,
          passwordHash,
          name,
          status: 'ACTIVE'
        }
      })
      console.log('✅ Super Admin updated successfully!')
    } else {
      console.log('➕ Creating new Super Admin...')

      // Find or create platform tenant for super admin tokens
      console.log('🏢 Finding platform tenant...')
      let platformTenant = await prisma.tenant.findUnique({
        where: { atiId: 'PLATFORM' }
      })

      if (!platformTenant) {
        console.log('🏢 Creating platform tenant...')
        platformTenant = await prisma.tenant.create({
          data: {
            name: 'Platform Administration',
            atiId: 'PLATFORM',
            status: 'ACTIVE'
          }
        })
      } else {
        console.log('🏢 Using existing platform tenant...')
      }

      // Generate platform-level ATI token for super admin onboarding
      console.log('🔐 Generating platform ATI token...')
      rawToken = generateATIToken()
      const tokenHash = hashATIToken(rawToken)
      const fingerprint = createATIFingerprint(tokenHash)

      // Create ATI token associated with platform tenant
      platformToken = await prisma.aTIToken.create({
        data: {
          tenantId: platformTenant.id, // Associated with platform tenant
          tokenHash,
          fingerprint,
          status: 'ACTIVE',
          planTier: 'PLATFORM_ADMIN',
          notes: 'Platform Super Admin Onboarding Token',
          // No expiration for initial super admin token
          maxUses: 1 // Can only be used once
        }
      })

      superAdmin = await prisma.user.create({
        data: {
          tenantId: platformTenant.id, // Super admin belongs to PLATFORM tenant
          email,
          passwordHash,
          name,
          roles: ['SUPER_ADMIN'],
          status: 'ACTIVE',
          signupAtiTokenId: platformToken.id // Track the ATI token used
        }
      })

      console.log('✅ Super Admin created successfully!')
      console.log('🔑 Platform ATI Token generated!')
    }

    console.log('\n🎯 Super Admin Details:')
    console.log(`ID: ${superAdmin.id}`)
    console.log(`Email: ${superAdmin.email}`)
    console.log(`Name: ${superAdmin.name}`)
    console.log(`Role: ${superAdmin.roles?.join(', ') || 'None'}`)
    console.log(`Status: ${superAdmin.status}`)
    console.log(`Created: ${superAdmin.createdAt.toISOString()}`)

    // Show ATI token for new super admin
    if (platformToken) {
      console.log('\n🔑 Platform ATI Token (DISPLAYED ONCE - COPY NOW):')
      console.log(`Token: ${rawToken}`)
      console.log(`Fingerprint: ${platformToken.fingerprint}`)
      console.log(`⚠️  SECURITY WARNING: This token will never be shown again!`)
      console.log(`⚠️  Store it securely and use it for super admin onboarding.`)
    }

    console.log('\n🔑 Login Credentials:')
    console.log(`Email: ${email}`)
    console.log(`Password: ${password}`)

    if (platformToken) {
      console.log('\n🚀 Initial Login Process:')
      console.log('1. Use the ATI token above to complete super admin onboarding')
      console.log('2. After onboarding, login normally with email/password')
    }

    console.log('\n💡 Next Steps:')
    console.log('1. Start the server: npm run dev')
    console.log('2. Complete super admin onboarding with ATI token')
    console.log('3. Login at: http://localhost:3000/login')
    console.log('4. Create tenants and generate ATI tokens')
    console.log('5. Onboard users with ATI tokens')
    console.log('6. Run comprehensive tests: npm run test-ati-system')


  } catch (error) {
    console.error('❌ Error creating Super Admin:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
createSuperAdmin()
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  })
