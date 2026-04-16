#!/usr/bin/env node

/**
 * Upgrade analyst@spotipr.com account to PRO_PLAN
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function upgradeAnalystToPro() {
  try {
    console.log('🔄 Upgrading analyst@spotipr.com to PRO_PLAN...\n')

    // Find the analyst user
    const analystUser = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: {
          include: {
            tenantPlans: true
          }
        }
      }
    })

    if (!analystUser) {
      console.log('❌ Analyst user not found')
      return
    }

    console.log(`✅ Found user: ${analystUser.email}`)
    console.log(`   Tenant: ${analystUser.tenant.name} (${analystUser.tenant.type})`)

    // Get PRO_PLAN
    const proPlan = await prisma.plan.findFirst({
      where: { code: 'PRO_PLAN' }
    })

    if (!proPlan) {
      console.log('❌ PRO_PLAN not found in database')
      return
    }

    console.log(`✅ Found PRO_PLAN: ${proPlan.name}`)

    // Update tenant plan to PRO_PLAN
    const updatedTenantPlan = await prisma.tenantPlan.upsert({
      where: {
        tenantId_planId_effectiveFrom: {
          tenantId: analystUser.tenantId,
          planId: proPlan.id,
          effectiveFrom: new Date()
        }
      },
      update: {
        status: 'ACTIVE'
      },
      create: {
        tenantId: analystUser.tenantId,
        planId: proPlan.id,
        effectiveFrom: new Date(),
        status: 'ACTIVE'
      }
    })

    console.log('✅ Successfully upgraded to PRO_PLAN!')
    console.log(`   User: ${analystUser.email}`)
    console.log(`   Tenant: ${analystUser.tenant.name}`)
    console.log(`   New Plan: ${proPlan.code} (${proPlan.name})`)
    console.log(`   Effective From: ${updatedTenantPlan.effectiveFrom}`)

  } catch (error) {
    console.error('❌ Error upgrading analyst account:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  upgradeAnalystToPro()
}
