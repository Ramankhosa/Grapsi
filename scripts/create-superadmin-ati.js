#!/usr/bin/env node

/**
 * Create a Super Admin user through ATI hierarchy with custom email
 * Modified from create-ati-analyst.js to create a superadmin instead
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const prisma = new PrismaClient()

async function createATISuperAdmin() {
  try {
    console.log('🔧 Creating ATI-based Super Admin user...\n')

    // Custom credentials from user request
    const testEmail = 'superadmin@papsi.com'
    const testPassword = 'SuperAdmin123!'
    const testName = 'Super Admin'
    const atiExpiryDate = new Date('2026-07-01T00:00:00.000Z')

    // Hash the password
    console.log('🔒 Hashing password...')
    const passwordHash = await bcrypt.hash(testPassword, 12)

    // Create or find a platform tenant for super admin
    console.log('🏢 Setting up PLATFORM tenant...')
    const platformTenant = await prisma.tenant.upsert({
      where: { atiId: 'PLATFORM' },
      update: {},
      create: {
        name: 'Platform Administration',
        atiId: 'PLATFORM',
        status: 'ACTIVE'
      }
    })

    // Assign PLATFORM_ADMIN plan to tenant
    const platformPlan = await prisma.plan.findFirst({
      where: {
        OR: [
          { code: 'PLATFORM_ADMIN' },
          { code: 'PRO_PLAN' },
          { code: 'FREE_PLAN' }
        ]
      }
    })
    if (platformPlan) {
      await prisma.tenantPlan.upsert({
        where: {
          tenantId_planId_effectiveFrom: {
            tenantId: platformTenant.id,
            planId: platformPlan.id,
            effectiveFrom: new Date()
          }
        },
        update: {},
        create: {
          tenantId: platformTenant.id,
          planId: platformPlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      })
      console.log(`✅ Assigned ${platformPlan.code} to platform tenant`)
    }

    // Create an ATI token for this tenant
    console.log('🎫 Creating ATI token...')
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 12)

    const atiToken = await prisma.aTIToken.create({
      data: {
        tenantId: platformTenant.id,
        tokenHash,
        rawToken: rawToken, // Store temporarily for demo
        rawTokenExpiry: atiExpiryDate,
        fingerprint: 'superadmin-ati-token',
        status: 'ACTIVE',
        expiresAt: atiExpiryDate,
        maxUses: 1, // Super admin tokens should only be used once
        planTier: 'PLATFORM_ADMIN',
        notes: 'Super Admin ATI Onboarding Token'
      }
    })

    // Create the ATI-based super admin user
    console.log('👑 Creating ATI-based Super Admin user...')
    const testUser = await prisma.user.upsert({
      where: { email: testEmail },
      update: {
        passwordHash,
        name: testName,
        roles: ['SUPER_ADMIN'],
        tenantId: platformTenant.id,
        signupAtiTokenId: atiToken.id,
        status: 'ACTIVE'
      },
      create: {
        email: testEmail,
        passwordHash,
        name: testName,
        roles: ['SUPER_ADMIN'],
        tenantId: platformTenant.id,
        signupAtiTokenId: atiToken.id,
        status: 'ACTIVE'
      }
    })

    console.log('\n🎉 ATI-based Super Admin user created successfully!')
    console.log('================================')
    console.log('👑 SUPER ADMIN DETAILS:')
    console.log(`   📧 EMAIL: ${testEmail}`)
    console.log(`   🔑 PASSWORD: ${testPassword}`)
    console.log(`   🆔 USER ID: ${testUser.id}`)
    console.log(`   👤 ROLE: ${testUser.roles?.join(', ') || 'SUPER_ADMIN'}`)
    console.log(`   🏢 TENANT: ${platformTenant.name}`)
    console.log('')
    console.log('🏢 TENANT DETAILS:')
    console.log(`   🏢 TENANT: ${platformTenant.name}`)
    console.log(`   🆔 TENANT ID: ${platformTenant.id}`)
    console.log(`   🎫 ATI ID: ${platformTenant.atiId}`)
    console.log('')
    console.log('🎫 ATI TOKEN DETAILS:')
    console.log(`   🆔 TOKEN ID: ${atiToken.id}`)
    console.log(`   🔑 RAW TOKEN: ${rawToken}`)
    console.log(`   📅 EXPIRES: ${atiToken.expiresAt}`)
    console.log(`   📊 PLAN TIER: ${atiToken.planTier}`)
    console.log(`   📝 NOTES: ${atiToken.notes}`)
    console.log('================================')
    console.log('')
    console.log('💡 LOGIN OPTIONS:')
    console.log('   1. Direct login with email/password above')
    console.log('   2. Or use the ATI token for signup flow')
    console.log('   3. This user has PLATFORM_ADMIN privileges')
    console.log('')
    console.log('🚀 NEXT STEPS:')
    console.log('   1. Start the server: npm run dev')
    console.log('   2. Login at: http://localhost:3000/login')
    console.log('   3. Use super admin credentials to manage the platform')

  } catch (error) {
    console.error('❌ Error creating ATI Super Admin:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
createATISuperAdmin()
