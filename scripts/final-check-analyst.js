#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function finalCheck() {
  console.log('🔍 Final check of analyst configuration...\n')

  const analyst = await prisma.user.findUnique({
    where: { email: 'analyst@spotipr.com' },
    include: { tenant: true }
  })

  if (analyst) {
    console.log('✅ Analyst user status:')
    console.log('   Email:', analyst.email)
    console.log('   Role:', analyst.role)
    console.log('   Status:', analyst.status)
    console.log('   Tenant:', analyst.tenant?.name)
    console.log('   Signup Token ID:', analyst.signupAtiTokenId)

    if (analyst.signupAtiTokenId) {
      const token = await prisma.aTIToken.findUnique({
        where: { id: analyst.signupAtiTokenId }
      })
      if (token) {
        console.log('   Token Status:', token.status)
        console.log('   Token Plan:', token.planTier)
      }
    }
  }

  await prisma.$disconnect()
}

finalCheck()
