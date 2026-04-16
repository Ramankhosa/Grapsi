#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

// Replicate auth functions locally
function generateATIToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12)
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

async function createTestTenant() {
  console.log('🏢 Creating test tenant for expiry notifications...\n')

  try {
    // Check if test tenant already exists
    const existingTenant = await prisma.tenant.findFirst({
      where: { atiId: 'TESTTENANT' }
    })

    if (existingTenant) {
      console.log('✅ Test tenant already exists!')
      console.log(`Name: ${existingTenant.name}`)
      console.log(`ATI ID: ${existingTenant.atiId}`)
      return existingTenant
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Tenant for Notifications',
        atiId: 'TESTTENANT',
        status: 'ACTIVE'
      }
    })

    console.log('✅ Test tenant created successfully!')
    console.log(`Name: ${tenant.name}`)
    console.log(`ATI ID: ${tenant.atiId}`)
    console.log(`ID: ${tenant.id}`)

    return tenant

  } catch (error) {
    console.error('❌ Error creating test tenant:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  createTestTenant().catch(console.error)
}
