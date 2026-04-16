#!/usr/bin/env node

/**
 * Super Admin Viewer Creation Script
 *
 * This script creates or updates a Super Admin Viewer user in the database.
 * The Super Admin Viewer can see all Super Admin dashboards and analytics,
 * but cannot perform write operations (enforced in the API/middleware).
 *
 * Usage:
 *   node scripts/create-super-admin-viewer.js [email] [password] [name]
 *
 * Default values:
 *   email: ramandeep.singh@lpu.co.in
 *   password: SuperViewer123!
 *   name: Super Admin Viewer
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const prisma = new PrismaClient()

function generateATIToken() {
  return crypto.randomBytes(32).toString('hex').toUpperCase()
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12)
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

async function createSuperAdminViewer() {
  const email = process.argv[2] || 'ramandeep.singh@lpu.co.in'
  const password = process.argv[3] || 'SuperViewer123!'
  const name = process.argv[4] || 'Super Admin Viewer'

  try {
    console.log('Creating Super Admin Viewer user...')
    console.log(`Email: ${email}`)
    console.log(`Name: ${name}`)
    console.log('Password: [HIDDEN]')

    const passwordHash = await bcrypt.hash(password, 12)

    // Ensure platform tenant exists (ATI ID = PLATFORM)
    let platformTenant = await prisma.tenant.findFirst({
      where: { atiId: 'PLATFORM' }
    })

    if (!platformTenant) {
      console.log('Platform tenant not found. Creating Platform Administration tenant...')
      platformTenant = await prisma.tenant.create({
        data: {
          name: 'Platform Administration',
          atiId: 'PLATFORM',
          status: 'ACTIVE'
        }
      })
    }

    // Create a platform-level ATI token for this viewer user
    console.log('Generating platform ATI token for Super Admin Viewer...')
    const rawToken = generateATIToken()
    const tokenHash = hashATIToken(rawToken)
    const fingerprint = createATIFingerprint(tokenHash)

    const viewerToken = await prisma.aTIToken.create({
      data: {
        tenantId: platformTenant.id,
        tokenHash,
        fingerprint,
        status: 'ACTIVE',
        planTier: 'PLATFORM_ADMIN_VIEWER',
        notes: 'Platform Super Admin Viewer Onboarding Token',
        maxUses: 1
      }
    })

    // Check for existing user by email
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    let viewerUser

    if (existingUser) {
      console.log('Super Admin Viewer user already exists, updating credentials and role...')

      // Ensure SUPER_ADMIN_VIEWER role is present and remove SUPER_ADMIN if it exists
      const roles = Array.isArray(existingUser.roles) ? [...existingUser.roles] : []
      const filteredRoles = roles.filter((r) => r !== 'SUPER_ADMIN')
      if (!filteredRoles.includes('SUPER_ADMIN_VIEWER')) {
        filteredRoles.push('SUPER_ADMIN_VIEWER')
      }

      viewerUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          tenantId: platformTenant.id,
          email,
          passwordHash,
          name,
          roles: filteredRoles,
          status: 'ACTIVE',
          signupAtiTokenId: viewerToken.id
        }
      })
    } else {
      console.log('Creating new Super Admin Viewer user...')
      viewerUser = await prisma.user.create({
        data: {
          tenantId: platformTenant.id,
          email,
          passwordHash,
          name,
          roles: ['SUPER_ADMIN_VIEWER'],
          status: 'ACTIVE',
          signupAtiTokenId: viewerToken.id
        }
      })
    }

    console.log('\nSuper Admin Viewer Details:')
    console.log(`ID: ${viewerUser.id}`)
    console.log(`Email: ${viewerUser.email}`)
    console.log(`Name: ${viewerUser.name}`)
    console.log(`Roles: ${viewerUser.roles.join(', ')}`)
    console.log(`Status: ${viewerUser.status}`)
    console.log(`Created: ${viewerUser.createdAt.toISOString()}`)

    console.log('\nPlatform ATI Token for Super Admin Viewer (DISPLAYED ONCE - COPY NOW):')
    console.log(`Token: ${rawToken}`)
    console.log(`Fingerprint: ${viewerToken.fingerprint}`)
    console.log('WARNING: This token will never be shown again. Store it securely.')

    console.log('\nLogin Credentials:')
    console.log(`Email: ${email}`)
    console.log(`Password: ${password}`)

    console.log('\nNext Steps:')
    console.log('1. Start the server: npm run dev')
    console.log('2. Use the ATI token above to complete onboarding (if required)')
    console.log('3. Login at: http://localhost:3000/login with the credentials above')
    console.log('4. Navigate to the Super Admin dashboards to view platform data (read-only).')

  } catch (error) {
    console.error('Error creating Super Admin Viewer:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

createSuperAdminViewer().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})

