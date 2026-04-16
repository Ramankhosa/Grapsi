#!/usr/bin/env node

/**
 * Full Hierarchy Setup Script
 *
 * Creates the complete user hierarchy for testing:
 * 1. Super Admin (PLATFORM level)
 * 2. Tenant Admin (TENANT level)
 * 3. Analyst (USER level)
 *
 * Usage:
 *   node scripts/setup-full-hierarchy.js
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

// Replicate auth functions
function generateATIToken() {
  return crypto.randomBytes(32).toString('hex').toUpperCase()
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12)
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

const prisma = new PrismaClient()

async function setupFullHierarchy() {
  try {
    console.log('🚀 Setting up complete user hierarchy...\n')

    // === 1. SUPER ADMIN SETUP ===
    console.log('👑 PHASE 1: Creating Super Admin')
    console.log('=' .repeat(50))

    const superAdminEmail = 'superadmin@spotipr.com'
    const superAdminPassword = 'SuperSecure123!'
    const superAdminName = 'Super Admin'

    // Hash password
    const superAdminPasswordHash = await bcrypt.hash(superAdminPassword, 12)

    // Check if Super Admin exists
    let superAdmin = await prisma.user.findFirst({
      where: { roles: { has: 'SUPER_ADMIN' } }
    })

    let platformToken = null
    let rawToken = null

    if (superAdmin) {
      console.log('📝 Super Admin exists, updating...')
      superAdmin = await prisma.user.update({
        where: { id: superAdmin.id },
        data: {
          email: superAdminEmail,
          passwordHash: superAdminPasswordHash,
          name: superAdminName,
          status: 'ACTIVE'
        }
      })
    } else {
      console.log('➕ Creating new Super Admin...')

      // Create platform tenant
      const platformTenant = await prisma.tenant.upsert({
        where: { atiId: 'PLATFORM' },
        update: {},
        create: {
          name: 'Platform Administration',
          atiId: 'PLATFORM',
          status: 'ACTIVE'
        }
      })

      // Generate platform ATI token
      rawToken = generateATIToken()
      const tokenHash = hashATIToken(rawToken)
      const fingerprint = createATIFingerprint(tokenHash)

      platformToken = await prisma.aTIToken.create({
        data: {
          tenantId: platformTenant.id,
          tokenHash,
          rawToken,
          rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          fingerprint,
          status: 'ISSUED',
          planTier: 'PLATFORM_ADMIN',
          notes: 'Super Admin Onboarding Token',
          maxUses: 5
        }
      })

      superAdmin = await prisma.user.upsert({
        where: { email: superAdminEmail },
        update: {
          passwordHash: superAdminPasswordHash,
          name: superAdminName,
          status: 'ACTIVE'
        },
        create: {
          tenantId: platformTenant.id,
          email: superAdminEmail,
          passwordHash: superAdminPasswordHash,
          name: superAdminName,
          roles: ['SUPER_ADMIN'],
          status: 'ACTIVE',
          signupAtiTokenId: platformToken.id
        }
      })
    }

    console.log('✅ Super Admin ready!')
    console.log(`   📧 ${superAdminEmail}`)
    console.log(`   🔑 ${superAdminPassword}`)
    if (rawToken) {
      console.log(`   🎫 ATI Token: ${rawToken}`)
    }
    console.log()

    // === 2. TENANT ADMIN SETUP ===
    console.log('🏢 PHASE 2: Creating Tenant Admin')
    console.log('=' .repeat(50))

    const tenantAdminEmail = 'tenantadmin@spotipr.com'
    const tenantAdminPassword = 'TenantAdmin123!'
    const tenantAdminName = 'Tenant Admin'

    // Create test tenant
    const testTenant = await prisma.tenant.upsert({
      where: { atiId: 'TESTTENANT' },
      update: {},
      create: {
        name: 'Test Company Inc.',
        atiId: 'TESTTENANT',
        status: 'ACTIVE'
      }
    })

    // Clean up old ATI tokens for this tenant
    await prisma.aTIToken.deleteMany({
      where: { tenantId: testTenant.id }
    })
    console.log('🧹 Cleaned up old ATI tokens for tenant')

    // Assign PRO_PLAN to tenant (for LLM access)
    const proPlan = await prisma.plan.findFirst({
      where: { code: 'PRO_PLAN' }
    }) || await prisma.plan.findFirst({
      where: { code: 'FREE_PLAN' }
    })

    if (proPlan) {
      await prisma.tenantPlan.upsert({
        where: {
          tenantId_planId_effectiveFrom: {
            tenantId: testTenant.id,
            planId: proPlan.id,
            effectiveFrom: new Date()
          }
        },
        update: {},
        create: {
          tenantId: testTenant.id,
          planId: proPlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      })
      console.log(`✅ Assigned ${proPlan.code} to tenant`)
    }

    // Create ATI token for tenant admin onboarding
    const tenantRawToken = generateATIToken()
    const tenantTokenHash = hashATIToken(tenantRawToken)
    const tenantFingerprint = createATIFingerprint(tenantTokenHash)

    const tenantToken = await prisma.aTIToken.create({
      data: {
        tenantId: testTenant.id,
        tokenHash: tenantTokenHash,
        rawToken: tenantRawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        fingerprint: tenantFingerprint,
        status: 'ISSUED',
        planTier: proPlan?.code || 'FREE_PLAN',
        notes: 'Tenant Admin Onboarding Token',
        maxUses: 5
      }
    })

    // Create tenant admin
    const tenantAdminPasswordHash = await bcrypt.hash(tenantAdminPassword, 12)

    const tenantAdmin = await prisma.user.upsert({
      where: { email: tenantAdminEmail },
      update: {
        passwordHash: tenantAdminPasswordHash,
        name: tenantAdminName,
        roles: ['ADMIN'],
        status: 'ACTIVE'
      },
      create: {
        tenantId: testTenant.id,
        email: tenantAdminEmail,
        passwordHash: tenantAdminPasswordHash,
        name: tenantAdminName,
        roles: ['ADMIN'],
        status: 'ACTIVE',
        signupAtiTokenId: tenantToken.id
      }
    })

    console.log('✅ Tenant Admin ready!')
    console.log(`   📧 ${tenantAdminEmail}`)
    console.log(`   🔑 ${tenantAdminPassword}`)
    console.log(`   🎫 ATI Token: ${tenantRawToken}`)
    console.log(`   🏢 Tenant: ${testTenant.name}`)
    console.log()

    // === 3. ANALYST SETUP ===
    console.log('👤 PHASE 3: Creating Analyst')
    console.log('=' .repeat(50))

    const analystEmail = 'analyst@spotipr.com'
    const analystPassword = 'AnalystPass123!'
    const analystName = 'Test Analyst'

    // Create ATI token for analyst
    const analystRawToken = generateATIToken()
    const analystTokenHash = hashATIToken(analystRawToken)
    const analystFingerprint = createATIFingerprint(analystTokenHash)

    const analystToken = await prisma.aTIToken.create({
      data: {
        tenantId: testTenant.id,
        tokenHash: analystTokenHash,
        rawToken: analystRawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        fingerprint: analystFingerprint,
        status: 'ISSUED',
        planTier: proPlan?.code || 'FREE_PLAN',
        notes: 'Analyst Onboarding Token',
        maxUses: 10
      }
    })

    // Create analyst
    const analystPasswordHash = await bcrypt.hash(analystPassword, 12)

    const analyst = await prisma.user.upsert({
      where: { email: analystEmail },
      update: {
        passwordHash: analystPasswordHash,
        name: analystName,
        roles: ['ANALYST'],
        status: 'ACTIVE',
        signupAtiTokenId: analystToken.id
      },
      create: {
        tenantId: testTenant.id,
        email: analystEmail,
        passwordHash: analystPasswordHash,
        name: analystName,
        roles: ['ANALYST'],
        status: 'ACTIVE',
        signupAtiTokenId: analystToken.id
      }
    })

    console.log('✅ Analyst ready!')
    console.log(`   📧 ${analystEmail}`)
    console.log(`   🔑 ${analystPassword}`)
    console.log(`   🎫 ATI Token: ${analystRawToken}`)
    console.log(`   🏢 Tenant: ${testTenant.name}`)
    console.log()

    // === FINAL SUMMARY ===
    console.log('🎉 HIERARCHY SETUP COMPLETE!')
    console.log('=' .repeat(60))
    console.log()
    console.log('👑 SUPER ADMIN:')
    console.log(`   Login: ${superAdminEmail} / ${superAdminPassword}`)
    if (rawToken) {
      console.log(`   ATI Token: ${rawToken}`)
    }
    console.log()
    console.log('🏢 TENANT ADMIN:')
    console.log(`   Login: ${tenantAdminEmail} / ${tenantAdminPassword}`)
    console.log(`   ATI Token: ${tenantRawToken}`)
    console.log(`   Tenant: ${testTenant.name} (${testTenant.atiId})`)
    console.log()
    console.log('👤 ANALYST:')
    console.log(`   Login: ${analystEmail} / ${analystPassword}`)
    console.log(`   ATI Token: ${analystRawToken}`)
    console.log(`   Tenant: ${testTenant.name} (${testTenant.atiId})`)
    console.log()
    console.log('🚀 NEXT STEPS:')
    console.log('1. Start server: npm run dev')
    console.log('2. Login as analyst: analyst@spotipr.com / AnalystPass123!')
    console.log('3. Create a project and patent')
    console.log('4. Test prior art search in Actions → Prior Art Search')
    console.log()
    console.log('💡 Use the ATI tokens for signup flow testing')
    console.log('💡 All users have LLM access through PRO_PLAN')

  } catch (error) {
    console.error('❌ Error setting up hierarchy:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  setupFullHierarchy()
}
