#!/usr/bin/env node

/**
 * Test Tenants Creation Script
 *
 * Creates three test tenants with ATI tokens resolved:
 * 1. BASE tenant with FREE_PLAN
 * 2. PRO tenant with PRO_PLAN
 * 3. ENTERPRISE tenant with ENTERPRISE_PLAN
 *
 * Each tenant gets an ATI token for testing model access and application output.
 *
 * Usage:
 *   node Seed/create-test-tenants.js
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

// Tenant configuration
const TENANT_CONFIGS = [
  {
    name: 'Base Test Company',
    atiId: 'BASE_TENANT',
    planCode: 'FREE_PLAN',
    userEmail: 'baseuser@spotipr.com',
    userPassword: 'BaseUser123!',
    userName: 'Base User',
    userRole: 'ANALYST'
  },
  {
    name: 'Pro Test Company',
    atiId: 'PRO_TENANT',
    planCode: 'PRO_PLAN',
    userEmail: 'prouser@spotipr.com',
    userPassword: 'ProUser123!',
    userName: 'Pro User',
    userRole: 'ANALYST'
  },
  {
    name: 'Enterprise Test Company',
    atiId: 'ENTERPRISE_TENANT',
    planCode: 'ENTERPRISE_PLAN',
    userEmail: 'enterpriseuser@spotipr.com',
    userPassword: 'EnterpriseUser123!',
    userName: 'Enterprise User',
    userRole: 'ANALYST'
  }
]

async function createTestTenant(config) {
  console.log(`\n🏗️  Creating ${config.name} (${config.atiId})`)
  console.log('=' .repeat(50))

  // Create tenant
  const tenant = await prisma.tenant.upsert({
    where: { atiId: config.atiId },
    update: { status: 'ACTIVE' },
    create: {
      name: config.name,
      atiId: config.atiId,
      status: 'ACTIVE'
    }
  })

  // Clean up old ATI tokens for this tenant
  await prisma.aTIToken.deleteMany({
    where: { tenantId: tenant.id }
  })

  // Assign plan to tenant
  const plan = await prisma.plan.findFirst({
    where: { code: config.planCode }
  })

  if (!plan) {
    throw new Error(`Plan ${config.planCode} not found. Run seed-production-plans.js first.`)
  }

  await prisma.tenantPlan.upsert({
    where: {
      tenantId_planId_effectiveFrom: {
        tenantId: tenant.id,
        planId: plan.id,
        effectiveFrom: new Date()
      }
    },
    update: { status: 'ACTIVE' },
    create: {
      tenantId: tenant.id,
      planId: plan.id,
      effectiveFrom: new Date(),
      status: 'ACTIVE'
    }
  })

  console.log(`✅ Assigned ${plan.code} to tenant`)

  // Create ATI token
  const rawToken = generateATIToken()
  const tokenHash = hashATIToken(rawToken)
  const fingerprint = createATIFingerprint(tokenHash)

  const atiToken = await prisma.aTIToken.create({
    data: {
      tenantId: tenant.id,
      tokenHash,
      rawToken,
      rawTokenExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      fingerprint,
      status: 'ISSUED',
      planTier: plan.code,
      notes: `${config.name} Test Token`,
      maxUses: 50
    }
  })

  // Create user
  const passwordHash = await bcrypt.hash(config.userPassword, 12)

  const user = await prisma.user.upsert({
    where: { email: config.userEmail },
    update: {
      passwordHash,
      name: config.userName,
      roles: [config.userRole],
      status: 'ACTIVE'
    },
    create: {
      tenantId: tenant.id,
      email: config.userEmail,
      passwordHash,
      name: config.userName,
      roles: [config.userRole],
      status: 'ACTIVE',
      signupAtiTokenId: atiToken.id
    }
  })

  console.log('✅ Tenant and user created!')
  console.log(`   📧 ${config.userEmail}`)
  console.log(`   🔑 ${config.userPassword}`)
  console.log(`   🎫 ATI Token: ${rawToken}`)
  console.log(`   🏢 Tenant: ${tenant.name} (${tenant.atiId})`)
  console.log(`   📋 Plan: ${plan.name} (${plan.code})`)

  return {
    tenant,
    user,
    atiToken: rawToken,
    plan: plan.code
  }
}

async function createTestTenants() {
  try {
    console.log('🚀 Creating Test Tenants with ATI Tokens')
    console.log('=' .repeat(60))
    console.log('This script creates three test tenants:')
    console.log('1. BASE tenant (FREE_PLAN) - Base user')
    console.log('2. PRO tenant (PRO_PLAN) - Pro user')
    console.log('3. ENTERPRISE tenant (ENTERPRISE_PLAN) - Enterprise user')
    console.log('Each tenant has an ATI token resolved for testing.')
    console.log()

    const results = []

    for (const config of TENANT_CONFIGS) {
      const result = await createTestTenant(config)
      results.push(result)
    }

    // Final summary
    console.log('\n🎉 TEST TENANTS CREATION COMPLETE!')
    console.log('=' .repeat(60))
    console.log()

    results.forEach((result, index) => {
      const config = TENANT_CONFIGS[index]
      console.log(`${index + 1}. ${config.name}:`)
      console.log(`   Login: ${config.userEmail} / ${config.userPassword}`)
      console.log(`   ATI Token: ${result.atiToken}`)
      console.log(`   Plan: ${result.plan}`)
      console.log(`   Tenant ID: ${result.tenant.atiId}`)
      console.log()
    })

    console.log('🚀 NEXT STEPS:')
    console.log('1. Start server: npm run dev')
    console.log('2. Login with any of the test accounts above')
    console.log('3. Test model access differences between plans')
    console.log('4. Compare application output across different plan tiers')
    console.log()
    console.log('💡 Use the ATI tokens for signup flow testing')
    console.log('💡 Each plan tier has different model access and quotas')

  } catch (error) {
    console.error('❌ Error creating test tenants:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  createTestTenants()
}
