#!/usr/bin/env node

/**
 * Create an ATI-based analyst user with known credentials
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const prisma = new PrismaClient()

async function createATIAnalyst() {
  try {
    console.log('🔧 Creating ATI-based analyst user...\n')

    // Test credentials
    const testEmail = 'analyst@papsi.com'
    const testPassword = 'AnalystPass123!'
    const testName = 'Papsi Analyst'
    const atiExpiryDate = new Date('2026-07-01T00:00:00.000Z')

    // Hash the password
    console.log('🔒 Hashing password...')
    const passwordHash = await bcrypt.hash(testPassword, 12)

    // Create or find a test tenant
    console.log('🏢 Setting up ATI tenant...')
    const testTenant = await prisma.tenant.upsert({
      where: { atiId: 'ati-test-tenant' },
      update: {},
      create: {
        name: 'ATI Test Tenant',
        atiId: 'ati-test-tenant',
        status: 'ACTIVE'
      }
    })

    // Assign FREE_PLAN to tenant
    const freePlan = await prisma.plan.findUnique({ where: { code: 'FREE_PLAN' } })
    if (freePlan) {
      await prisma.tenantPlan.upsert({
        where: {
          tenantId_planId_effectiveFrom: {
            tenantId: testTenant.id,
            planId: freePlan.id,
            effectiveFrom: new Date()
          }
        },
        update: {},
        create: {
          tenantId: testTenant.id,
          planId: freePlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      })
      console.log('✅ Assigned FREE_PLAN to tenant')
    }

    // Create an ATI token for this tenant
    console.log('🎫 Creating ATI token...')
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 12)

    const atiToken = await prisma.aTIToken.create({
      data: {
        tenantId: testTenant.id,
        tokenHash,
        rawToken: rawToken, // Store temporarily for demo
        rawTokenExpiry: atiExpiryDate,
        fingerprint: 'ati-test-token',
        status: 'ACTIVE',
        expiresAt: atiExpiryDate,
        maxUses: 10,
        planTier: 'FREE'
      }
    })

    // Create the ATI-based analyst user
    console.log('👤 Creating ATI-based analyst user...')
    const testUser = await prisma.user.upsert({
      where: { email: testEmail },
      update: {
        passwordHash,
        name: testName,
        roles: ['ANALYST'],
        tenantId: testTenant.id,
        signupAtiTokenId: atiToken.id,
        status: 'ACTIVE'
      },
      create: {
        email: testEmail,
        passwordHash,
        name: testName,
        roles: ['ANALYST'],
        tenantId: testTenant.id,
        signupAtiTokenId: atiToken.id,
        status: 'ACTIVE'
      }
    })

    console.log('\n🎉 ATI-based analyst user created successfully!')
    console.log('================================')
    console.log('👤 USER DETAILS:')
    console.log(`   📧 EMAIL: ${testEmail}`)
    console.log(`   🔑 PASSWORD: ${testPassword}`)
    console.log(`   🆔 USER ID: ${testUser.id}`)
    console.log(`   👤 ROLE: ${testUser.role}`)
    console.log('')
    console.log('🏢 TENANT DETAILS:')
    console.log(`   🏢 TENANT: ${testTenant.name}`)
    console.log(`   🆔 TENANT ID: ${testTenant.id}`)
    console.log(`   🎫 ATI ID: ${testTenant.atiId}`)
    console.log('')
    console.log('🎫 ATI TOKEN DETAILS:')
    console.log(`   🆔 TOKEN ID: ${atiToken.id}`)
    console.log(`   🔑 RAW TOKEN: ${rawToken}`)
    console.log(`   📅 EXPIRES: ${atiToken.expiresAt}`)
    console.log(`   📊 PLAN TIER: ${atiToken.planTier}`)
    console.log('================================')
    console.log('')
    console.log('💡 LOGIN OPTIONS:')
    console.log('   1. Direct login with email/password above')
    console.log('   2. Or use the ATI token for signup flow')
    console.log('   3. This user has FREE_PLAN with metering enabled')

  } catch (error) {
    console.error('❌ Error creating ATI analyst:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
createATIAnalyst()
