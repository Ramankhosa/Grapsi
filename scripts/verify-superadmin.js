#!/usr/bin/env node

/**
 * Verify Super Admin and Analyst user creation
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function verifyUsers() {
  try {
    console.log('🔍 Verifying user creation...\n')

    // Check Super Admin user
    console.log('👑 Checking Super Admin (superadmin@papsi.com):')
    const superAdmin = await prisma.user.findUnique({
      where: { email: 'superadmin@papsi.com' },
      include: {
        tenant: true,
        signupAtiToken: true
      }
    })

    if (superAdmin) {
      console.log('✅ Super Admin found!')
      console.log(`   📧 EMAIL: ${superAdmin.email}`)
      console.log(`   👤 NAME: ${superAdmin.name}`)
      console.log(`   👤 ROLES: ${superAdmin.roles?.join(', ') || 'None'}`)
      console.log(`   📊 STATUS: ${superAdmin.status}`)
      console.log(`   🏢 TENANT: ${superAdmin.tenant?.name} (${superAdmin.tenant?.atiId})`)
      console.log(`   🎫 ATI TOKEN: ${superAdmin.signupAtiToken?.rawToken?.substring(0, 20)}...`)
      console.log(`   📊 PLAN TIER: ${superAdmin.signupAtiToken?.planTier}`)
    } else {
      console.log('❌ Super Admin not found!')
    }

    console.log()

    // Check Analyst user
    console.log('👤 Checking Analyst (analyst@papsi.com):')
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@papsi.com' },
      include: {
        tenant: true,
        signupAtiToken: true
      }
    })

    if (analyst) {
      console.log('✅ Analyst found!')
      console.log(`   📧 EMAIL: ${analyst.email}`)
      console.log(`   👤 NAME: ${analyst.name}`)
      console.log(`   👤 ROLES: ${analyst.roles?.join(', ') || 'None'}`)
      console.log(`   📊 STATUS: ${analyst.status}`)
      console.log(`   🏢 TENANT: ${analyst.tenant?.name} (${analyst.tenant?.atiId})`)
      console.log(`   🎫 ATI TOKEN: ${analyst.signupAtiToken?.rawToken?.substring(0, 20)}...`)
      console.log(`   📊 PLAN TIER: ${analyst.signupAtiToken?.planTier}`)
    } else {
      console.log('❌ Analyst not found!')
    }

    console.log('\n🎉 Verification complete!')

  } catch (error) {
    console.error('❌ Error verifying users:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
verifyUsers()
