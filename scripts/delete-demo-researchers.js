#!/usr/bin/env node

/**
 * Delete all demo researcher users seeded by seed-demo-researchers.js
 *
 * Removes: users, projects, researcher_profiles, researcher_saved_research_areas,
 *          reference_library (citations), and the demo ENTERPRISE_PLAN entitlement.
 *
 * Usage:
 *   node scripts/delete-demo-researchers.js                     # auto-picks tenant
 *   node scripts/delete-demo-researchers.js --tenant-id=<id>    # target a specific tenant
 *   node scripts/delete-demo-researchers.js --dry-run            # preview without deleting
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const DEMO_EMAIL_DOMAIN = '@lpu.in'

const DEMO_EMAILS = [
  'arun.sharma', 'priya.gupta', 'vikram.singh', 'neha.kapoor', 'rajesh.kumar',
  'anita.rani', 'manish.thakur', 'shalini.verma', 'deepak.mishra', 'kavita.joshi',
  'suresh.patel', 'ritu.devi', 'amit.chauhan', 'pooja.mehta', 'gaurav.bansal',
  'sunita.rawat', 'harish.negi', 'meena.agarwal',
  'rohit.bhatia', 'sapna.yadav', 'karan.malhotra', 'divya.kohli', 'pankaj.dhiman',
  'nidhi.saini', 'tarun.gill',
  'ashok.rathore', 'geeta.tiwari', 'lalit.goyal', 'rekha.chaudhary', 'ajay.sood',
  'smita.pandey', 'varun.sethi', 'pallavi.bhatt', 'nitin.arora', 'isha.saxena',
  'anand.prakash', 'bhavna.rana', 'gopal.taneja',
  'monika.sharma', 'vivek.garg', 'swati.khurana', 'rahul.chhabra',
  'jagdish.chand', 'kamini.dutta', 'sanjeev.pal', 'usha.bisht',
  'sanjay.mittal', 'jyoti.bala',
  'harsh.wardhan',
  'seema.bajaj',
].map(e => `${e}${DEMO_EMAIL_DOMAIN}`)

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const tenantIdArg = args.find(a => a.startsWith('--tenant-id='))
  let tenantId = tenantIdArg ? tenantIdArg.split('=')[1] : null

  if (!tenantId) {
    const tenant = await prisma.tenant.findFirst({
      where: { atiId: { not: 'PLATFORM' }, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' }
    })
    if (!tenant) {
      console.error('No active non-platform tenant found.')
      process.exit(1)
    }
    tenantId = tenant.id
    console.log(`Auto-selected tenant: ${tenant.name} (${tenant.atiId}) — ${tenantId}`)
  }

  if (dryRun) {
    console.log('\n🔍 DRY RUN — no data will be deleted\n')
  }

  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS }, tenantId },
    select: { id: true, email: true, name: true }
  })

  if (users.length === 0) {
    console.log('No demo users found in this tenant. Nothing to delete.')
    return
  }

  console.log(`\nFound ${users.length} demo users to delete:\n`)
  for (const u of users) {
    console.log(`  • ${u.email} (${u.name})`)
  }

  if (dryRun) {
    console.log('\n🔍 Dry run complete. Run without --dry-run to delete.')
    return
  }

  const userIds = users.map(u => u.id)

  console.log('\nDeleting...')

  // 1. Delete reference_library / citations
  const citationsDeleted = await prisma.citation.deleteMany({
    where: { userId: { in: userIds }, tenantId }
  })
  console.log(`  ✓ ${citationsDeleted.count} citations deleted`)

  // 2. Delete researcher_saved_research_areas (raw — no Prisma model for this)
  const areasDeleted = await prisma.$executeRaw`
    DELETE FROM researcher_saved_research_areas WHERE user_id = ANY(${userIds}::text[])
  `
  console.log(`  ✓ ${areasDeleted} research areas deleted`)

  // 3. Delete researcher_profiles (raw)
  const profilesDeleted = await prisma.$executeRaw`
    DELETE FROM researcher_profiles WHERE user_id = ANY(${userIds}::text[])
  `
  console.log(`  ✓ ${profilesDeleted} researcher profiles deleted`)

  // 4. Delete projects
  const projectsDeleted = await prisma.project.deleteMany({
    where: { userId: { in: userIds }, tenantId }
  })
  console.log(`  ✓ ${projectsDeleted.count} projects deleted`)

  // 5. Delete users
  const usersDeleted = await prisma.user.deleteMany({
    where: { id: { in: userIds } }
  })
  console.log(`  ✓ ${usersDeleted.count} users deleted`)

  // 6. Remove demo-seed enterprise entitlement
  const demoEntitlement = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      source: 'MANUAL',
      sourceRef: `demo-seed-${tenantId}`,
    }
  })
  if (demoEntitlement) {
    await prisma.tenantPlan.delete({ where: { id: demoEntitlement.id } })
    console.log('  ✓ Demo ENTERPRISE_PLAN entitlement removed')
  }

  console.log(`\n✅ Cleanup complete: ${usersDeleted.count} demo users and all related data removed.`)
}

main()
  .catch((err) => {
    console.error('❌ Cleanup failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
