/**
 * Diagnose Trial User Ideation Issues
 * 
 * This script checks all the things that could cause ideation to fail for trial users:
 * 1. Does the TRIAL plan exist?
 * 2. Is it the same plan ID that was configured in Super Admin UI?
 * 3. Does the WorkflowStage IDEATION_NORMALIZE exist?
 * 4. Does the TRIAL plan have a PlanStageModelConfig for IDEATION_NORMALIZE?
 * 5. Is the assigned model active?
 * 6. Do trial users actually have a TenantPlan pointing to the TRIAL plan?
 * 
 * Run: npx tsx scripts/diagnose-trial-ideation.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function diagnose() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  DIAGNOSING TRIAL USER IDEATION ISSUES')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // 1. Check for TRIAL plans (there might be duplicates!)
  console.log('1️⃣  Checking TRIAL plans...\n')
  const trialPlans = await prisma.plan.findMany({
    where: { 
      OR: [
        { code: 'TRIAL' },
        { name: { contains: 'Trial', mode: 'insensitive' } }
      ]
    }
  })

  if (trialPlans.length === 0) {
    console.log('   ❌ NO TRIAL plan found! This is the problem.')
    console.log('   → Run: npx tsx scripts/fix-trial-plan-llm-access.ts\n')
    await prisma.$disconnect()
    return
  }

  if (trialPlans.length > 1) {
    console.log('   ⚠️  WARNING: Multiple trial-related plans found!')
    console.log('   This could cause confusion in Super Admin UI:\n')
  }

  for (const plan of trialPlans) {
    console.log(`   Plan ID: ${plan.id}`)
    console.log(`   Code: ${plan.code}`)
    console.log(`   Name: ${plan.name}`)
    console.log(`   Status: ${plan.status}`)
    console.log('')
  }

  const mainTrialPlan = trialPlans.find(p => p.code === 'TRIAL')
  if (!mainTrialPlan) {
    console.log('   ❌ No plan with code "TRIAL" found!')
    console.log('   Plans found have different codes.\n')
  }

  // 2. Check WorkflowStage for IDEATION_NORMALIZE
  console.log('2️⃣  Checking WorkflowStage for IDEATION_NORMALIZE...\n')
  const ideationStage = await prisma.workflowStage.findUnique({
    where: { code: 'IDEATION_NORMALIZE' }
  })

  if (!ideationStage) {
    console.log('   ❌ WorkflowStage "IDEATION_NORMALIZE" does NOT exist!')
    console.log('   → Run: node Seed/seed-llm-models.js\n')
    await prisma.$disconnect()
    return
  }

  console.log(`   ✅ Stage found:`)
  console.log(`      ID: ${ideationStage.id}`)
  console.log(`      Code: ${ideationStage.code}`)
  console.log(`      Feature: ${ideationStage.featureCode}`)
  console.log(`      Active: ${ideationStage.isActive}\n`)

  if (!ideationStage.isActive) {
    console.log('   ⚠️  WARNING: Stage is INACTIVE! This will cause model resolution to fail.')
    console.log('')
  }

  // 3. Check PlanStageModelConfig for each trial plan
  console.log('3️⃣  Checking PlanStageModelConfig for IDEATION_NORMALIZE...\n')
  
  for (const plan of trialPlans) {
    const stageConfig = await prisma.planStageModelConfig.findFirst({
      where: {
        planId: plan.id,
        stageId: ideationStage.id
      },
      include: {
        model: true
      }
    })

    console.log(`   Plan "${plan.name}" (${plan.code}):`)
    
    if (!stageConfig) {
      console.log('      ❌ NO config for IDEATION_NORMALIZE!')
      console.log('      → This is likely the problem if users are on this plan.')
      console.log('')
      continue
    }

    console.log(`      ✅ Config found:`)
    console.log(`         Model: ${stageConfig.model.code} (${stageConfig.model.displayName})`)
    console.log(`         Model Active: ${stageConfig.model.isActive}`)
    console.log(`         Config Active: ${stageConfig.isActive}`)
    console.log(`         MaxTokensIn: ${stageConfig.maxTokensIn || 'default'}`)
    console.log(`         MaxTokensOut: ${stageConfig.maxTokensOut || 'default'}`)
    console.log('')

    if (!stageConfig.model.isActive) {
      console.log('      ⚠️  WARNING: The assigned model is INACTIVE!')
      console.log('')
    }
    if (!stageConfig.isActive) {
      console.log('      ⚠️  WARNING: The config itself is INACTIVE!')
      console.log('')
    }
  }

  // 4. Check all ideation stage configs for trial plans
  console.log('4️⃣  Checking ALL ideation stage configs for trial plans...\n')
  
  const ideationStages = await prisma.workflowStage.findMany({
    where: { featureCode: 'IDEATION' }
  })

  for (const plan of trialPlans) {
    console.log(`   Plan "${plan.name}" (${plan.code}):`)
    
    const configs = await prisma.planStageModelConfig.findMany({
      where: {
        planId: plan.id,
        stageId: { in: ideationStages.map(s => s.id) }
      },
      include: {
        stage: true,
        model: true
      }
    })

    if (configs.length === 0) {
      console.log('      ❌ NO ideation configs at all!')
    } else {
      console.log(`      Found ${configs.length}/${ideationStages.length} ideation stage configs:`)
      for (const config of configs) {
        const status = config.isActive && config.model.isActive ? '✅' : '⚠️'
        console.log(`         ${status} ${config.stage.code} → ${config.model.code}`)
      }
      
      // Find missing stages
      const configuredStageIds = configs.map(c => c.stageId)
      const missingStages = ideationStages.filter(s => !configuredStageIds.includes(s.id))
      if (missingStages.length > 0) {
        console.log('      Missing configs for:')
        for (const stage of missingStages) {
          console.log(`         ❌ ${stage.code}`)
        }
      }
    }
    console.log('')
  }

  // 5. Check trial tenants and their plan assignments
  console.log('5️⃣  Checking trial tenants and their plan assignments...\n')
  
  // Find TRIAL tenant
  const trialTenant = await prisma.tenant.findFirst({
    where: { atiId: 'TRIAL' },
    include: {
      tenantPlans: {
        where: { status: 'ACTIVE' },
        include: { plan: true }
      }
    }
  })

  if (!trialTenant) {
    console.log('   ⚠️  No TRIAL tenant found (atiId = "TRIAL")')
    console.log('   Trial users might be in campaign-specific tenants.\n')
  } else {
    console.log(`   TRIAL tenant found:`)
    console.log(`      ID: ${trialTenant.id}`)
    console.log(`      Name: ${trialTenant.name}`)
    console.log(`      Active TenantPlans:`)
    
    if (trialTenant.tenantPlans.length === 0) {
      console.log('         ❌ NO active TenantPlan!')
      console.log('         → This means trial users have no plan assigned!')
    } else {
      for (const tp of trialTenant.tenantPlans) {
        console.log(`         Plan: ${tp.plan.code} (${tp.plan.name})`)
        console.log(`         Plan ID: ${tp.planId}`)
        
        // Check if this plan has ideation config
        const hasConfig = await prisma.planStageModelConfig.findFirst({
          where: { planId: tp.planId, stageId: ideationStage.id }
        })
        if (!hasConfig) {
          console.log('         ❌ This plan has NO ideation config!')
        } else {
          console.log('         ✅ This plan has ideation config')
        }
      }
    }
    console.log('')
  }

  // 6. Check a sample of recent trial invite users
  console.log('6️⃣  Checking recent trial invite users...\n')
  
  const recentInvites = await prisma.trialInvite.findMany({
    where: { status: 'SIGNED_UP' },
    take: 5,
    orderBy: { signedUpAt: 'desc' },
    include: {
      campaign: true
    }
  })

  if (recentInvites.length === 0) {
    console.log('   No signed-up trial invites found.\n')
  } else {
    for (const invite of recentInvites) {
      const user = invite.signedUpUserId 
        ? await prisma.user.findUnique({
            where: { id: invite.signedUpUserId },
            include: {
              tenant: {
                include: {
                  tenantPlans: {
                    where: { status: 'ACTIVE' },
                    include: { plan: true },
                    take: 1
                  }
                }
              }
            }
          })
        : null

      console.log(`   User: ${invite.email}`)
      console.log(`   Campaign: ${invite.campaign?.name || 'Unknown'}`)
      
      if (user?.tenant) {
        console.log(`   Tenant: ${user.tenant.name} (${user.tenant.id})`)
        
        if (user.tenant.tenantPlans[0]) {
          const plan = user.tenant.tenantPlans[0].plan
          console.log(`   Assigned Plan: ${plan.code} (ID: ${plan.id})`)
          
          // Check if this plan has ideation config
          const hasConfig = await prisma.planStageModelConfig.findFirst({
            where: { planId: plan.id, stageId: ideationStage.id },
            include: { model: true }
          })
          
          if (hasConfig) {
            console.log(`   ✅ Plan has IDEATION_NORMALIZE config → ${hasConfig.model.code}`)
          } else {
            console.log('   ❌ Plan has NO IDEATION_NORMALIZE config!')
            console.log('   → THIS IS THE PROBLEM!')
          }
        } else {
          console.log('   ❌ NO active TenantPlan assigned!')
        }
      } else {
        console.log('   ⚠️  User or tenant not found')
      }
      console.log('')
    }
  }

  // 7. Summary and recommendations
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  SUMMARY & RECOMMENDATIONS')
  console.log('═══════════════════════════════════════════════════════════════\n')
  
  if (mainTrialPlan) {
    const hasIdeationConfig = await prisma.planStageModelConfig.findFirst({
      where: { planId: mainTrialPlan.id, stageId: ideationStage.id }
    })
    
    if (hasIdeationConfig) {
      console.log('   ✅ TRIAL plan has IDEATION_NORMALIZE config')
      console.log('')
      console.log('   If users are still getting errors, check:')
      console.log('   1. Are trial users assigned to THIS specific plan ID?')
      console.log('   2. Is the assigned model active and API key configured?')
      console.log('   3. Check server logs for: "[Gateway] Resolving model for tenant=..."')
    } else {
      console.log('   ❌ TRIAL plan is MISSING ideation configs!')
      console.log('')
      console.log('   Fix options:')
      console.log('   A) Via Super Admin UI:')
      console.log('      1. Go to /super-admin/llm-config')
      console.log('      2. Select "Trial Plan" from the plan dropdown')
      console.log('      3. Select "IDEATION" feature')
      console.log('      4. Assign models to each ideation stage')
      console.log('')
      console.log('   B) Via script:')
      console.log('      npx tsx scripts/fix-trial-plan-llm-access.ts')
    }
  }

  await prisma.$disconnect()
  console.log('\n═══════════════════════════════════════════════════════════════\n')
}

diagnose().catch(e => {
  console.error('Error:', e)
  prisma.$disconnect()
  process.exit(1)
})

