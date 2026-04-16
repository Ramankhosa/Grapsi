import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'
import { createProject, createTenant, createUser, resetPhase1Data } from '@/tests/integration/helpers/phase1-test-helpers'

afterEach(async () => {
  await resetPhase1Data()
})

describe('Phase 1 schema and migration real DB validation', () => {
  it('allows a global funding call with null tenantId', async () => {
    const fundingCall = await prisma.fundingCall.create({
      data: {
        visibility: 'GLOBAL_PUBLISHED',
        status: 'PUBLISHED',
        title: 'Global Grant Opportunity',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/global-call',
        createdByUserId: 'phase1-system',
        updatedByUserId: 'phase1-system',
      },
    })

    expect(fundingCall.tenantId).toBeNull()
    expect(fundingCall.visibility).toBe('GLOBAL_PUBLISHED')
  })

  it('rejects a tenant-private funding call without tenantId', async () => {
    await expect(
      prisma.fundingCall.create({
        data: {
          visibility: 'TENANT_PRIVATE',
          status: 'READY_FOR_REVIEW',
          title: 'Broken Tenant Call',
          sourceType: 'URL',
          sourceUrl: 'https://example.com/private-call',
          createdByUserId: 'phase1-system',
          updatedByUserId: 'phase1-system',
        },
      })
    ).rejects.toThrow()
  })

  it('rejects grant sessions with null tenantId at the database layer', async () => {
    const tenant = await createTenant('Grant Session Tenant')
    const user = await createUser({ tenantId: tenant.id, emailPrefix: 'phase1-grant-user' })
    const project = await createProject({ tenantId: tenant.id, userId: user.id, name: 'Grant Session Project' })
    const fundingCall = await prisma.fundingCall.create({
      data: {
        tenantId: tenant.id,
        visibility: 'TENANT_PRIVATE',
        status: 'READY_FOR_REVIEW',
        title: 'Tenant Grant Call',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/tenant-call',
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
    })

    await expect(
      prisma.$executeRawUnsafe(
        `
          INSERT INTO "grant_sessions" (
            "id",
            "projectId",
            "tenantId",
            "fundingCallId",
            "status",
            "createdByUserId",
            "updatedByUserId",
            "createdAt",
            "updatedAt"
          )
          VALUES ($1, $2, NULL, $3, 'SETUP', $4, $4, NOW(), NOW())
        `,
        `phase1-grant-session-${randomUUID()}`,
        project.id,
        fundingCall.id,
        user.id
      )
    ).rejects.toThrow()
  })

  it('migration SQL backfills project tenantId from owner tenantId', async () => {
    const suffix = randomUUID().replace(/-/g, '')
    const usersTable = `phase1_migration_users_${suffix}`
    const projectsTable = `phase1_migration_projects_${suffix}`

    try {
      await prisma.$executeRawUnsafe(`CREATE TABLE "${usersTable}" ("id" TEXT PRIMARY KEY, "tenantId" TEXT)`)
      await prisma.$executeRawUnsafe(`CREATE TABLE "${projectsTable}" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "tenantId" TEXT)`)

      await prisma.$executeRawUnsafe(`INSERT INTO "${usersTable}" ("id", "tenantId") VALUES ('user-1', 'tenant-1')`)
      await prisma.$executeRawUnsafe(`INSERT INTO "${projectsTable}" ("id", "userId", "tenantId") VALUES ('project-1', 'user-1', NULL)`)

      await prisma.$executeRawUnsafe(
        `UPDATE "${projectsTable}" AS p SET "tenantId" = u."tenantId" FROM "${usersTable}" AS u WHERE p."userId" = u."id"`
      )

      const rows = await prisma.$queryRawUnsafe<Array<{ tenantId: string | null }>>(
        `SELECT "tenantId" FROM "${projectsTable}" WHERE "id" = 'project-1'`
      )

      expect(rows[0]?.tenantId).toBe('tenant-1')
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${projectsTable}"`)
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${usersTable}"`)
    }
  })

  it('migration SQL orphan check fails cleanly when a project owner has no tenantId', async () => {
    const suffix = randomUUID().replace(/-/g, '')
    const usersTable = `phase1_migration_users_${suffix}`
    const projectsTable = `phase1_migration_projects_${suffix}`

    try {
      await prisma.$executeRawUnsafe(`CREATE TABLE "${usersTable}" ("id" TEXT PRIMARY KEY, "tenantId" TEXT)`)
      await prisma.$executeRawUnsafe(`CREATE TABLE "${projectsTable}" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "tenantId" TEXT)`)

      await prisma.$executeRawUnsafe(`INSERT INTO "${usersTable}" ("id", "tenantId") VALUES ('user-1', NULL)`)
      await prisma.$executeRawUnsafe(`INSERT INTO "${projectsTable}" ("id", "userId", "tenantId") VALUES ('project-1', 'user-1', NULL)`)

      await prisma.$executeRawUnsafe(
        `UPDATE "${projectsTable}" AS p SET "tenantId" = u."tenantId" FROM "${usersTable}" AS u WHERE p."userId" = u."id"`
      )

      await expect(
        prisma.$executeRawUnsafe(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM "${projectsTable}" AS p
              LEFT JOIN "${usersTable}" AS u ON u."id" = p."userId"
              WHERE u."tenantId" IS NULL OR p."tenantId" IS NULL
            ) THEN
              RAISE EXCEPTION 'Project tenantId backfill failed: found project owners without tenantId';
            END IF;
          END $$;
        `)
      ).rejects.toThrow('Project tenantId backfill failed')
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${projectsTable}"`)
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${usersTable}"`)
    }
  })

  it('migration SQL file contains the project tenant backfill and funding visibility checks', () => {
    const migrationPath = path.join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260415000000_phase1_project_tenant_foundation',
      'migration.sql'
    )
    const migrationSql = fs.readFileSync(migrationPath, 'utf8')

    expect(migrationSql).toContain('UPDATE "projects" AS p')
    expect(migrationSql).toContain('Project tenantId backfill failed: found project owners without tenantId')
    expect(migrationSql).toContain('funding_calls_visibility_tenantId_check')
  })
})
