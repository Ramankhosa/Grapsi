/**
 * Quick script to upgrade analyst@papsi.com to PRO plan
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Find the user
  const user = await prisma.user.findFirst({
    where: { email: { equals: 'analyst@papsi.com', mode: 'insensitive' } },
    include: { tenant: true }
  })
  
  if (!user) {
    console.log('❌ User analyst@papsi.com not found')
    return
  }
  
  console.log('✅ Found user:', user.email)
  console.log('   Tenant:', user.tenant?.name || 'N/A')
  console.log('   TenantId:', user.tenantId)
  
  // Find PRO plan
  const proPlan = await prisma.plan.findFirst({ 
    where: { code: 'PRO_PLAN' } 
  })
  
  if (!proPlan) {
    console.log('❌ PRO_PLAN not found')
    return
  }
  
  console.log('✅ Found PRO Plan:', proPlan.name, '(', proPlan.id, ')')
  
  if (!user.tenantId) {
    console.log('❌ User has no tenant')
    return
  }
  
  // Check current plan
  const currentPlan = await prisma.tenantPlan.findFirst({
    where: { tenantId: user.tenantId, status: 'ACTIVE' },
    include: { plan: true }
  })
  
  console.log('📋 Current plan:', currentPlan?.plan?.name || 'None')
  
  // Deactivate all existing plans
  await prisma.tenantPlan.updateMany({
    where: { tenantId: user.tenantId },
    data: { status: 'INACTIVE' }
  })
  
  // Create new PRO plan assignment
  const newPlanAssignment = await prisma.tenantPlan.create({
    data: {
      tenantId: user.tenantId,
      planId: proPlan.id,
      status: 'ACTIVE',
      effectiveFrom: new Date()
    }
  })
  
  console.log('🎉 Successfully upgraded to PRO plan!')
  console.log('   New TenantPlan ID:', newPlanAssignment.id)
}

main()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect())












