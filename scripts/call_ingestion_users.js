#!/usr/bin/env node

/**
 * Seed platform call-ingestion operator users.
 *
 * Usage:
 *   node scripts/call_ingestion_users.js
 *
 * Optional:
 *   CALL_INGESTION_USER_PASSWORD='...' node scripts/call_ingestion_users.js
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const prisma = new PrismaClient()

const DEFAULT_PASSWORD = 'admin@12345'
const PLATFORM_ROLE_CODES = ['FUNDING_OPERATIONS_MANAGER', 'FUNDING_PUBLISHER']
const APP_ROLES = ['ADMIN']
const ATI_PEPPER = process.env.ATI_PEPPER || 'default-pepper-change-in-prod'
const USERS = [
  { email: 'sunil_call@gmail.com', name: 'Sunil Call' },
  { email: 'rajeev_call@gmail.com', name: 'Rajeev Call' },
  { email: 'sandeep_call@gmail.com', name: 'Sandeep Call' },
]

function generateATIToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function hashATIToken(token) {
  return crypto.createHash('sha256').update(token + ATI_PEPPER).digest('hex')
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

async function ensurePlatformTenant() {
  return prisma.tenant.upsert({
    where: { atiId: 'PLATFORM' },
    update: {
      name: 'Platform Administration',
      status: 'ACTIVE',
    },
    create: {
      name: 'Platform Administration',
      atiId: 'PLATFORM',
      status: 'ACTIVE',
    },
  })
}

async function ensureSignupToken(tx, platformTenant, userDef, existingSignupAtiTokenId) {
  if (existingSignupAtiTokenId) {
    const existingToken = await tx.aTIToken.findUnique({
      where: { id: existingSignupAtiTokenId },
      select: { id: true, status: true, expiresAt: true },
    })

    if (
      existingToken &&
      existingToken.status !== 'REVOKED' &&
      existingToken.status !== 'EXPIRED' &&
      (!existingToken.expiresAt || existingToken.expiresAt > new Date())
    ) {
      return existingToken.id
    }
  }

  const rawToken = generateATIToken()
  const tokenHash = hashATIToken(rawToken)
  const token = await tx.aTIToken.create({
    data: {
      tenantId: platformTenant.id,
      tokenHash,
      fingerprint: createATIFingerprint(tokenHash),
      status: 'USED_UP',
      maxUses: 1,
      usageCount: 1,
      planTier: 'PLATFORM_CALL_INGESTION',
      notes: `Signup token reference for seeded call ingestion user ${userDef.email}`,
      assignedRole: 'ADMIN',
    },
    select: { id: true },
  })

  return token.id
}

async function upsertCallIngestionUser(platformTenant, userDef, passwordHash) {
  return prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({
      where: { email: userDef.email },
      select: { signupAtiTokenId: true },
    })
    const signupAtiTokenId = await ensureSignupToken(tx, platformTenant, userDef, existingUser?.signupAtiTokenId || null)

    const user = await tx.user.upsert({
      where: { email: userDef.email },
      update: {
        tenantId: platformTenant.id,
        signupAtiTokenId,
        passwordHash,
        name: userDef.name,
        roles: APP_ROLES,
        status: 'ACTIVE',
        emailVerified: true,
      },
      create: {
        tenantId: platformTenant.id,
        signupAtiTokenId,
        email: userDef.email,
        passwordHash,
        name: userDef.name,
        roles: APP_ROLES,
        status: 'ACTIVE',
        emailVerified: true,
      },
    })

    await tx.platformTeamRoleAssignment.updateMany({
      where: {
        userId: user.id,
        roleCode: { notIn: PLATFORM_ROLE_CODES },
        isActive: true,
      },
      data: {
        isActive: false,
      },
    })

    for (const roleCode of PLATFORM_ROLE_CODES) {
      await tx.platformTeamRoleAssignment.upsert({
        where: {
          userId_roleCode: {
            userId: user.id,
            roleCode,
          },
        },
        update: {
          isActive: true,
          assignedByUserId: null,
        },
        create: {
          userId: user.id,
          roleCode,
          assignedByUserId: null,
          isActive: true,
        },
      })
    }

    return user
  })
}

async function main() {
  const password = process.env.CALL_INGESTION_USER_PASSWORD || DEFAULT_PASSWORD
  const passwordHash = await bcrypt.hash(password, 12)
  const platformTenant = await ensurePlatformTenant()

  console.log('Seeding call-ingestion platform users...')
  console.log(`Platform tenant: ${platformTenant.name} (${platformTenant.atiId})`)
  console.log(`App roles: ${APP_ROLES.join(', ')}`)
  console.log(`Platform roles: ${PLATFORM_ROLE_CODES.join(', ')}`)

  for (const userDef of USERS) {
    const user = await upsertCallIngestionUser(platformTenant, userDef, passwordHash)
    console.log(`  - ${user.email} (${user.name}) ready`)
  }

  console.log('Call-ingestion users seeded.')
}

main()
  .catch((error) => {
    console.error('Failed to seed call-ingestion users:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
