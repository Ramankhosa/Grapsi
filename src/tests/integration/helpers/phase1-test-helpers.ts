import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'

import { generateJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' | 'SUPER_ADMIN' | 'SUPER_ADMIN_VIEWER'

export interface TestTenant {
  id: string
  atiId: string
  name: string
}

export interface TestUser {
  id: string
  email: string
  roles: Role[]
  tenantId: string | null
}

/**
 * SAFETY GUARD — this function hard-deletes rows (projects, patents, funding
 * calls, tenant plans, users, tenants, …) from whatever database DATABASE_URL
 * points at. Running the *.real-db.test.ts suites against a real dev/prod DB
 * (e.g. via a plain `npm run test`) will therefore WIPE that data. To prevent an
 * accidental wipe it refuses to run unless the run is explicitly opted in with
 * ALLOW_REAL_DB_TESTS=true — ideally against a disposable TEST_DATABASE_URL.
 *
 * Run these tests deliberately, e.g.:
 *   ALLOW_REAL_DB_TESTS=true npx vitest run src/tests/integration/*.real-db.test.ts
 * and keep them out of the default suite:
 *   npx vitest run --exclude "**/*.real-db.test.ts"
 */
export async function resetPhase1Data() {
  if (process.env.ALLOW_REAL_DB_TESTS !== 'true') {
    throw new Error(
      'Refusing to run real-DB reset: this deletes projects/patents/funding calls/etc. ' +
        'from the database in DATABASE_URL. Set ALLOW_REAL_DB_TESTS=true (against a ' +
        'disposable TEST_DATABASE_URL) to opt in. See the guard note in ' +
        'src/tests/integration/helpers/phase1-test-helpers.ts.'
    )
  }

  await prisma.grantSession.deleteMany()
  await prisma.tenantPlan.deleteMany()
  await prisma.fundingImportAsset.deleteMany()
  await prisma.fundingCallTemplateRevision.deleteMany()
  await prisma.fundingCallTemplate.deleteMany()
  await prisma.fundingCallGuidelineRevision.deleteMany()
  await prisma.fundingCallGuideline.deleteMany()
  await prisma.fundingImportJob.deleteMany()
  await prisma.fundingCall.deleteMany()
  await prisma.annexureVersion.deleteMany()
  await prisma.noveltySearchRun.deleteMany()
  await prisma.patent.deleteMany()
  await prisma.applicantProfile.deleteMany()
  await prisma.projectCollaborator.deleteMany()
  await prisma.project.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
  await prisma.tenant.deleteMany()
}

export async function createTenant(name = 'Phase 1 Tenant'): Promise<TestTenant> {
  const suffix = randomUUID()

  const tenant = await prisma.tenant.create({
    data: {
      id: `phase1-tenant-${suffix}`,
      name: `${name} ${suffix}`,
      atiId: `phase1-ati-${suffix}`,
    },
  })

  return tenant
}

export async function createUser(options: {
  tenantId?: string | null
  roles?: Role[]
  emailPrefix?: string
  firstName?: string
  lastName?: string
}) {
  const suffix = randomUUID()
  const firstName = options.firstName ?? 'Phase'
  const lastName = options.lastName ?? 'User'

  const user = await prisma.user.create({
    data: {
      id: `phase1-user-${suffix}`,
      tenantId: options.tenantId ?? null,
      email: `${options.emailPrefix ?? 'phase1-user'}-${suffix}@example.com`,
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      roles: options.roles ?? ['ANALYST'],
      status: 'ACTIVE',
      emailVerified: true,
      oauthProvider: 'GOOGLE',
      oauthProviderId: `google-${suffix}`,
      oauthProfile: { sub: `google-${suffix}` },
    },
  })

  return user
}

export async function createProject(options: {
  tenantId: string
  userId: string
  name?: string
}) {
  return prisma.project.create({
    data: {
      tenantId: options.tenantId,
      userId: options.userId,
      name: options.name ?? `Phase 1 Project ${randomUUID()}`,
    },
  })
}

export async function addCollaborator(options: {
  projectId: string
  userId: string
  addedBy: string
  role?: 'collaborator' | 'viewer'
}) {
  return prisma.projectCollaborator.create({
    data: {
      projectId: options.projectId,
      userId: options.userId,
      addedBy: options.addedBy,
      role: options.role ?? 'collaborator',
    },
  })
}

export function issueAccessToken(options: {
  userId: string
  email: string
  roles: string[]
  tenantId?: string | null
  tenantAtiId?: string | null
}) {
  return generateJWT({
    sub: options.userId,
    email: options.email,
    tenant_id: options.tenantId ?? null,
    roles: options.roles,
    ati_id: options.tenantAtiId ?? null,
    tenant_ati_id: options.tenantAtiId ?? null,
    scope: options.tenantId ? 'tenant' : 'platform',
  })
}

export function createJsonRequest(
  path: string,
  token: string,
  method: string,
  body?: unknown
) {
  return new NextRequest(
    new Request(`http://localhost:3010${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  )
}

export function createRequest(path: string, token: string, method = 'GET') {
  return new NextRequest(
    new Request(`http://localhost:3010${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  )
}

export function createMultipartRequest(options: {
  path: string
  token: string
  fields?: Record<string, string>
  file?: File
  method?: string
}) {
  const formData = new FormData()

  for (const [key, value] of Object.entries(options.fields || {})) {
    formData.append(key, value)
  }

  if (options.file) {
    formData.append('file', options.file)
  }

  return new NextRequest(
    new Request(`http://localhost:3010${options.path}`, {
      method: options.method || 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
      },
      body: formData,
    })
  )
}
